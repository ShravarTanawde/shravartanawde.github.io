"""
emerging.py: groups of unassigned papers that keep landing near each other.

    python -m pipeline.emerging            (normally run by pipeline.weekly)

Rules:

  * The pool is every paper from the last 12 complete weeks that the current
    model leaves unassigned. Its embeddings live in data/pool/, one file per
    weekly run, because the Action has no embedding cache to read them from.
    Pool files are binary and append-only, like every other shard.
  * The pool is projected to 5 dimensions with UMAP and HDBSCAN finds dense
    groups there (min_cluster_size 8, min_samples 4). Run directly on the
    384-dimensional vectors, HDBSCAN returns one or two loose blobs of
    unrelated leftovers, because distances in that many dimensions barely vary.
  * A group is kept only if it passes all of these:
      - at least 8 papers, across at least 3 distinct ISO weeks;
      - no single author on more than half of its papers: one group's paper
        series is not a field forming;
      - at least as tight as nine in ten existing topics (median similarity to
        its own centre, against the 10th percentile of the topics' medians), so
        a loose collection of leftovers is not shown as a field;
      - one of its top terms appears in at least half of its papers and in at
        most a tenth of the rest of the pool, so the papers visibly share a
        phrase that sets them apart ("locally testable", not "model").
  * A group keeps its id and first-seen date from week to week when it shares
    at least 30% of its papers (Jaccard) with one of last week's groups.
  * Names are 4 of the group's top c-TF-IDF terms against the rest of the
    pool, the distinctive shared ones first (see the last rule below), so a
    name leads with what sets the group apart rather than with "model".
    Nothing here writes prose; the Action must never generate a name.
  * Running twice for the same week gives the same result: the state file keeps
    the previous week's groups, and a repeat run matches against those.
"""

import json
from collections import Counter
from datetime import date, timedelta

import numpy as np

from . import config
from .arxiv import log
from .terms import ctfidf, doc_terms

POOL = config.DATA / "pool"
STATE = config.DATA / "emerging" / "state.json"
WEEKS = 12
MIN_PAPERS = 8
MIN_WEEKS = 3
MAX_AUTHOR_SHARE = 0.5
MATCH_JACCARD = 0.3
TIGHTNESS_PERCENTILE = 10
MIN_TERM_COVER = 0.5
MAX_TERM_ELSEWHERE = 0.1


class PoolExists(Exception):
    pass


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y:04d}-W{w:02d}"


def free_path(folder, stem: str, suffix: str):
    """folder/stem+suffix, or stem-2, stem-3... if a run this week already
    wrote one: binary shards are never overwritten, so a second run that finds
    late papers adds a file instead."""
    path, k = folder / f"{stem}{suffix}", 2
    while path.exists():
        path, k = folder / f"{stem}-{k}{suffix}", k + 1
    return path


def write_pool(week: str, ids, X, path=None):
    path = path or POOL / f"{week}.npz"
    if path.exists():
        raise PoolExists(f"{path} is already written; pool files are immutable")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.savez_compressed(f, ids=np.array(ids, dtype=str), vectors=np.asarray(X, dtype=np.float16))
    tmp.replace(path)
    return path


def read_pool():
    """{id: unit vector} across every pool file; a later file wins."""
    out = {}
    for path in sorted(POOL.glob("*.npz")):
        with np.load(path) as z:
            for i, v in zip(z["ids"], z["vectors"]):
                v = v.astype(np.float32)
                out[str(i)] = v / np.linalg.norm(v)
    return out


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"as_of": None, "next_id": 1, "candidates": [], "previous": None}


def cluster(X, seed=0):
    import umap
    from sklearn.cluster import HDBSCAN

    if len(X) < 4 * MIN_PAPERS:
        return np.full(len(X), -1)
    low = umap.UMAP(n_components=5, metric="cosine", n_neighbors=15, min_dist=0.0,
                    random_state=seed).fit_transform(X)
    return HDBSCAN(min_cluster_size=MIN_PAPERS, min_samples=4, copy=True).fit_predict(low)


def tightness(X):
    centre = X.mean(0)
    centre /= np.linalg.norm(centre)
    return float(np.median(X @ centre))


def tightness_floor(topic_of, similarity):
    """10th percentile, across topics, of each topic's median member similarity."""
    by = {}
    for t, s in zip(topic_of, similarity):
        if t is not None:
            by.setdefault(t, []).append(s)
    return float(np.percentile([np.median(v) for v in by.values()], TIGHTNESS_PERCENTILE))


def keep_group(papers):
    weeks = {iso_week(p["submitted"].date()) for p in papers}
    if len(papers) < MIN_PAPERS or len(weeks) < MIN_WEEKS:
        return False
    authors = Counter(a for p in papers for a in set(p["authors"]))
    return not authors or max(authors.values()) <= MAX_AUTHOR_SHARE * len(papers)


def name_terms(ranked, n=4):
    """Top n terms, with a word dropped when a phrase in the list contains it
    ("monte carlo", not "monte", "carlo" and "monte carlo")."""
    phrases = [t for t in ranked if " " in t]
    keep = [t for t in ranked if " " in t or not any(t in ph.split(" ") for ph in phrases)]
    return keep[:n]


def jaccard(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if a | b else 0.0


def match(groups, previous, next_id, as_of):
    """Give each group an id: last week's if it overlaps enough, else a new one."""
    pairs = sorted(((jaccard(g, p["paper_ids"]), gi, pi)
                    for gi, g in enumerate(groups) for pi, p in enumerate(previous)), reverse=True)
    taken_g, taken_p, ident = set(), set(), {}
    for j, gi, pi in pairs:
        if j < MATCH_JACCARD:
            break
        if gi in taken_g or pi in taken_p:
            continue
        taken_g.add(gi)
        taken_p.add(pi)
        ident[gi] = (previous[pi]["id"], previous[pi]["first_seen"])
    for gi in range(len(groups)):
        if gi not in ident:
            ident[gi] = (f"e{next_id:03d}", as_of.isoformat())
            next_id += 1
    return ident, next_id


def find(as_of: date, papers_by_id, unassigned_ids, pool, state, floor):
    """The candidates for the 12 weeks ending on as_of (a Sunday)."""
    start = as_of - timedelta(days=7 * WEEKS - 1)
    ids = sorted(i for i in unassigned_ids if i in pool and i in papers_by_id
                 and start <= papers_by_id[i]["submitted"].date() <= as_of)
    base = state["previous"] if state.get("as_of") == as_of.isoformat() else state
    previous = (base or {}).get("candidates", [])
    next_id = (base or {}).get("next_id", 1)
    groups, terms, rejected = [], {}, Counter()
    if len(ids) >= MIN_PAPERS:
        X = np.stack([pool[i] for i in ids])
        labels = cluster(X)
        all_docs = dict(zip(ids, doc_terms([papers_by_id[i] for i in ids])))
        found = [[ids[k] for k in np.flatnonzero(labels == c)] for c in sorted(set(labels) - {-1})]
        docs = {gi: [all_docs[i] for i in g] for gi, g in enumerate(found)}
        docs["rest"] = [all_docs[i] for i, lab in zip(ids, labels) if lab == -1]
        found_terms = ctfidf(docs, top=10, min_df=2)
        for gi, g in enumerate(found):
            others = [all_docs[i] for i in ids if i not in set(g)]
            shared = [t for t, _ in found_terms[gi]
                      if sum(t in d for d in docs[gi]) >= MIN_TERM_COVER * len(g)
                      and sum(t in d for d in others) <= MAX_TERM_ELSEWHERE * max(len(others), 1)]
            if not keep_group([papers_by_id[i] for i in g]):
                rejected["size, weeks or one author"] += 1
            elif tightness(np.stack([pool[i] for i in g])) < floor:
                rejected["looser than nine in ten topics"] += 1
            elif not shared:
                rejected["no distinctive shared phrase"] += 1
            else:
                rest = [t for t, _ in found_terms[gi] if t not in shared]
                terms[len(groups)] = shared + rest
                groups.append(g)
    ident, next_id = match(groups, previous, next_id, as_of)
    weeks = [iso_week(start + timedelta(days=7 * k)) for k in range(WEEKS)]
    candidates = []
    for gi, g in enumerate(groups):
        per_week = Counter(iso_week(papers_by_id[i]["submitted"].date()) for i in g)
        cid, first = ident[gi]
        candidates.append({
            "id": cid, "first_seen": first, "n": len(g),
            "weeks_seen": sum(1 for w in weeks if per_week[w]),
            "weekly": [per_week[w] for w in weeks],
            "terms": name_terms(terms[gi]),
            "paper_ids": sorted(g, key=lambda i: papers_by_id[i]["submitted"], reverse=True),
        })
    candidates.sort(key=lambda c: (-c["n"], c["id"]))
    new_state = {"as_of": as_of.isoformat(), "pool_size": len(ids), "weeks": weeks,
                 "tightness_floor": round(floor, 4), "rejected": dict(rejected),
                 "next_id": next_id, "candidates": candidates,
                 "previous": {k: v for k, v in (base or {}).items() if k != "previous"} or None}
    return new_state


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=1) + "\n")
    tmp.replace(STATE)


def main(argv=None):
    import argparse

    from . import summary
    ap = argparse.ArgumentParser(prog="python -m pipeline.emerging")
    ap.parse_args(argv)
    ctx = summary.load_context()
    state = find(ctx.data_through, ctx.papers, ctx.unassigned_ids, read_pool(), load_state(),
                 tightness_floor(*summary.read_similarity(ctx.version)))
    save_state(state)
    log(f"Emerging: {len(state['candidates'])} groups from a pool of {state['pool_size']} "
        f"unassigned papers, 12 weeks to {state['as_of']}; rejected {state['rejected']}")


if __name__ == "__main__":
    main()
