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
