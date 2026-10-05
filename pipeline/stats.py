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
"""

import math

import numpy as np

MIN_COMBINED = {"1W": 15, "1M": 20, "3M": 30, "6M": 30, "1Y": 30, "5Y": 30}
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
