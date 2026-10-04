"""End-to-end weekly runs on a small synthetic data branch, in a temp folder.

Two topics ("alpha" and "beta" papers), twelve weeks of backfill, and a fake
embedder that maps each paper's text to a fixed vector. arXiv is faked too."""

import json
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pyarrow.parquet as pq
import pytest

from pipeline import config, emerging, finalize, store, summary, weekly
from pipeline.arxiv import TransientError

END = date(2026, 9, 27)        # a Sunday; the week the run covers
BACKFILL_END = date(2026, 9, 20)


def vec(text):
    v = np.array([1.0, 0, 0, 0]) if "alpha" in text else np.array([0, 1.0, 0, 0]) if "beta" in text \
        else np.array([0, 0, 1.0, 0])
    return v.astype(np.float32)


def make_paper(i, day, kind, primary=True):
    return {"id": i, "title": f"{kind} result {i}", "abstract": f"we study {kind} systems in depth",
            "authors": [f"Author {i}"], "primary_category": "quant-ph" if primary else "cond-mat.str-el",
            "categories": ["quant-ph"] if primary else ["cond-mat.str-el", "quant-ph"], "is_primary": primary,
            "submitted": datetime(day.year, day.month, day.day, 10, tzinfo=timezone.utc),
            "updated": datetime(day.year, day.month, day.day, 10, tzinfo=timezone.utc),
            "comment": None, "journal_ref": None, "doi": None, "withdrawn": False}


def papers_between(first, last, per_day, start_n=0):
    out, n, d = [], start_n, first
    while d <= last:
        for k in range(per_day):
            kind = ["alpha", "beta", "gamma"][(n + k) % 3]
            out.append(make_paper(f"2609.{n:05d}", d, kind, primary=(n % 4 != 0)))
            n += 1
        d += timedelta(days=1)
    return out


@pytest.fixture
def branch(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr(config, "DATA", data)
    monkeypatch.setattr(config, "PAPERS", data / "papers")
    monkeypatch.setattr(emerging, "POOL", data / "pool")
    monkeypatch.setattr(emerging, "STATE", data / "emerging" / "state.json")
    monkeypatch.setattr(finalize, "MODEL_ROOT", data / "model")
    monkeypatch.setattr(finalize, "ASSIGN_ROOT", data / "assign")
    monkeypatch.setattr(weekly, "MODEL_ROOT", data / "model")
    monkeypatch.setattr(weekly, "ASSIGN_ROOT", data / "assign")
    monkeypatch.setattr(weekly, "pin_revision", lambda key, rev: None)
    monkeypatch.setattr(weekly, "embed_papers",
                        lambda ps, key: ([p["id"] for p in ps], np.stack([vec(p["title"]) for p in ps])))

    # Twelve weeks of backfill up to BACKFILL_END, plus the week after already
    # sitting in a monthly shard but unassigned (like the real holdout).
    first = BACKFILL_END - timedelta(days=83)
    back = papers_between(first, BACKFILL_END, 3)
    hold = papers_between(BACKFILL_END + timedelta(days=1), END, 3, start_n=len(back))
    store.write_shard(data / "papers" / "2026" / "2026-09.parquet", back + hold)

    mdir = data / "model" / "v1"
    mdir.mkdir(parents=True)
    C = np.stack([vec("alpha"), vec("beta")])
    np.save(mdir / "centroids.npy", C)
    (mdir / "thresholds.json").write_text(json.dumps({"t001": 0.9, "t002": 0.9}))
    (mdir / "model.json").write_text(json.dumps({"version": "v1", "fitted_on": "2026-09-21",
                                                 "embedding_model": "fake", "revision": "abc"}))
    fine = [{"id": t, "parent": "b01", "name": n, "description": "Papers that test.", "facet": "Foundations",
             "ml_adjacent": False, "housekeeping": False, "coherence": "coherent", "unstable": False,
             "stability": 1.0, "terms": [n.lower()], "neighbours": [o], "lineage": None}
            for t, n, o in (("t001", "Alpha", "t002"), ("t002", "Beta", "t001"))]
    (mdir / "topics.json").write_text(json.dumps({"facets": ["Foundations"], "fine": fine, "broad": [
        {"id": "b01", "name": "Both", "description": "Papers on both.", "children": ["t001", "t002"], "terms": ["x"]}]}))
    (mdir / "typical.json").write_text(json.dumps({"t001": [back[0]["id"]], "t002": [back[1]["id"]]}))
    ids = [p["id"] for p in back]
    X = np.stack([vec(p["title"]) for p in back])
    topic, sim = finalize.assign(X, C, np.array([0.9, 0.9], np.float32))
    finalize.write_assignments(data / "assign" / "v1" / "backfill.parquet", ids, topic, sim,
                               ["t001", "t002"], BACKFILL_END)
    main = tmp_path / "main"
    return {"data": data, "main": main, "back": back, "hold": hold}


class FakeClient:
    def __init__(self, papers=(), fail=False):
        self.papers, self.fail, self.requests = list(papers), fail, 1

    def __call__(self):
        return self


def fake_harvest(papers=(), fail=False):
    def harvest_window(client, first, last):
        if fail:
            raise TransientError("HTTP 503 after 8 attempts")
        inside = [p for p in papers if first <= p["submitted"].date() <= last]
        return len(inside), inside
    return harvest_window


def files(root):
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def test_weekly_assigns_the_holdout_and_a_second_run_adds_nothing(branch, monkeypatch):
    late = [make_paper("2608.99999", date(2026, 8, 12), "beta")]  # a moderation-delayed paper
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest(branch["back"] + branch["hold"] + late))
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert ok, run.lines
    radar = json.loads((branch["main"] / weekly.DATA_OUT / "radar.json").read_text())
    assert radar["meta"]["data_through"] == END.isoformat()
    assert radar["meta"]["n_papers_total"] == len(branch["back"]) + len(branch["hold"]) + 1
    shard = branch["data"] / "papers" / "weekly" / "2026-W39.parquet"
    assert pq.read_table(shard).column("id").to_pylist() == ["2608.99999"]
    assigned, through = summary.read_assignments("v1")
    assert through == END and assigned["2608.99999"] == "t002"

    before = {f: (branch["data"] / f).read_bytes() for f in files(branch["data"])}
    main_before = {f: (branch["main"] / f).read_bytes() for f in files(branch["main"])}
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert ok and any("unchanged" in line for line in run.lines)
    assert {f: (branch["data"] / f).read_bytes() for f in files(branch["data"])} == before
    assert {f: (branch["main"] / f).read_bytes() for f in files(branch["main"])} == main_before


def test_arxiv_error_aborts_and_writes_nothing(branch, monkeypatch):
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest(fail=True))
    before = files(branch["data"])
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert not ok and "arXiv error" in run.lines[-1]
    assert files(branch["data"]) == before and not branch["main"].exists()


def test_a_thin_week_aborts_and_rolls_back(branch, monkeypatch):
    # Drop most of the final week, so it falls under half the trailing median.
    thin = [p for p in branch["hold"] if p["submitted"].date() <= END - timedelta(days=6)]
    papers_dir = branch["data"] / "papers" / "2026"
    (papers_dir / "2026-09.parquet").unlink()
    store.write_shard(papers_dir / "2026-09.parquet", branch["back"] + thin)
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest())
    before = files(branch["data"])
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert not ok and "under half" in run.lines[-1]
    assert files(branch["data"]) == before, "the assignment shard this run wrote was not removed"


def test_a_shrinking_total_aborts(branch, monkeypatch):
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest())
    out = branch["main"] / weekly.DATA_OUT
    out.mkdir(parents=True)
    (out / "radar.json").write_text(json.dumps({"schema": 1, "meta": {"n_papers_total": 10 ** 6}}))
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert not ok and "total papers fell" in run.lines[-1]
    assert json.loads((out / "radar.json").read_text())["meta"]["n_papers_total"] == 10 ** 6


def test_an_invalid_summary_aborts(branch, monkeypatch):
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest())
    real_build = summary.build

    def broken(ctx):
        radar, details = real_build(ctx)
        radar["views"]["1M"]["all"]["topics"][0][4] = 1.5
        return radar, details
    monkeypatch.setattr(summary, "build", broken)
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2026, 9, 29))
    assert not ok and "failed validation" in run.lines[-1] and "share outside" in run.lines[-1]


def test_refit_warning_when_the_model_is_old(branch, monkeypatch):
    monkeypatch.setattr(weekly, "harvest_window", fake_harvest())
    ok, run = weekly.run_week(END, branch["main"], client=FakeClient(), today=date(2027, 1, 15))
    assert ok and any(line.startswith("Warning: The topic model is") for line in run.lines)
    # A third of the synthetic papers ("gamma") never fit a topic: above 25% every week.
    assert any("unassigned for 4 weeks running" in line for line in run.lines)
