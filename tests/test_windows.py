from datetime import date, datetime, timedelta, timezone

import pytest

from pipeline.windows import (FIVE_YEAR_DAYS, five_year_start, last_complete_week_end, month_end, months,
                              window_start)


def at(y, m, d, hh=12, mm=0, tz=timezone.utc):
    return datetime(y, m, d, hh, mm, tzinfo=tz)


def test_last_complete_week_on_each_day():
    # Week Mon 28 Sep .. Sun 4 Oct 2026 is the current one all week long.
    for day in range(28, 31):
        assert last_complete_week_end(at(2026, 9, day)) == date(2026, 9, 27)
    for day in range(1, 5):
        assert last_complete_week_end(at(2026, 10, day)) == date(2026, 9, 27)
    # Sunday 23:59 is still inside the week; Monday 00:00 closes it.
    assert last_complete_week_end(at(2026, 10, 4, 23, 59)) == date(2026, 9, 27)
    assert last_complete_week_end(at(2026, 10, 5, 0, 0)) == date(2026, 10, 4)


def test_last_complete_week_is_computed_in_utc():
    ist = timezone(timedelta(hours=5, minutes=30))
    # 02:00 Monday in India is still Sunday in UTC.
    assert last_complete_week_end(datetime(2026, 10, 5, 2, 0, tzinfo=ist)) == date(2026, 9, 27)


def test_year_boundary():
    # 2026 has 53 ISO weeks; W53 runs Mon 28 Dec 2026 .. Sun 3 Jan 2027.
    assert last_complete_week_end(at(2027, 1, 3)) == date(2026, 12, 27)
    assert last_complete_week_end(at(2027, 1, 4)) == date(2027, 1, 3)
    assert date(2027, 1, 3).isocalendar()[:2] == (2026, 53)


def test_five_year_window_is_260_whole_weeks_starting_monday():
    end = date(2026, 9, 27)
    start = five_year_start(end)
    assert start.weekday() == 0
    assert (end - start).days + 1 == FIVE_YEAR_DAYS == 260 * 7
    assert start == date(2021, 10, 4)


def test_windows_must_be_whole_weeks():
    assert window_start(date(2026, 9, 27), 28) == date(2026, 8, 31)
    with pytest.raises(ValueError):
        window_start(date(2026, 9, 27), 30)


def test_months_across_a_year_boundary():
    got = [m.isoformat() for m in months(date(2025, 11, 15), date(2026, 2, 3))]
    assert got == ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]
    assert month_end(date(2024, 2, 1)) == date(2024, 2, 29)
    assert month_end(date(2026, 12, 1)) == date(2026, 12, 31)


def test_last_announced_week_end():
    from pipeline.windows import last_announced_week_end
    utc = timezone.utc
    # The scheduled run: Sunday 4 Oct 2026, 18:30 UTC (midnight IST). The week
    # just ending is not fully announced, so it reports the one before.
    assert last_announced_week_end(datetime(2026, 10, 4, 18, 30, tzinfo=utc)) == date(2026, 9, 27)
    # Started late, early Monday UTC: still the week before.
    assert last_announced_week_end(datetime(2026, 10, 5, 3, 0, tzinfo=utc)) == date(2026, 9, 27)
    # From Tuesday, after Monday's announcement, the week just past is complete.
    assert last_announced_week_end(datetime(2026, 10, 6, 6, 0, tzinfo=utc)) == date(2026, 10, 4)
    assert last_announced_week_end(datetime(2026, 10, 10, 12, 0, tzinfo=utc)) == date(2026, 10, 4)
    # Across a year boundary.
    assert last_announced_week_end(datetime(2027, 1, 3, 18, 30, tzinfo=utc)) == date(2026, 12, 27)
