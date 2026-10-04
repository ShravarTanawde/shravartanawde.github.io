"""
label_prep.py: one reading packet per topic, for naming them.

    python -m pipeline.label_prep --version v1

Writes .local/labels/<version>/<broad id>.md, one file per broad topic holding
the packets of all its fine topics, so a field is read in one sitting.

Topic names are written by reading these, never from the terms alone: c-TF-IDF
says which words a group uses more than others, not what its papers do. Each
packet carries:

  * size, share by year, the commonest primary categories, the top 20 terms,
    and the three nearest topics, so a name can be told apart from its
    neighbours';
  * 12 typical papers: nearest the centroid, diversified by maximal marginal
    relevance (lambda 0.7), so twelve near-copies of one paper series cannot
    stand in for the whole topic;
  * 4 random members, to show breadth;
  * 4 boundary members, the least similar papers still assigned, to show where
    the topic's edge is.
"""

import argparse
import json
import random
from collections import Counter

import numpy as np

from . import config, store
from .embed import DEFAULT_MODEL, load_cache
from .fit import FIT_ROOT

LABEL_ROOT = config.LOCAL / "labels"
MMR_LAMBDA = 0.7
ABSTRACT_CHARS = 480


def mmr(X, members, centroid, n, lam=MMR_LAMBDA, pool=80):
    sims = X[members] @ centroid
    cand = list(members[np.argsort(-sims)[:pool]])
    to_c = dict(zip(members, sims))
    chosen = []
    while cand and len(chosen) < n:
        if not chosen:
            pick = cand[0]
        else:
            V = X[chosen]
            pick = max(cand, key=lambda i: lam * to_c[i] - (1 - lam) * float(np.max(V @ X[i])))
        chosen.append(pick)
        cand.remove(pick)
    return chosen


def short(text, n):
    text = " ".join(text.split())
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + " ..."


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.label_prep")
    ap.add_argument("--version", required=True)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    src = FIT_ROOT / args.version
    draft = json.loads((src / "draft.json").read_text())
    ids = json.loads((src / "ids.json").read_text())
    fine = np.load(src / "fine.npy")
    sim = np.load(src / "sim.npy")
    C = np.load(src / "centroids.npy")
    cache_ids, cache_vecs = load_cache(DEFAULT_MODEL)
    pos = {pid: i for i, pid in enumerate(cache_ids)}
    X = cache_vecs[[pos[i] for i in ids]]
    by_id = {p["id"]: p for p in store.read_papers(config.PAPERS)}
    papers = [by_id[i] for i in ids]
    rng = random.Random(args.seed)

    fine_meta = {t["id"]: t for t in draft["fine"]}
    out = LABEL_ROOT / args.version
    out.mkdir(parents=True, exist_ok=True)
    years_all = Counter(p["submitted"].year for p in papers)

    for b in draft["broad"]:
        lines = [f"# {b['id']}: {len(b['children'])} fine topics, {b['size']} papers",
                 f"terms: {', '.join(b['terms'][:15])}", ""]
        for tid in b["children"]:
            t = fine_meta[tid]
            c = int(tid[1:]) - 1
            members = np.flatnonzero(fine == c)
            years = Counter(papers[i]["submitted"].year for i in members)
            share = "  ".join(f"{y}: {years[y] / years_all[y] * 100:.2f}%" for y in sorted(years_all))
            cats = Counter(papers[i]["primary_category"] for i in members).most_common(4)
            neigh = "; ".join(f"{n} ({', '.join(fine_meta[n]['terms'][:3])})" for n in t["neighbours"])
            lines += [f"## {tid}  ({t['size']} papers, stability {t['stability']:.2f}"
                      f"{', UNSTABLE' if t['unstable'] else ''})",
                      f"share of all papers by year: {share}",
                      f"primary categories: {', '.join(f'{k} {v}' for k, v in cats)}",
                      f"terms: {', '.join(t['terms'])}",
                      f"neighbours: {neigh}"]
            if t.get("lineage"):
                lin = t["lineage"]
                lines.append(f"lineage ({lin['version']}): {lin['kind']} "
                             + ", ".join(f"{o} {n!r}" for o, n in zip(lin["from"], lin["names"])))
            lines += ["", "typical:"]
            for i in mmr(X, members, C[c], 12):
                p = papers[i]
                lines.append(f"- {p['title']} ({p['submitted']:%Y}). {short(p['abstract'], ABSTRACT_CHARS)}")
            rest = [i for i in members]
            lines.append("random:")
            for i in rng.sample(rest, min(4, len(rest))):
                lines.append(f"- {papers[i]['title']}. {short(papers[i]['abstract'], 160)}")
            lines.append("boundary:")
            for i in members[np.argsort(sim[members])][:4]:
                lines.append(f"- {papers[i]['title']}. {short(papers[i]['abstract'], 160)}")
            lines.append("")
        (out / f"{b['id']}.md").write_text("\n".join(lines))
    print(f"Wrote {len(draft['broad'])} files for {len(draft['fine'])} topics to {out.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
