"""
finalize.py: turn a reviewed fit into a model version and assign the backfill.

    python -m pipeline.finalize --version v1

Reads .local/fit/<version>/ (pipeline.fit) and labels/<version>.json (names a
person has checked). Writes:

    data/model/<version>/model.json       embedding model, revision, window, params
    data/model/<version>/centroids.npy    float32, one row per fine topic, t001 first
    data/model/<version>/thresholds.json  per-topic assignment thresholds
    data/model/<version>/topics.json      facets, broad and fine topics with labels
    data/model/<version>/typical.json     6 typical papers per fine topic (MMR)
    data/assign/<version>/backfill.parquet  id, topic (null if unassigned), similarity;
                                          its metadata says how far it reaches ("through")
    data/pool/<YYYY-Www>.npz              embeddings of the backfill's unassigned papers
                                          from its last 12 weeks, so the first weekly
                                          run has a pool to look for emerging groups in

Rules:

  * A model version is immutable once written: finalize refuses to touch an
    existing data/model/<version>/. A new fit gets a new version.
  * The backfill covers every paper in the monthly shards submitted on or
    before the last day of the fit window. Later papers, the holdout included,
    belong to the weekly job, so it can be tested on papers it has not seen.
  * Assignment is model.assign, the same rule the weekly job uses. For the fit
    papers it must reproduce the fit's own assignments exactly; finalize checks.
  * Typical papers are chosen here, where the embeddings are, by the same
    diversified nearest-to-centroid rule (MMR) the labelling packets used, so
    the page shows the kind of paper the name was written from.
"""

import argparse
import json
from datetime import date

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from datetime import timedelta

from . import config, emerging, store
from .arxiv import log
from .embed import DEFAULT_MODEL, embed_papers
from .fit import FIT_ROOT
from .label_prep import mmr
from .model import UNASSIGNED, assign

TYPICAL = 6

MODEL_ROOT = config.DATA / "model"
ASSIGN_ROOT = config.DATA / "assign"
ASSIGN_SCHEMA = pa.schema([
    ("id", pa.string()),
    ("topic", pa.string()),
    ("similarity", pa.float32()),
])


def check_labels(labels, draft):
    facets = set(labels["facets"])
    fine_ids = [t["id"] for t in draft["fine"]]
    broad_ids = [b["id"] for b in draft["broad"]]
    missing = [i for i in fine_ids if i not in labels["fine"]] + [i for i in broad_ids if i not in labels["broad"]]
    if missing:
        raise SystemExit(f"Labels missing for {len(missing)} topics, e.g. {missing[:5]}")
    bad = [i for i in fine_ids if labels["fine"][i]["facet"] not in facets]
    if bad:
        raise SystemExit(f"Facet not in the facet list for {bad[:5]}")


def topics_doc(labels, draft):
    fine = []
    for t in draft["fine"]:
        lab = labels["fine"][t["id"]]
        fine.append({
            "id": t["id"], "parent": t["parent"],
            "name": lab["name"], "description": lab["description"], "facet": lab["facet"],
            "ml_adjacent": lab["ml_adjacent"], "housekeeping": lab["coherence"] == "housekeeping",
            "coherence": lab["coherence"], "unstable": t["unstable"], "stability": t["stability"],
            "terms": t["terms"], "neighbours": t["neighbours"], "lineage": t.get("lineage"),
        })
    broad = [{"id": b["id"], "name": labels["broad"][b["id"]]["name"],
              "description": labels["broad"][b["id"]]["description"],
              "children": b["children"], "terms": b["terms"]} for b in draft["broad"]]
    return {"facets": labels["facets"], "broad": broad, "fine": fine}


def write_assignments(path, ids, topic, sim, fid, through: date):
    table = pa.Table.from_pydict({
        "id": list(ids),
        "topic": [None if t == UNASSIGNED else fid[t] for t in topic],
        "similarity": np.asarray(sim, dtype=np.float32),
    }, schema=ASSIGN_SCHEMA.with_metadata({"through": through.isoformat()}))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)


def finalize(version: str):
    fit_dir = FIT_ROOT / version
    model_dir = MODEL_ROOT / version
    backfill = ASSIGN_ROOT / version / "backfill.parquet"
    if model_dir.exists() or backfill.exists():
        raise SystemExit(f"{version} is already finalised; model versions are immutable. Fit a new version.")

    meta = json.loads((fit_dir / "fit.json").read_text())
    draft = json.loads((fit_dir / "draft.json").read_text())
    labels = json.loads((config.ROOT / "labels" / f"{version}.json").read_text())
    check_labels(labels, draft)
    C = np.load(fit_dir / "centroids.npy").astype(np.float32)
    thr = np.load(fit_dir / "thresholds.npy").astype(np.float32)
    fid = [t["id"] for t in draft["fine"]]

    fit_end = date.fromisoformat(meta["window"][1])
    seed_path = emerging.POOL / f"{emerging.iso_week(fit_end)}.npz"
    if seed_path.exists():
        raise SystemExit(f"{seed_path} already exists; pool files are immutable.")

    # Every monthly-shard paper up to the end of the fit window.
    monthly = [p for p in store.shard_paths(config.PAPERS) if p.parent.name != "weekly"]
    papers = {}
    for path in monthly:
        for row in pq.read_table(path).to_pylist():
            if row["submitted"].date() <= fit_end:
                papers[row["id"]] = row
    papers = sorted(papers.values(), key=lambda p: p["id"])
    ids, X = embed_papers(papers, DEFAULT_MODEL)
    topic, sim = assign(X, C, thr)

    # The fit's own assignments must come back unchanged.
    fit_ids = json.loads((fit_dir / "ids.json").read_text())
    fit_topic = np.load(fit_dir / "fine.npy")
    row = {i: n for n, i in enumerate(ids)}
    mine = topic[[row[i] for i in fit_ids]]
    if not np.array_equal(mine, fit_topic):
        raise SystemExit(f"Backfill disagrees with the fit on {int((mine != fit_topic).sum())} papers")

    model_dir.mkdir(parents=True)
    model = {k: meta[k] for k in ("version", "fitted_on", "window", "holdout", "n_papers",
                                  "embedding_model", "revision", "params", "threshold", "n_fine", "n_broad")}
    (model_dir / "model.json").write_text(json.dumps(model, indent=1) + "\n")
    np.save(model_dir / "centroids.npy", C)
    (model_dir / "thresholds.json").write_text(
        json.dumps({i: round(float(t), 6) for i, t in zip(fid, thr)}, indent=1) + "\n")
    (model_dir / "topics.json").write_text(
        json.dumps(topics_doc(labels, draft), indent=1, ensure_ascii=False) + "\n")

    typical = {}
    for c, t in enumerate(fid):
        members = np.flatnonzero(topic == c)
        typical[t] = [ids[i] for i in mmr(X, members, C[c], TYPICAL)]
    (model_dir / "typical.json").write_text(json.dumps(typical, indent=1) + "\n")

    write_assignments(backfill, ids, topic, sim, fid, fit_end)

    pool_start = fit_end - timedelta(days=7 * emerging.WEEKS - 1)
    seed = [n for n, p in enumerate(papers) if topic[n] == UNASSIGNED and p["submitted"].date() >= pool_start]
    emerging.write_pool(emerging.iso_week(fit_end), [ids[n] for n in seed], X[seed])
    log(f"{version}: {len(ids)} papers assigned up to {fit_end}, "
        f"{np.mean(topic == UNASSIGNED):.1%} unassigned. Written to "
        f"{model_dir.relative_to(config.ROOT)} and {backfill.relative_to(config.ROOT)}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.finalize")
    ap.add_argument("--version", required=True)
    finalize(ap.parse_args(argv).version)


if __name__ == "__main__":
    main()
