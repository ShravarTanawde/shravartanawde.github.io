import urllib.parse
from datetime import date, datetime, timedelta, timezone

import pytest

from pipeline import config, harvest
from tests.feeds import entry, feed


class FakeArxiv:
    """Serves a fixed set of papers the way the API pages them. `glitch` decides,
    per (window, start), whether to return an empty page instead."""

    def __init__(self, papers, glitch=None, page=3):
        self.papers = sorted(papers, key=lambda p: p[1])  # (id, published datetime)
        self.glitch = glitch or (lambda first, last, start, n: False)
        self.page = page
        self.calls = []

    def get(self, url, accept=None):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        query = q["search_query"][0]
        lo, hi = query.split("[", 1)[1].rstrip("]").split(" TO ")
        lo = datetime.strptime(lo, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        hi = datetime.strptime(hi, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        start = int(q["start"][0])
        size = min(int(q["max_results"][0]), self.page)
        inside = [p for p in self.papers if lo <= p[1] <= hi]
        n = len(self.calls)
        self.calls.append((lo.date(), hi.date(), start))
        if self.glitch(lo.date(), hi.date(), start, n):
            return feed(len(inside))
        chunk = inside[start:start + size]
        return feed(len(inside), [entry(i + "v1", published=t.strftime("%Y-%m-%dT%H:%M:%SZ")) for i, t in chunk])


def papers_in(first, days, per_day=2):
    out = []
    for d in range(days):
        for k in range(per_day):
            t = datetime(first.year, first.month, first.day, 9 + k, tzinfo=timezone.utc) + timedelta(days=d)
            out.append((f"2609.{d:03d}{k:02d}", t))
    return out


def test_pages_through_a_window():
    papers = papers_in(date(2026, 9, 1), 30)
    api = FakeArxiv(papers, page=7)
    total, recs = harvest.harvest_window(api, date(2026, 9, 1), date(2026, 9, 30))
    assert total == 60 and len(recs) == 60
    assert len({r["id"] for r in recs}) == 60


def test_records_outside_the_dates_are_dropped():
    # One paper at exactly 00:00 on 1 Oct is inside the query's upper bound but
    # not inside September.
    papers = papers_in(date(2026, 9, 29), 2) + [("2610.00001", datetime(2026, 10, 1, tzinfo=timezone.utc))]
    _, recs = harvest.harvest_window(FakeArxiv(papers), date(2026, 9, 29), date(2026, 9, 30))
    assert "2610.00001" not in {r["id"] for r in recs}
    assert len(recs) == 4


def test_one_empty_page_is_retried():
    papers = papers_in(date(2026, 9, 1), 5)
    seen = set()

    def once(first, last, start, n):
        if start == 3 and start not in seen:
            seen.add(start)
            return True
        return False

    api = FakeArxiv(papers, glitch=once)
    _, recs = harvest.harvest_window(api, date(2026, 9, 1), date(2026, 9, 5))
    assert len(recs) == 10
    assert [c[2] for c in api.calls].count(3) == 2


def test_a_window_that_stays_short_is_split():
    papers = papers_in(date(2026, 9, 1), 30)
    # The full month always goes blank at offset 6; halves are fine.
    month = (date(2026, 9, 1), date(2026, 10, 1))
    api = FakeArxiv(papers, glitch=lambda f, l, s, n: (f, l) == month and s == 6)
    _, recs = harvest.harvest_window(api, date(2026, 9, 1), date(2026, 9, 30))
    assert len(recs) == 60
    assert any(c[:2] == (date(2026, 9, 1), date(2026, 9, 16)) for c in api.calls)


def test_a_single_day_that_stays_short_raises():
    papers = papers_in(date(2026, 9, 1), 1, per_day=5)
    api = FakeArxiv(papers, glitch=lambda f, l, s, n: s == 3)
    with pytest.raises(harvest.ShortWindow):
        harvest.harvest_window(api, date(2026, 9, 1), date(2026, 9, 1))


def test_resume_skips_complete_months_and_refetches_the_current_one(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "PAPERS", tmp_path / "papers")
    monkeypatch.setattr(config, "ROOT", tmp_path)
    papers = papers_in(date(2026, 9, 1), 30) + papers_in(date(2026, 10, 1), 3)
    api = FakeArxiv(papers)
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)

    sep, cached = harvest.harvest_month(api, date(2026, 9, 1), now)
    assert not cached and len(sep["records"]) == 60
    assert harvest.write_month_shard(sep, now).startswith("wrote")
    oct_, _ = harvest.harvest_month(api, date(2026, 10, 1), now)
    assert harvest.write_month_shard(oct_, now) == "month not complete yet, cache only"

    calls = len(api.calls)
    later = now + timedelta(days=1)
    _, cached = harvest.harvest_month(api, date(2026, 9, 1), later)
    assert cached and len(api.calls) == calls
    _, cached = harvest.harvest_month(api, date(2026, 10, 1), later)
    assert not cached and len(api.calls) > calls
    assert harvest.write_month_shard(sep, later) == "already written"


def test_a_month_cached_before_it_settled_is_fetched_again(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path / "cache")
    api = FakeArxiv(papers_in(date(2026, 9, 1), 30))
    harvest.harvest_month(api, date(2026, 9, 1), datetime(2026, 10, 2, tzinfo=timezone.utc))
    _, cached = harvest.harvest_month(api, date(2026, 9, 1), datetime(2026, 10, 9, tzinfo=timezone.utc))
    assert not cached


def test_query_url_shape():
    url = harvest.query_url(date(2026, 9, 1), date(2026, 9, 30), 500)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["search_query"] == ["cat:quant-ph AND submittedDate:[202609010000 TO 202610010000]"]
    assert q["sortBy"] == ["submittedDate"] and q["start"] == ["500"] and q["max_results"] == ["500"]
    assert url.startswith("https://export.arxiv.org/api/query?")
