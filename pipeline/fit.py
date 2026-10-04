"""
fit.py: find the topics. Laptop only; the weekly job never refits.

    python -m pipeline.fit --version v1

Writes .local/fit/<version>/, which pipeline.label_prep reads. Nothing here is
committed until pipeline.finalize, after the topics have names a person has
checked.

The recipe, and why:

  * Fit set: the five-year window ending at the last complete week, minus the
    two most recent weeks. Those two are held out so the weekly path can be
    tested on papers the model has never seen.
  * Fine topics: UMAP to 8 dimensions (cosine, 15 neighbours, min_dist 0),
    then HDBSCAN with leaf selection, minimum cluster 30 papers. Leaf
    selection keeps the smallest dense groups instead of merging them upwards,
    which is what makes niches like "NV biosensing" (about 60 papers) appear.
    15 neighbours rather than 30 for the same reason: UMAP judges structure
    from that many neighbours, and 30 starts to blur groups of 30.
  * Broad topics: Ward linkage over the fine centroids, cut into a fixed number
    of groups. Every fine topic has exactly one parent, so the two levels
    always agree. Average linkage was tried and left a fifth of the groups as
    single topics.
  * Assignment: model.py. HDBSCAN leaves about half the papers as noise; the
    rule then places each one with its nearest topic if it is close enough.
  * Lineage (from v2 on): each topic is compared with the newest finalised
    model by the papers both assigned (pipeline.lineage), and the labelling
    packets show it, so a topic that continues keeps its name unless its
    content moved.
  * Stability: the fine fit is repeated with two more seeds and topics are
    matched by Hungarian assignment on member overlap (Jaccard). A topic whose
    worst match is under 0.5 is flagged unstable for the labelling review, not
    dropped: these are usually two or three neighbours that different seeds
    split along different lines.

The parameters below gave 398 fine topics, 13.9% unassigned and median
cross-seed Jaccard 0.8 on the October 2026 fit; fit.json records what a run
actually used.
"""

import argparse
import json
import time
from datetime import date, datetime, timedelta, timezone

import numpy as np

from . import config, store
from .arxiv import log
from .embed import DEFAULT_MODEL, MODELS, embed_papers, load_cache
from .embed import _resolve_revision as embedding_revision
from .lineage import compute as compute_lineage
from .model import assign, centroids, thresholds, UNASSIGNED
from .terms import ctfidf, doc_terms
from .windows import five_year_start, last_complete_week_end

HOLDOUT_DAYS = 14
PARAMS = {
    "umap": {"metric": "cosine", "n_neighbors": 15, "n_components": 8, "min_dist": 0.0},
    "hdbscan": {"min_cluster_size": 30, "min_samples": 10, "cluster_selection_method": "leaf"},
    "seeds": [0, 1, 2],
    "broad_groups": 60,
    "fine_target": [300, 450],
}
FIT_ROOT = config.LOCAL / "fit"


def fine_labels(X, seed):
    import umap
    from sklearn.cluster import HDBSCAN

    low = umap.UMAP(random_state=seed, low_memory=True, **PARAMS["umap"]).fit_transform(X)
    return HDBSCAN(**PARAMS["hdbscan"]).fit_predict(low)


def jaccard_matrix(a, b):
    ka, kb = a.max() + 1, b.max() + 1
    both = (a >= 0) & (b >= 0)
    inter = np.zeros((ka, kb))
    np.add.at(inter, (a[both], b[both]), 1)
    sa = np.bincount(a[a >= 0], minlength=ka)[:, None]
    sb = np.bincount(b[b >= 0], minlength=kb)[None, :]
    return inter / np.maximum(sa + sb - inter, 1)


def best_match(a, b):
    from scipy.optimize import linear_sum_assignment

    J = jaccard_matrix(a, b)
    rows, cols = linear_sum_assignment(-J)
    out = np.zeros(J.shape[0])
    out[rows] = J[rows, cols]
    return out


def broad_groups(C, n):
    from scipy.cluster.hierarchy import fcluster, linkage

    return fcluster(linkage(C, method="ward"), n, criterion="maxclust") - 1


def fit(version: str, end: date):
    out = FIT_ROOT / version
    out.mkdir(parents=True, exist_ok=True)
    fit_end = end - timedelta(days=HOLDOUT_DAYS)
    start = five_year_start(end)
    papers = sorted((p for p in store.read_papers(config.PAPERS) if start <= p["submitted"].date() <= fit_end),
                    key=lambda p: p["id"])
    ids, X = embed_papers(papers, DEFAULT_MODEL)
    log(f"Fit set: {len(ids)} papers, {start} to {fit_end}")

    t0 = time.monotonic()
    runs = [fine_labels(X, s) for s in PARAMS["seeds"]]
    log(f"UMAP + HDBSCAN x{len(runs)} in {time.monotonic() - t0:.0f} s")
    raw = runs[0]
    k = raw.max() + 1
    lo, hi = PARAMS["fine_target"]
    if not lo <= k <= hi:
        log(f"WARNING: {k} fine topics, outside the {lo}-{hi} target. Adjust min_cluster_size.")

    C = centroids(X, raw, k)
    thr = thresholds(X, raw, C)
    fine, sim = assign(X, C, thr)

    # Stability is judged on assignments, the thing the page counts.
    others = []
    for lab in runs[1:]:
        kk = lab.max() + 1
        Ck = centroids(X, lab, kk)
        others.append(assign(X, Ck, thresholds(X, lab, Ck))[0])
    worst = np.minimum.reduce([best_match(fine, o) for o in others])

    # Renumber so fine topics run in broad-group order; ids read better that way.
    parent_raw = broad_groups(C, PARAMS["broad_groups"])
    order = np.lexsort((np.arange(k), parent_raw))
    new_of_old = np.empty(k, dtype=np.int32)
    new_of_old[order] = np.arange(k)
    fine = np.where(fine == UNASSIGNED, UNASSIGNED, new_of_old[np.maximum(fine, 0)])
    C, thr, worst = C[order], thr[order], worst[order]
    parent_order = {}
    for g in parent_raw[order]:
        parent_order.setdefault(int(g), len(parent_order))
    parent = np.array([parent_order[int(g)] for g in parent_raw[order]], dtype=np.int32)

    D = doc_terms(papers)
    fine_terms = ctfidf({c: [D[i] for i in np.flatnonzero(fine == c)] for c in range(k)}, top=20)
    broad_of_paper = np.where(fine == UNASSIGNED, UNASSIGNED, parent[np.maximum(fine, 0)])
    nb = parent.max() + 1
    broad_terms = ctfidf({g: [D[i] for i in np.flatnonzero(broad_of_paper == g)] for g in range(nb)}, top=20)
    S = C @ C.T
    np.fill_diagonal(S, -1)
    neighbours = np.argsort(-S, axis=1)[:, :3]

    fid = lambda c: f"t{c + 1:03d}"
    bid = lambda g: f"b{g + 1:02d}"
    sizes = np.bincount(fine[fine >= 0], minlength=k)
    draft = {
        "fine": [{
            "id": fid(c), "parent": bid(int(parent[c])), "size": int(sizes[c]),
            "terms": [t for t, _ in fine_terms[c]], "neighbours": [fid(int(n)) for n in neighbours[c]],
            "stability": round(float(worst[c]), 3), "unstable": bool(worst[c] < 0.5),
        } for c in range(k)],
        "broad": [{
            "id": bid(g), "children": [fid(c) for c in np.flatnonzero(parent == g)],
            "size": int(sizes[parent == g].sum()), "terms": [t for t, _ in broad_terms[g]],
        } for g in range(nb)],
    }

    previous = sorted((p.name for p in (config.DATA / "model").glob("v*") if p.name != version),
                      key=lambda v: int(v[1:]))
    if previous:
        from . import summary
        prev = previous[-1]
        old_assign, _ = summary.read_assignments(prev)
        old_names = {t["id"]: t["name"] for t in
                     json.loads((config.DATA / "model" / prev / "topics.json").read_text())["fine"]}
        lin = compute_lineage({i: (None if f == UNASSIGNED else fid(int(f))) for i, f in zip(ids, fine)}, old_assign)
        for t in draft["fine"]:
            L = lin.get(t["id"], {"kind": "new", "from": []})
            t["lineage"] = {"version": prev, "kind": L["kind"], "from": L["from"],
                            "names": [old_names[o] for o in L["from"]]}
        log(f"Lineage against {prev}: " + ", ".join(
            f"{k} {sum(1 for t in draft['fine'] if t['lineage']['kind'] == k)}"
            for k in ("continues", "split", "merged", "new")))

    np.save(out / "centroids.npy", C)
    np.save(out / "thresholds.npy", thr)
    np.save(out / "fine.npy", fine)
    np.save(out / "sim.npy", sim)
    (out / "ids.json").write_text(json.dumps(ids))
    (out / "draft.json").write_text(json.dumps(draft, indent=1))
    meta = {
        "version": version,
        "fitted_on": datetime.now(timezone.utc).date().isoformat(),
        "window": [start.isoformat(), fit_end.isoformat()],
        "holdout": [(fit_end + timedelta(days=1)).isoformat(), end.isoformat()],
        "n_papers": len(ids),
        "embedding_model": MODELS[DEFAULT_MODEL]["name"],
        "revision": embedding_revision(DEFAULT_MODEL),
        "params": PARAMS,
        "threshold": {"percentile": 5, "floor": 0.80},
        "n_fine": int(k), "n_broad": int(nb),
        "unassigned": round(float(np.mean(fine == UNASSIGNED)), 4),
        "stable_topics": int(np.sum(worst >= 0.5)),
    }
    (out / "fit.json").write_text(json.dumps(meta, indent=1))
    log(f"{k} fine topics in {nb} broad groups; {meta['unassigned']:.1%} unassigned; "
        f"{meta['stable_topics']} of {k} stable across seeds. Written to {out.relative_to(config.ROOT)}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.fit")
    ap.add_argument("--version", required=True)
    ap.add_argument("--end", help="last complete week's Sunday, YYYY-MM-DD (default: now)")
    args = ap.parse_args(argv)
    end = date.fromisoformat(args.end) if args.end else last_complete_week_end(datetime.now(timezone.utc))
    fit(args.version, end)


if __name__ == "__main__":
    main()
