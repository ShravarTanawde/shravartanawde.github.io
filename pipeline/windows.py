"""
windows.py: the calendar maths every other step agrees on.

Rules:

  * Every window ends on the Sunday of the last complete ISO week, in UTC. A
    week is complete only once its Sunday has ended, so on a Sunday the current
    week does not count yet.
  * Window lengths are whole weeks, so every comparison has the same weekday
    mix. Weekend submissions run far lower than weekday ones, and a window with
    one extra Saturday would read as a dip.
  * The five-year range is 260 ISO weeks (1820 days). The harvest starts on the
    first day of the month that range begins in, so 5Y is fully covered.
"""

from datetime import date, datetime, timedelta, timezone

FIVE_YEAR_DAYS = 1820


def last_complete_week_end(now: datetime) -> date:
    """The Sunday that closes the last ISO week fully in the past."""
    today = now.astimezone(timezone.utc).date()
    this_sunday = today + timedelta(days=6 - today.weekday())
    return this_sunday - timedelta(days=7)


ANNOUNCE_DAYS = 2


def last_announced_week_end(now: datetime, settle: int = ANNOUNCE_DAYS) -> date:
    """The newest Sunday at least `settle` days in the past (UTC).

    arXiv announces papers submitted from Friday afternoon to Sunday on Monday
    at 20:00 US Eastern, which is Tuesday 00:00 UTC. Before then, about a sixth
    of a week's papers are not in the API yet. Two days is the margin that
    guarantees a week is fully announced: run on a Sunday, or late into
    Monday, this returns the Sunday before; from Tuesday it returns the one
    just past."""
    today = now.astimezone(timezone.utc).date()
    cutoff = today - timedelta(days=settle)
    return cutoff - timedelta(days=(cutoff.weekday() + 1) % 7)


def window_start(end: date, days: int) -> date:
    """First day of a window of `days` days that ends on `end`, inclusive."""
    if days % 7:
        raise ValueError(f"window lengths must be whole weeks, got {days} days")
    return end - timedelta(days=days - 1)


def five_year_start(end: date) -> date:
    return window_start(end, FIVE_YEAR_DAYS)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def parse_month(key: str) -> date:
    year, month = key.split("-")
    return date(int(year), int(month), 1)


def month_end(first: date) -> date:
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def months(first: date, last: date):
    """Every month from the one containing `first` to the one containing `last`."""
    cur = date(first.year, first.month, 1)
    stop = date(last.year, last.month, 1)
    while cur <= stop:
        yield cur
        cur = month_end(cur) + timedelta(days=1)
