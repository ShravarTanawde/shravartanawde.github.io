"""
lineage.py: how a refit's topics relate to the previous model's.

Rules:

  * Judged on papers both models assigned, by membership overlap, so a topic
    keeps its history only if it keeps its papers, whatever it is called.
  * continues: the new topic and one old topic share more than half of their
    combined papers (Jaccard > 0.5), and that old topic is matched once. An
    even split in two is therefore a split for both halves, and in an uneven
    one the larger part continues.
  * merged: at least two old topics each supply 20% or more of the new
    topic's papers.
  * split: one old topic supplies 20% or more, and that old topic's papers went
    to two or more new topics in shares of 20% or more.
  * new: none of the above, usually a group the old model left unassigned.
"""

from collections import Counter, defaultdict

CONTINUES = 0.5
PART = 0.2


def compute(new, old):
    """new, old: {paper id: topic id or None}. Returns {new topic: lineage}."""
    shared = [i for i in new if i in old and new[i] is not None]
    size_new = Counter(new[i] for i in new if new[i] is not None)
    size_old = Counter(t for t in old.values() if t is not None)
    pairs = Counter((new[i], old[i]) for i in shared if old[i] is not None)
    by_new, by_old = defaultdict(dict), defaultdict(dict)
    for (n, o), k in pairs.items():
        by_new[n][o] = k
        by_old[o][n] = k

    def jac(n, o):
        k = pairs[(n, o)]
        return k / (size_new[n] + size_old[o] - k)

    taken, out = set(), {}
    for j, n, o in sorted(((jac(n, o), n, o) for (n, o) in pairs), reverse=True):
        if j <= CONTINUES:
            break
        if n in out or o in taken:
            continue
        out[n] = {"kind": "continues", "from": [o]}
        taken.add(o)
    for n in size_new:
        if n in out:
            continue
        sources = sorted((o for o, k in by_new[n].items() if k >= PART * size_new[n]),
                         key=lambda o: -by_new[n][o])
        if len(sources) >= 2:
            out[n] = {"kind": "merged", "from": sources}
        elif len(sources) == 1:
            o = sources[0]
            spread = [m for m, k in by_old[o].items() if k >= PART * size_old[o]]
            out[n] = {"kind": "split", "from": [o]} if len(spread) >= 2 else {"kind": "new", "from": []}
        else:
            out[n] = {"kind": "new", "from": []}
    return out
