from datetime import date, datetime, timezone

from pipeline import listing
from tests.feeds import entry, feed


def rec(i, day):
    return {"id": i, "submitted": datetime(2026, 9, day, tzinfo=timezone.utc)}


class FakeSite:
    def __init__(self, listed, api):
        self.listed = listed
        self.api = api

    def get(self, url, accept=None):
        if "/list/" in url:
            links = "".join(f'<a href ="/abs/{i}" title="Abstract">arXiv:{i}</a>' for i in self.listed)
            return f"<h3>Total of {len(self.listed)} entries</h3>{links}".encode()
        return feed(len(self.api), [entry(i + "v1", published=t) for i, t in self.api.items()])


def test_every_difference_is_explained():
    ours = [rec("2609.00001", 2), rec("2609.00002", 3), rec("2610.00001", 30)]
    site = FakeSite(
        listed=["2609.00001", "2609.00002", "2609.00100"],
        api={"2609.00100": "2026-08-12T10:00:00Z"},  # held in moderation, announced in Sep
    )
    r = listing.reconcile(site, "2026-09", ours)
    assert r["submitted_earlier_announced_this_month"] == 1
    assert r["submitted_this_month_announced_later"] == 1
    assert r["in_listing_but_missed"] == [] and r["harvested_but_unexplained"] == []


def test_a_paper_the_harvest_should_have_had_is_reported():
    ours = [rec("2609.00001", 2)]
    site = FakeSite(listed=["2609.00001", "2609.00200"], api={"2609.00200": "2026-09-14T10:00:00Z"})
    r = listing.reconcile(site, "2026-09", ours)
    assert r["in_listing_but_missed"] == ["2609.00200"]


def test_a_harvested_paper_from_this_month_missing_from_the_listing_is_reported():
    ours = [rec("2609.00001", 2), rec("2609.00300", 5)]
    site = FakeSite(listed=["2609.00001"], api={})
    r = listing.reconcile(site, "2026-09", ours)
    assert r["harvested_but_unexplained"] == ["2609.00300"]


def test_id_month():
    assert listing.id_month("2609.12345") == date(2026, 9, 1)
    assert listing.id_month("2112.00001") == date(2021, 12, 1)
