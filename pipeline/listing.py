"""
listing.py: compare a harvested month against arXiv's own monthly listing.

    python -m pipeline.listing 2026-09               totals only
    python -m pipeline.listing --reconcile 2026-09   paper by paper

The listing page at arxiv.org/list/quant-ph/YYYY-MM states "Total of N entries",
cross-lists included. It groups papers by announcement date, while the harvest
groups them by first-submission date, so the two totals differ by the papers
that straddle the month: some submitted earlier and announced in this month
(weekend boundaries, and papers held in moderation for weeks), and some
submitted in this month and announced in the next. The totals usually agree
within about 2%.

--reconcile does not stop at the totals. It pulls every id from the listing,
looks up the ones the harvest lacks, and sorts every difference into one of
those explained groups. Anything left over is a paper the harvest should have
returned and did not, and that is the number that has to be zero.

From October 2026 the listing pages often answer HTTP 406 to Python's HTTP
client for minutes at a time while curl gets them at once. If that happens,
fetch the pages with curl into .local/listings/<YYYY-MM>-<skip>.html (skip 0,
1000, ...; the first one also serves the total) and this reads them from there.
The API lookups are unaffected.

arXiv assigns an id when it announces a paper, so an id's YYMM is its
announcement month. That is how a harvested paper missing from the listing is
told apart: if its id belongs to a later month, it was announced later.
"""

import argparse
import re
import sys
import urllib.parse
from datetime import date

from . import config
from .arxiv import Client, parse_feed
from .harvest import load_cached
from .windows import month_end, parse_month

TOTAL = re.compile(r"Total of\s+([\d,]+)\s+entries", re.I)
ABS_ID = re.compile(r'href\s*=\s*"/abs/(\d{4}\.\d{4,5})(?:v\d+)?"')
LISTING_PAGE = 1000  # the listing refuses (HTTP 406) a much larger page
LOOKUP_BATCH = 100


def _listing_html(client, key, skip, show):
    saved = config.LOCAL / "listings" / f"{key}-{skip}.html"
    if saved.exists():
        return saved.read_text(encoding="utf-8", errors="replace")
    url = config.LISTING_URL.format(month=key) + f"?skip={skip}&show={show}"
    return client.get(url, accept="text/html").decode("utf-8", "replace")


def listing_total(client, key: str) -> int:
    html = _listing_html(client, key, 0, 25)
    m = TOTAL.search(html)
    if not m:
        raise SystemExit(f"No 'Total of N entries' on the {key} listing; the page layout may have changed.")
    return int(m.group(1).replace(",", ""))


def listing_ids(client, key: str):
    total = listing_total(client, key)
    ids = []
    for skip in range(0, total, LISTING_PAGE):
        ids += ABS_ID.findall(_listing_html(client, key, skip, LISTING_PAGE))
    ids = list(dict.fromkeys(ids))
    if len(ids) != total:
        raise SystemExit(f"{key}: read {len(ids)} ids from the listing but it says {total}.")
    return ids


def lookup(client, ids):
    out = {}
    for i in range(0, len(ids), LOOKUP_BATCH):
        batch = ids[i:i + LOOKUP_BATCH]
        url = config.API_URL + "?" + urllib.parse.urlencode({"id_list": ",".join(batch), "max_results": len(batch)})
        for r in parse_feed(client.get(url))[1]:
            out[r["id"]] = r
    return out


def id_month(arxiv_id: str) -> date:
    return date(2000 + int(arxiv_id[:2]), int(arxiv_id[2:4]), 1)


def reconcile(client, key: str, records):
    first = parse_month(key)
    last = month_end(first)
    ours = {r["id"]: r for r in records}
    theirs = listing_ids(client, key)
    only_listing = [i for i in theirs if i not in ours]
    only_harvest = [i for i in ours if i not in set(theirs)]

    found = lookup(client, only_listing)
    earlier = [i for i in only_listing if i in found and found[i]["submitted"].date() < first]
    missed = [i for i in only_listing if i not in earlier]
    later = [i for i in only_harvest if id_month(i) > first]
    odd = [i for i in only_harvest if i not in later]

    return {
        "harvested": len(ours),
        "listing": len(theirs),
        "submitted_earlier_announced_this_month": len(earlier),
        "submitted_this_month_announced_later": len(later),
        "in_listing_but_missed": missed,
        "harvested_but_unexplained": odd,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.listing")
    ap.add_argument("--reconcile", action="store_true", help="explain the gap paper by paper")
    ap.add_argument("months", nargs="+", help="YYYY-MM")
    args = ap.parse_args(argv)
    client = Client()
    bad = False
    for key in args.months:
        cached = load_cached(parse_month(key))
        if not cached:
            print(f"{key}: not harvested yet", file=sys.stderr)
            bad = True
            continue
        ours = len(cached["records"])
        if not args.reconcile:
            theirs = listing_total(client, key)
            gap = (ours - theirs) / theirs * 100
            bad |= abs(gap) > 2.0
            print(f"{key}: harvested {ours}, listing says {theirs}, gap {gap:+.2f}%")
            continue
        r = reconcile(client, key, cached["records"])
        balance = r["harvested"] - r["submitted_this_month_announced_later"] + r["submitted_earlier_announced_this_month"]
        print(f"{key}: harvested {r['harvested']}, listing {r['listing']}; "
              f"{r['submitted_earlier_announced_this_month']} submitted earlier and announced this month, "
              f"{r['submitted_this_month_announced_later']} announced later; "
              f"missed {len(r['in_listing_but_missed'])}, unexplained {len(r['harvested_but_unexplained'])}")
        if r["in_listing_but_missed"] or r["harvested_but_unexplained"] or balance != r["listing"]:
            bad = True
            print(f"  missed: {' '.join(r['in_listing_but_missed'][:20])}")
            print(f"  unexplained: {' '.join(r['harvested_but_unexplained'][:20])}")
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
