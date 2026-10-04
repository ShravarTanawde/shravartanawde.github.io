import numpy as np

from pipeline.model import UNASSIGNED, assign, centroids, thresholds


def unit(v):
    v = np.asarray(v, dtype=np.float32)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def test_nearest_centroid_above_its_own_threshold():
    C = unit([[1, 0, 0], [0, 1, 0]])
    thr = np.array([0.9, 0.5], dtype=np.float32)
    X = unit([[1, 0.1, 0], [0.2, 1, 0], [1, 0.9, 0], [0, 0, 1]])
    got, sim = assign(X, C, thr)
    # 3rd is nearest topic 0 (cos ~0.74) but under its 0.9 bar; 4th is near nothing
    assert got.tolist() == [0, 1, UNASSIGNED, UNASSIGNED]
    assert sim[0] > 0.99


def test_threshold_is_members_5th_percentile_with_a_floor():
    rng = np.random.default_rng(0)
    tight = unit(np.array([1, 0, 0]) + 0.02 * rng.standard_normal((200, 3)))
    loose = unit(np.array([0, 1, 0]) + 0.9 * rng.standard_normal((200, 3)))
    X = np.concatenate([tight, loose])
    labels = np.array([0] * 200 + [1] * 200)
    C = centroids(X, labels, 2)
    thr = thresholds(X, labels, C, floor=0.8)
    assert thr[0] > 0.99
    assert thr[1] == np.float32(0.8)  # the loose topic's 5th percentile is far below the floor
    assert np.isclose(np.linalg.norm(C, axis=1), 1).all()


def test_batching_does_not_change_the_answer():
    rng = np.random.default_rng(1)
    X = unit(rng.standard_normal((1000, 8)))
    C = unit(rng.standard_normal((5, 8)))
    thr = np.full(5, 0.3, dtype=np.float32)
    a, _ = assign(X, C, thr, batch=1000)
    b, _ = assign(X, C, thr, batch=37)
    assert (a == b).all()
