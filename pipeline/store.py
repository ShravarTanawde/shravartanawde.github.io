"""
store.py: reading and writing paper shards.

Rules:

  * A committed binary file is never rewritten. Git keeps every version, and
    Parquet is already compressed, so a shard rewritten weekly would grow the
    repository by its full size every week. write_shard() refuses to overwrite.
  * Readers dedupe by arXiv id and a later shard wins: monthly backfill files
    first, in date order, then weekly shards in ISO-week order.
  * Timestamps are UTC throughout.
"""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema([
    ("id", pa.string()),
    ("title", pa.string()),
    ("abstract", pa.string()),
    ("authors", pa.list_(pa.string())),
    ("primary_category", pa.string()),
    ("categories", pa.list_(pa.string())),
    ("is_primary", pa.bool_()),
    ("submitted", pa.timestamp("s", tz="UTC")),
    ("updated", pa.timestamp("s", tz="UTC")),
    ("comment", pa.string()),
    ("journal_ref", pa.string()),
    ("doi", pa.string()),
    ("withdrawn", pa.bool_()),
])


class ShardExists(Exception):
    pass


def write_shard(path: Path, records) -> None:
    if path.exists():
        raise ShardExists(f"{path} is already written; committed shards are immutable")
    rows = sorted(records, key=lambda r: (r["submitted"], r["id"]))
    table = pa.Table.from_pylist(rows, schema=SCHEMA)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)


def shard_paths(papers_dir: Path):
    monthly = sorted(p for p in papers_dir.glob("[0-9][0-9][0-9][0-9]/*.parquet"))
    weekly = sorted((papers_dir / "weekly").glob("*.parquet"))
    return monthly + weekly


def read_papers(papers_dir: Path):
    """Every paper across all shards, one row per id, later shards winning."""
    by_id = {}
    for path in shard_paths(papers_dir):
        for row in pq.read_table(path).to_pylist():
            by_id[row["id"]] = row
    return list(by_id.values())
