"""
arxiv.py: talking to the arXiv API, and turning its Atom feed into records.

Rules:

  * One request at a time, spaced a little wider than arXiv's three seconds
    (config.py). The Client is the only thing here that touches the network,
    so the rate limit lives in one place and tests can hand in a fake.
  * Transient failures are retried with exponential backoff: timeouts, dropped
    connections, 5xx, 429, and 406. The 406 is on the list because the API
    returned it for several days from mid-September 2026 with no change on the
    caller's side.
  * A 429 or 503 is arXiv asking us to back off, so those waits start at 30 s
    and double to a 5-minute ceiling, about 20 minutes in all. On 4 Oct 2026 a
    spell of 429s outlasted a 3-minute retry budget even at one request every
    three seconds.
  * An error entry in the feed (id under arxiv.org/api/errors) means the query
    itself is wrong. That is not retried; it is raised.
  * Categories keep arXiv taxonomy terms only. The feed also carries MSC codes
    (81P68) and ACM codes (F.2.2) as <category> elements, and those are not
    arXiv categories.
"""

import re
import socket
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from . import config

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}

RETRY_STATUS = {406, 429, 500, 502, 503, 504}
BACK_OFF_STATUS = {429, 503}
BACK_OFF_FIRST_S = 30.0
MAX_DELAY_S = 300.0
MAX_ATTEMPTS = 8

# archive or archive.subject, e.g. quant-ph, cond-mat.str-el, math.MP, cs.LG.
# Lowercase first letter rules out ACM codes (F.2.2); MSC codes (81P68) start
# with a digit.
TAXONOMY = re.compile(r"^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]+(?:-[A-Za-z]+)*)?$")
VERSION = re.compile(r"v\d+$")

# A paper counts as withdrawn only when its own notice says so. Comments also
# mention other papers being withdrawn ("replaces the withdrawn manuscript"),
# parts of a paper ("Section 6 is withdrawn"), and conditional futures ("could
# be withdrawn if accepted"), and abstracts can mean physics ("work withdrawn
# from a quantum battery"). Each pattern below was checked against every hit in
# the 2021-10 to 2026-09 backfill.
_NOUN = r"(?:paper|article|manuscript|submission|preprint|work|note|version)"
WITHDRAWN_NOTICE = re.compile(
    r"(?:^|[.;]\s+)withdra(?:wn|wal)\s+(?:due|because|by|at|for|to|pending|following|after|on)\b"
    r"|(?:^|[.;]\s+)withdrawn\s*[.;]?\s*$"
    rf"|\b(?:this|the)\s+(?:current\s+)?{_NOUN}\s+(?:has\s+been|is|is\s+being|was|will\s+be|be)\s+withdrawn\b"
    r"|\bwithdrawn\s+by\s+(?:the\s+)?(?:authors?|arxiv)\b"
    rf"|\bwithdr(?:aw|awn|ew)\s+(?:this|the|our|my)\s+{_NOUN}\b"
    r"|\b(?:request|requesting|seek|seeking)\s+(?:the\s+)?withdrawal\b"
    r"|\bneeds?\s+to\s+be\s+withdrawn\b",
    re.I,
)
EARLIER_VERSION = re.compile(r"(?:previous|earlier|prior)\s+versions?\s+of\s+$", re.I)


def _says_withdrawn(text) -> bool:
    for m in WITHDRAWN_NOTICE.finditer(text or ""):
        if not EARLIER_VERSION.search(text[:m.start()]):
            return True
    return False


class ApiError(Exception):
    """The API rejected the query. Retrying will not help."""


class TransientError(Exception):
    """The request failed in a way that retrying usually fixes."""


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


class Client:
    def __init__(self, interval: float = config.REQUEST_INTERVAL_S, timeout: float = 90.0):
        self.interval = interval
        self.timeout = timeout
        self._last = 0.0
        self.requests = 0
        self.seconds_waiting_on_server = 0.0
        self.user_agent = config.user_agent()

    def _wait_turn(self) -> None:
        # Measured from the end of the last request, which is the stricter
        # reading of "one request every three seconds".
        gap = time.monotonic() - self._last
        if gap < self.interval:
            time.sleep(self.interval - gap)

    def get(self, url: str, accept: str = "application/atom+xml") -> bytes:
        delay = self.interval
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._wait_turn()
            t0 = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": accept})
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read()
                return body
            except urllib.error.HTTPError as e:
                if e.code not in RETRY_STATUS:
                    raise ApiError(f"HTTP {e.code} for {url}") from e
                if e.code in BACK_OFF_STATUS:
                    delay = max(delay, BACK_OFF_FIRST_S)
                retry_after = e.headers.get("Retry-After") if e.headers else None
                if retry_after and retry_after.isdigit():
                    delay = max(delay, float(retry_after))
                reason = f"HTTP {e.code}"
            except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError) as e:
                reason = type(e).__name__
            finally:
                self._last = time.monotonic()
                self.requests += 1
                self.seconds_waiting_on_server += self._last - t0
            if attempt == MAX_ATTEMPTS:
                raise TransientError(f"{reason} after {attempt} attempts: {url}")
            log(f"  {reason}, retrying in {delay:.0f} s (attempt {attempt}/{MAX_ATTEMPTS})")
            time.sleep(delay)
            delay = min(delay * 2, MAX_DELAY_S)
        raise AssertionError("unreachable")


def strip_version(arxiv_id: str) -> str:
    """'http://arxiv.org/abs/2609.01234v2' -> '2609.01234'."""
    tail = arxiv_id.split("/abs/", 1)[-1]
    return VERSION.sub("", tail)


def clean_categories(terms):
    out = []
    for t in terms:
        t = t.strip()
        if TAXONOMY.match(t) and t not in out:
            out.append(t)
    return out


def is_withdrawn(abstract: str, comment) -> bool:
    return _says_withdrawn(comment) or _says_withdrawn(abstract)


def _text(node, path):
    found = node.find(path, NS)
    if found is None or found.text is None:
        return None
    return " ".join(found.text.split())


def _when(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def parse_feed(body: bytes):
    """Returns (total_reported, records). Raises ApiError on an error entry and
    TransientError on a body that is not a feed at all."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise TransientError(f"unparseable feed: {e}") from e
    if root.tag != f"{{{NS['atom']}}}feed":
        raise TransientError(f"not an Atom feed: {root.tag}")

    total_text = _text(root, "opensearch:totalResults")
    total = int(total_text) if total_text else 0

    records = []
    for entry in root.findall("atom:entry", NS):
        raw_id = _text(entry, "atom:id") or ""
        if "/api/errors" in raw_id:
            raise ApiError(_text(entry, "atom:summary") or "unspecified API error")

        primary_node = entry.find("arxiv:primary_category", NS)
        primary = primary_node.get("term") if primary_node is not None else None
        categories = clean_categories(c.get("term", "") for c in entry.findall("atom:category", NS))
        abstract = _text(entry, "atom:summary") or ""
        comment = _text(entry, "arxiv:comment")

        records.append({
            "id": strip_version(raw_id),
            "title": _text(entry, "atom:title") or "",
            "abstract": abstract,
            "authors": [_text(a, "atom:name") or "" for a in entry.findall("atom:author", NS)],
            "primary_category": primary,
            "categories": categories,
            "is_primary": primary == config.CATEGORY,
            "submitted": _when(_text(entry, "atom:published")),
            "updated": _when(_text(entry, "atom:updated")),
            "comment": comment,
            "journal_ref": _text(entry, "arxiv:journal_ref"),
            "doi": _text(entry, "arxiv:doi"),
            "withdrawn": is_withdrawn(abstract, comment),
        })
    return total, records
