"""
harvest.py: fetch quant-ph paper metadata from the arXiv API, a month at a time.

    python -m pipeline.harvest                      the whole five-year window
    python -m pipeline.harvest --month 2026-09      one month
    python -m pipeline.harvest --from 2021-10 --to 2026-09

Rules:

  * `cat:quant-ph` returns primary and cross-listed papers alike, which is what
    the radar counts.
  * A window is not trusted until the ids collected cover the total the API
    reported. The API occasionally returns an empty page before the end; that
    page is retried, and if a window still comes up short it is split in half
    and each half harvested on its own, rather than accepting a short month.
  * The query's upper bound is 00:00 on the day after the window, and records are
    then filtered to the window's own dates. That sidesteps the question of
    whether the API's minute-resolution bound includes 23:59:59.
  * Resumable. Each finished month is cached in .local/cache/months/. A re-run
    skips months that were already complete when they were cached and always
    refetches the current one.
  * A month is written to data/papers/YYYY/YYYY-MM.parquet only once it is
    complete (SETTLE_DAYS after it ends, so the last day's announcements are
    out). Those files are never rewritten; papers arXiv announces later than
    that are picked up by the weekly shards.
"""

import argparse
import gzip
import json
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone

from . import config, store
from .arxiv import Client, TransientError, is_withdrawn, log, parse_feed
from .windows import five_year_start, last_complete_week_end, month_end, month_key, months, parse_month

SETTLE_DAYS = 3
EMPTY_PAGE_RETRIES = 3
MAX_SPLIT_DEPTH = 5


class ShortWindow(Exception):
    """A window kept returning fewer papers than the API said it holds."""


def query_url(first: date, last: date, start: int, size: int = config.PAGE_SIZE) -> str:
    upper = last + timedelta(days=1)
    q = f"cat:{config.CATEGORY} AND submittedDate:[{first:%Y%m%d}0000 TO {upper:%Y%m%d}0000]"
    params = {
        "search_query": q,
        "start": start,
        "max_results": size,
        "sortBy": "submittedDate",
        "sortOrder": "ascending",
    }
    return config.API_URL + "?" + urllib.parse.urlencode(params)


def _page(client, first, last, start):
    for attempt in range(1, EMPTY_PAGE_RETRIES + 1):
        total, recs = parse_feed(client.get(query_url(first, last, start)))
        if recs or start >= total:
            return total, recs
        log(f"  empty page at {start} of {total}, retry {attempt}/{EMPTY_PAGE_RETRIES}")
    raise ShortWindow(f"empty page at {start} of {total} for {first}..{last}")


def _page_through(client, first, last):
    total, recs = _page(client, first, last, 0)
    if total > config.API_RESULT_CAP:
        raise ShortWindow(f"{total} results is past the API cap; split the window")
    got = {r["id"]: r for r in recs}
    start = len(recs)
    while start < total:
        page_total, recs = _page(client, first, last, start)
        if not recs:
            break
        for r in recs:
            got[r["id"]] = r
        start += len(recs)
        total = max(total, page_total)
    if len(got) < total:
        raise ShortWindow(f"{len(got)} of {total} papers for {first}..{last}")
    return total, list(got.values())


def harvest_window(client, first: date, last: date, depth: int = 0):
    """All papers submitted from `first` to `last` inclusive (UTC dates).
    Returns (total_reported_by_api, records)."""
    try:
        total, recs = _page_through(client, first, last)
    except ShortWindow as e:
        if depth >= MAX_SPLIT_DEPTH or first == last:
            raise
        mid = first + (last - first) // 2
        log(f"  {e}; splitting into {first}..{mid} and {mid + timedelta(days=1)}..{last}")
        t1, r1 = harvest_window(client, first, mid, depth + 1)
        t2, r2 = harvest_window(client, mid + timedelta(days=1), last, depth + 1)
        merged = {r["id"]: r for r in r1 + r2}
        return t1 + t2, list(merged.values())
    inside = [r for r in recs if first <= r["submitted"].date() <= last]
    return total, inside


# ---------------------------------------------------------------- the cache

def _cache_path(month: date):
    return config.CACHE / "months" / f"{month_key(month)}.json.gz"


def _is_complete(month: date, at: datetime) -> bool:
    return at.date() > month_end(month) + timedelta(days=SETTLE_DAYS)


def _encode(rec):
    out = dict(rec)
    out["submitted"] = rec["submitted"].isoformat()
    out["updated"] = rec["updated"].isoformat()
    return out


def _decode(rec):
    out = dict(rec)
    out["submitted"] = datetime.fromisoformat(rec["submitted"])
    out["updated"] = datetime.fromisoformat(rec["updated"])
    # Re-derived on every read, so a cache written under an older rule never
    # carries that rule forward.
    out["withdrawn"] = is_withdrawn(rec["abstract"], rec["comment"])
    return out


def load_cached(month: date):
    path = _cache_path(month)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        blob = json.load(fh)
    blob["records"] = [_decode(r) for r in blob["records"]]
    blob["fetched_at"] = datetime.fromisoformat(blob["fetched_at"])
    return blob


def save_cached(month: date, blob) -> None:
    path = _cache_path(month)
    path.parent.mkdir(parents=True, exist_ok=True)
    out = dict(blob)
    out["records"] = [_encode(r) for r in blob["records"]]
    out["fetched_at"] = blob["fetched_at"].isoformat()
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump(out, fh)
    tmp.replace(path)


def harvest_month(client, month: date, now: datetime):
    cached = load_cached(month)
    if cached and _is_complete(month, cached["fetched_at"]):
        return cached, True
    last = min(month_end(month), now.date())
    t0 = time.monotonic()
    total, recs = harvest_window(client, month, last)
    blob = {
        "month": month_key(month),
        "fetched_at": now,
        "total_reported": total,
        "seconds": round(time.monotonic() - t0, 1),
        "records": recs,
    }
    save_cached(month, blob)
    return blob, False


def write_month_shard(blob, now: datetime) -> str:
    month = parse_month(blob["month"])
    path = config.PAPERS / f"{month.year:04d}" / f"{blob['month']}.parquet"
    if path.exists():
        return "already written"
    if not _is_complete(month, blob["fetched_at"]):
        return "month not complete yet, cache only"
    store.write_shard(path, blob["records"])
    return f"wrote {path.relative_to(config.ROOT)}"


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.harvest", description=__doc__.split("\n\n")[0])
    ap.add_argument("--month", help="one month, YYYY-MM")
    ap.add_argument("--from", dest="first", help="first month, YYYY-MM")
    ap.add_argument("--to", dest="last", help="last month, YYYY-MM")
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc)
    if args.month:
        first = last = parse_month(args.month)
    else:
        first = parse_month(args.first) if args.first else five_year_start(last_complete_week_end(now))
        last = parse_month(args.last) if args.last else now.date()

    client = Client()
    plan = list(months(first, last))
    log(f"Harvesting {len(plan)} month(s), {month_key(plan[0])} to {month_key(plan[-1])}")
    t_all = time.monotonic()
    for i, month in enumerate(plan, 1):
        try:
            blob, from_cache = harvest_month(client, month, now)
        except TransientError as e:
            log(f"[{i}/{len(plan)}] {month_key(month)}: gave up ({e}). Re-run to resume.")
            raise SystemExit(1)
        n = len(blob["records"])
        how = "cached" if from_cache else f"{blob['seconds']:.0f} s"
        note = write_month_shard(blob, now)
        log(f"[{i}/{len(plan)}] {blob['month']}: {n} papers (API reported {blob['total_reported']}), {how}; {note}")
    log(f"Done in {time.monotonic() - t_all:.0f} s, {client.requests} requests, "
        f"{client.seconds_waiting_on_server:.0f} s of that waiting on arXiv.")


if __name__ == "__main__":
    main()
