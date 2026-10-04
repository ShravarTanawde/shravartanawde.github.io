import math

import numpy as np
import pytest

from pipeline import stats


def test_ztest_hand_computed():
    # p = 50/200 = 0.25; se = sqrt(0.25 * 0.75 * (1/100 + 1/100)) = 0.0612372
    assert stats.ztest(30, 100, 20, 100) == pytest.approx(0.1 / 0.0612372, rel=1e-5)
    assert stats.ztest(20, 100, 30, 100) == pytest.approx(-1.632993, rel=1e-5)
    assert stats.ztest(0, 100, 0, 100) == 0.0
    assert stats.ztest(5, 0, 5, 100) == 0.0


def test_signal_thresholds():
    assert stats.signal(2.0, 30, 30) == "growing"
    assert stats.signal(-2.1, 30, 30) == "cooling"
    assert stats.signal(1.99, 30, 30) == "steady"
    assert stats.signal(5.0, 29, 30) == "sparse"


def test_trend_recovers_a_known_growth_rate():
    t = np.arange(20) / 4
    totals = np.full(20, 10_000)
    counts = np.round(100 * 1.5 ** t)  # share grows 50% a year
    g, lo, hi = stats.poisson_trend(counts, totals, t)
    assert g == pytest.approx(0.5, abs=0.01)
    assert lo < g < hi


def test_trend_is_about_share_not_volume():
    t = np.arange(20) / 4
    totals = np.round(1000 * 2 ** t)
    counts = np.round(totals * 0.02)  # volume doubles yearly, share flat
    g, lo, hi = stats.poisson_trend(counts, totals, t)
    assert abs(g) < 0.01 and lo < 0 < hi


def test_trend_range_widens_with_overdispersion():
    t = np.arange(20) / 4
    totals = np.full(20, 5000)
    smooth = np.full(20, 40.0)
    lumpy = np.array([10, 80] * 10, float)
    _, lo1, hi1 = stats.poisson_trend(smooth, totals, t)
    _, lo2, hi2 = stats.poisson_trend(lumpy, totals, t)
    assert hi2 - lo2 > 2 * (hi1 - lo1)


def test_trend_refuses_tiny_topics():
    assert stats.poisson_trend([1, 0, 2, 1, 0, 3], [100] * 6, range(6)) is None


def scores_for(now, then, N=1000):
    return stats.term_scores(now, N, then, N, minimum=1)


def test_accidental_pairing_is_folded():
    now = {"learning": 300, "circuits": 300, "learning circuits": 20}
    then = {"learning": 100, "circuits": 100, "learning circuits": 5}
    out = stats.fold_terms(scores_for(now, then), now, then)
    reasons = {t[0]: t[4] for t in out["gaining"]}
    assert reasons["learning circuits"] == "accidental pairing"
    assert reasons["learning"] is None


def test_absorbed_word_shows_as_its_bigram():
    now = {"barren": 100, "plateau": 110, "barren plateau": 95}
    then = {"barren": 30, "plateau": 35, "barren plateau": 28}
    out = stats.fold_terms(scores_for(now, then), now, then)
    reasons = {t[0]: t[4] for t in out["gaining"]}
    assert reasons["barren plateau"] is None
    assert reasons["barren"].startswith("absorbed")


def test_passenger_bigram_is_folded():
    # "error" rises on its own; "error rates" only rises with it.
    now = {"error": 800, "rates": 150, "error rates": 120}
    then = {"error": 200, "rates": 150, "error rates": 31}
    out = stats.fold_terms(scores_for(now, then), now, then)
    reasons = {t[0]: t[4] for t in out["gaining"]}
    assert reasons["error"] is None
    assert reasons["error rates"] == "passenger of 'error'"


def test_fold_keeps_top_shown_terms_only():
    now = {f"w{i}": 100 + i for i in range(40)}
    then = {f"w{i}": 10 for i in range(40)}
    out = stats.fold_terms(scores_for(now, then), now, then, top=15)
    assert len([t for t in out["gaining"] if t[4] is None]) == 15
