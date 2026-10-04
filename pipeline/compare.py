"""
compare.py: which embedding model separates fine topics better, on papers both
models have embedded.

    python -m pipeline.compare --from 2026-03 --to 2026-09

Writes .local/compare/: report.txt (numbers), neighbours_<X>.txt and
clusters_<X>.txt for X in A, B, and key.json saying which model is which. The
letters are shuffled by a seed nobody reads until the reading is written up,
so the reading is blind.

Two numbers, both rough stand-ins for "the same niche", because there is no
ground truth for topics:
  * author overlap: how often a paper's 10 nearest neighbours share an author
    with it. Groups publish within their niche.
  * rare-term overlap: how often a neighbour shares a term that appears in
    fewer than 0.5% of abstracts. A niche has its own vocabulary.
Then the reading: nearest neighbours for 40 random papers, and 6 random
clusters per model, from the same UMAP + HDBSCAN recipe the fit uses, scaled
down to the sample size.
"""

import argparse
import json
import random
import re
from collections import Counter
from pathlib import Path

import numpy as np

from . import config, store
from .embed import load_cache
from .windows import month_key

OUT = config.LOCAL / "compare"
WORD = re.compile(r"[a-z][a-z\-]{3,}")


def rare_terms(papers, max_share=0.005):
    docs = [set(WORD.findall((p["title"] + " " + p["abstract"]).lower())) for p in papers]
    df = Counter(t for d in docs for t in d)
    cap = max(3, int(max_share * len(docs)))
    return [{t for t in d if 2 <= df[t] <= cap} for d in docs]


def neighbours(vecs, k=10):
    sims = vecs @ vecs.T
    np.fill_diagonal(sims, -1)
    return np.argsort(-sims, axis=1)[:, :k]


def overlap_scores(papers, nn, rare):
    authors = [set(a.lower() for a in p["authors"]) for p in papers]
    share_author = np.mean([[bool(authors[i] & authors[j]) for j in row] for i, row in enumerate(nn)])
    share_rare = np.mean([[bool(rare[i] & rare[j]) for j in row] for i, row in enumerate(nn)])
    return share_author, share_rare


def cluster(vecs, seed):
    import umap
    from sklearn.cluster import HDBSCAN

    low = umap.UMAP(metric="cosine", n_neighbors=15, n_components=8, min_dist=0.0,
                    random_state=seed).fit_transform(vecs)
    return HDBSCAN(min_cluster_size=8, min_samples=4, cluster_selection_method="leaf").fit_predict(low)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.compare")
    ap.add_argument("--from", dest="first", required=True)
    ap.add_argument("--to", dest="last", required=True)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)

    papers = [p for p in store.read_papers(config.PAPERS) if args.first <= month_key(p["submitted"]) <= args.last]
    models = ["bge", "specter2"]
    caches = {m: load_cache(m) for m in models}
    have = set.intersection(*(set(caches[m][0]) for m in models))
    papers = [p for p in papers if p["id"] in have]
    papers.sort(key=lambda p: p["id"])
    vecs = {}
    for m in models:
        idx = {pid: i for i, pid in enumerate(caches[m][0])}
        vecs[m] = caches[m][1][[idx[p["id"]] for p in papers]]

    rng = random.Random(args.seed)
    letters = ["A", "B"]
    rng.shuffle(letters)
    key = dict(zip(letters, models))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "key.json").write_text(json.dumps(key))

    rare = rare_terms(papers)
    queries = rng.sample(range(len(papers)), 40)
    lines = [f"{len(papers)} papers, {args.first} to {args.last}\n"]
    for letter in sorted(key):
        m = key[letter]
        nn = neighbours(vecs[m])
        a, r = overlap_scores(papers, nn, rare)
        labels = cluster(vecs[m], args.seed)
        n_clusters = labels.max() + 1
        noise = float(np.mean(labels < 0))
        sizes = np.bincount(labels[labels >= 0])
        lines.append(f"{letter}: neighbours sharing an author {a:.1%}, sharing a rare term {r:.1%}; "
                     f"{n_clusters} clusters, median size {int(np.median(sizes))}, unclustered {noise:.1%}")

        with open(OUT / f"neighbours_{letter}.txt", "w") as fh:
            for q in queries:
                fh.write(f"\n## {papers[q]['title']}\n")
                for j in nn[q][:5]:
                    fh.write(f"   - {papers[j]['title']}\n")
        with open(OUT / f"clusters_{letter}.txt", "w") as fh:
            for c in rng.sample(range(n_clusters), min(6, n_clusters)):
                members = [i for i in np.flatnonzero(labels == c)]
                fh.write(f"\n## cluster {c} ({len(members)} papers)\n")
                for i in rng.sample(members, min(8, len(members))):
                    fh.write(f"   - {papers[i]['title']}\n")
    (OUT / "report.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
