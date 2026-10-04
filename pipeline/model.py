"""
model.py: the assignment rule, shared by the fit and the weekly job.

Rules:

  * A paper goes to the fine topic whose centroid it is most similar to (cosine;
    vectors and centroids are unit length, so a dot product), but only if that
    similarity reaches the topic's own threshold. Otherwise it is unassigned.
    Its broad topic is its fine topic's parent, so the two levels never
    disagree.
  * A topic's threshold is the 5th percentile of its own members' similarity to
    its centroid, never below a global floor. A tight topic gets a high bar and
    a diffuse one a lower bar, and the floor stops a diffuse one from
    swallowing papers that are close to nothing.
  * Centroids live in the original embedding space, not the UMAP projection,
    because the weekly job has new papers and no way to place them in a UMAP it
    did not fit. One rule, applied identically, is the point.
"""

import numpy as np

THRESHOLD_PERCENTILE = 5
THRESHOLD_FLOOR = 0.80
UNASSIGNED = -1


def centroids(X, labels, k):
    C = np.stack([X[labels == c].mean(0) for c in range(k)]).astype(np.float32)
    return C / np.linalg.norm(C, axis=1, keepdims=True)


def thresholds(X, labels, C, pct=THRESHOLD_PERCENTILE, floor=THRESHOLD_FLOOR):
    return np.array([max(floor, float(np.percentile(X[labels == c] @ C[c], pct)))
                     for c in range(len(C))], dtype=np.float32)


def assign(X, C, thr, batch=20000):
    """Returns (topic index or UNASSIGNED, similarity to the nearest centroid)."""
    out = np.empty(len(X), dtype=np.int32)
    sim = np.empty(len(X), dtype=np.float32)
    for i in range(0, len(X), batch):
        S = X[i:i + batch] @ C.T
        best = S.argmax(1)
        top = S[np.arange(len(best)), best]
        out[i:i + batch] = np.where(top >= thr[best], best, UNASSIGNED)
        sim[i:i + batch] = top
    return out, sim
