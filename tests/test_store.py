from datetime import datetime, timezone

import pytest

from pipeline import store


def rec(i, title="t", day=1):
    t = datetime(2026, 9, day, tzinfo=timezone.utc)
    return {"id": i, "title": title, "abstract": "a", "authors": ["x"], "primary_category": "quant-ph",
            "categories": ["quant-ph"], "is_primary": True, "submitted": t, "updated": t,
            "comment": None, "journal_ref": None, "doi": None, "withdrawn": False}


def test_shards_are_never_overwritten(tmp_path):
    path = tmp_path / "2026" / "2026-09.parquet"
    store.write_shard(path, [rec("a")])
    with pytest.raises(store.ShardExists):
        store.write_shard(path, [rec("b")])


def test_readers_dedupe_by_id_and_later_shards_win(tmp_path):
    store.write_shard(tmp_path / "2026" / "2026-08.parquet", [rec("a", "first"), rec("b")])
    store.write_shard(tmp_path / "2026" / "2026-09.parquet", [rec("a", "second"), rec("c")])
    store.write_shard(tmp_path / "weekly" / "2026-W40.parquet", [rec("c", "weekly"), rec("d")])
    got = {r["id"]: r["title"] for r in store.read_papers(tmp_path)}
    assert got == {"a": "second", "b": "t", "c": "weekly", "d": "t"}


def test_weekly_shards_sort_after_monthly_ones_and_in_week_order(tmp_path):
    for name in ["weekly/2027-W01", "weekly/2026-W52", "2026/2026-12", "2027/2027-01"]:
        store.write_shard(tmp_path / f"{name}.parquet", [rec(name)])
    order = [p.relative_to(tmp_path).as_posix() for p in store.shard_paths(tmp_path)]
    assert order == ["2026/2026-12.parquet", "2027/2027-01.parquet",
                     "weekly/2026-W52.parquet", "weekly/2027-W01.parquet"]


def test_round_trip_keeps_utc_and_lists(tmp_path):
    store.write_shard(tmp_path / "2026" / "2026-09.parquet", [rec("a")])
    row = store.read_papers(tmp_path)[0]
    assert row["submitted"].tzinfo is not None and row["submitted"].utcoffset().total_seconds() == 0
    assert row["authors"] == ["x"] and row["categories"] == ["quant-ph"]
