"""
stats.py: the numbers the page reports, and the tests they have to pass.

Rules:

  * A change in share is judged by a two-proportion z-test with pooled
    variance. The page only calls a topic growing or cooling at |z| >= 2, and
    calls it sparse below a minimum combined count, because a small topic can
    double by chance.
  * The five-year trend fits all 20 quarters at once rather than comparing the
    first year with the last: a Poisson regression of the topic's count on time,
    with the quarter's total papers as exposure, so it measures change in share,
    not in volume. Its range is a 95% interval, widened by the overdispersion
    the data actually shows (quasi-Poisson), so a lumpy topic gets an honest,
    wider range instead of a confident one.
  * Terms gaining and losing ground are ranked by a smoothed log2 ratio of
    document shares, then folded so each idea appears once (three rules,
    explained in fold_terms).
"""

import math
from collections import Counter

import numpy as np

MIN_COMBINED = {"1W": 15, "1M": 20, "3M": 30, "6M": 30, "1Y": 30, "5Y": 30}
TERM_MIN = {"1W": 8, "1M": 15, "3M": 25, "6M": 40, "1Y": 60, "5Y": 100}
TERM_TOP = 15
Z_SIGNAL = 2.0


def ztest(n_now, N_now, n_then, N_then):
    """Two-proportion z, positive when the share rose. 0 when undefined."""
    if N_now <= 0 or N_then <= 0:
        return 0.0
    p = (n_now + n_then) / (N_now + N_then)
    se = math.sqrt(p * (1 - p) * (1 / N_now + 1 / N_then))
    if se == 0:
        return 0.0
    return (n_now / N_now - n_then / N_then) / se


def signal(z, combined, minimum):
    if combined < minimum:
        return "sparse"
    if z >= Z_SIGNAL:
        return "growing"
    if z <= -Z_SIGNAL:
        return "cooling"
    return "steady"


def poisson_trend(counts, totals, t_years, iters=50):
    """Growth in share per year, as a fraction, with a 95% range.

    counts[i] papers of the topic out of totals[i] in period i, at time
    t_years[i]. Returns (growth, lo, hi), or None if the topic has fewer than 10
    papers across the periods, where any fit would be noise."""
    y = np.asarray(counts, float)
    E = np.asarray(totals, float)
    t = np.asarray(t_years, float)
    keep = E > 0
    y, E, t = y[keep], E[keep], t[keep]
    if y.sum() < 10 or len(y) < 4:
        return None
    t = t - t.mean()
    X = np.column_stack([np.ones_like(t), t])
    off = np.log(E)
    beta = np.array([math.log(y.sum() / E.sum()), 0.0])
    for _ in range(iters):
        mu = np.exp(X @ beta + off)
        W = mu
        z = X @ beta + (y - mu) / mu
        A = X.T @ (W[:, None] * X)
        new = np.linalg.solve(A, X.T @ (W * z))
        if np.max(np.abs(new - beta)) < 1e-10:
            beta = new
            break
        beta = new
    mu = np.exp(X @ beta + off)
    cov = np.linalg.inv(X.T @ (mu[:, None] * X))
    dof = max(len(y) - 2, 1)
    phi = max(1.0, float(np.sum((y - mu) ** 2 / mu)) / dof)
    se = math.sqrt(cov[1, 1] * phi)
    b = float(beta[1])
    return math.expm1(b), math.expm1(b - 1.96 * se), math.expm1(b + 1.96 * se)


def term_scores(df_now, N_now, df_then, N_then, minimum):
    """{term: (early_frac, late_frac, log2)} for terms with enough documents."""
    out = {}
    for term in set(df_now) | set(df_then):
        a, b = df_then.get(term, 0), df_now.get(term, 0)
        if a + b < minimum:
            continue
        score = math.log2(((b + 3) / (N_now + 3)) / ((a + 3) / (N_then + 3)))
        out[term] = (a / max(N_then, 1), b / max(N_now, 1), score)
    return out


def fold_terms(scores, df_now, df_then, top=TERM_TOP):
    """Pick the top terms each way so that each idea appears once.

    1. Accidental pairings: a bigram used in < 25% of the papers that use its
       rarer word is two words that happen to sit together, not a phrase.
    2. Absorbed words: a word whose papers mostly (>= 50%) use one particular
       bigram is shown as that bigram ("barren plateau", not "barren").
    3. Passengers: a bigram that moved within 0.5 (log2) of one of its own
       words, in the same direction, only rose or fell because that word did.

    Returns {"gaining": [...], "losing": [...]}, each entry
    (term, early_frac, late_frac, log2, folded) where folded is None for shown
    terms. Folded terms met on the way to the top are kept for debugging."""
    count = Counter()
    for d in (df_now, df_then):
        for k, v in d.items():
            count[k] += v
    bigrams = [t for t in scores if " " in t]
    reason = {}
    for bg in bigrams:
        w1, w2 = bg.split(" ", 1)
        rarer = min(count.get(w1, 0), count.get(w2, 0))
        if rarer and count[bg] < 0.25 * rarer:
            reason[bg] = "accidental pairing"
    absorbed = set()
    for bg in bigrams:
        if bg in reason:
            continue
        for w in bg.split(" ", 1):
            if count.get(w, 0) and count[bg] >= 0.5 * count[w]:
                absorbed.add(w)
                reason.setdefault(w, f"absorbed into '{bg}'")
    for bg in bigrams:
        if bg in reason:
            continue
        s = scores[bg][2]
        for w in bg.split(" ", 1):
            if w in scores and w not in absorbed:
                sw = scores[w][2]
                if s * sw > 0 and abs(s - sw) <= 0.5:
                    reason[bg] = f"passenger of '{w}'"
                    break

    def pick(sign):
        ranked = sorted((t for t in scores if sign * scores[t][2] > 0),
                        key=lambda t: (-sign * scores[t][2], t))
        out, shown = [], 0
        for t in ranked:
            e, l, s = scores[t]
            r = reason.get(t)
            out.append((t, e, l, s, r))
            if r is None:
                shown += 1
                if shown == top:
                    break
        return out

    return {"gaining": pick(1), "losing": pick(-1)}
