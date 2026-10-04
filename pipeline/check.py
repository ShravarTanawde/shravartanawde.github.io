"""
check.py: integrity checks on the committed paper shards. No network.

    python -m pipeline.check

Fails if a month in the five-year window has no shard, if an id appears in two
monthly shards, if a paper sits in a shard for a month it was not submitted in,
or if a required field is empty. Prints per-month counts and the withdrawn
total, so a month that is suspiciously small stands out by eye as well.
"""

import sys
from collections import Counter
from datetime import datetime, timezone

import pyarrow.parquet as pq

from . import config
from .windows import five_year_start, last_complete_week_end, month_key, months

REQUIRED = ("id", "title", "abstract", "primary_category", "submitted")


def main(argv=None):
    now = datetime.now(timezone.utc)
    end = last_complete_week_end(now)
    expected = [month_key(m) for m in months(five_year_start(end), end)]
    problems = []
    seen = Counter()
    rows_total = withdrawn = cross = 0
    per_month = {}

    for key in expected:
        path = config.PAPERS / key[:4] / f"{key}.parquet"
        if not path.exists():
            problems.append(f"{key}: no shard")
            continue
        rows = pq.read_table(path).to_pylist()
        per_month[key] = len(rows)
        for r in rows:
            seen[r["id"]] += 1
            if month_key(r["submitted"]) != key:
                problems.append(f"{key}: {r['id']} was submitted {r['submitted']:%Y-%m-%d}")
            for f in REQUIRED:
                if not r[f]:
                    problems.append(f"{key}: {r['id']} has no {f}")
            if config.CATEGORY not in r["categories"]:
                problems.append(f"{key}: {r['id']} does not carry {config.CATEGORY}")
        rows_total += len(rows)
        withdrawn += sum(r["withdrawn"] for r in rows)
        cross += sum(not r["is_primary"] for r in rows)

    dupes = [i for i, n in seen.items() if n > 1]
    if dupes:
        problems.append(f"{len(dupes)} ids in more than one monthly shard, e.g. {', '.join(dupes[:5])}")

    for key, n in per_month.items():
        print(f"{key}  {n:5d}")
    print(f"\n{len(per_month)} of {len(expected)} months, {rows_total} papers, "
          f"{len(seen)} unique ids, {cross} cross-listed ({cross / max(rows_total, 1):.1%}), "
          f"{withdrawn} flagged withdrawn")
    if problems:
        print(f"\n{len(problems)} problem(s):", *problems[:40], sep="\n  ")
        sys.exit(1)
    print("No problems found.")


if __name__ == "__main__":
    main()
