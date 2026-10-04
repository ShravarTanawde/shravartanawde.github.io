import copy
from datetime import date, datetime, timezone

import numpy as np
import pytest

from pipeline import emerging, summary


def test_sig_rounds_to_four_significant_figures():
    assert summary.sig(0.0123456) == 0.01235
    assert summary.sig(123.456) == 123.5
    assert summary.sig(0) == 0


def test_windows_are_whole_weeks_and_adjacent():
    end = date(2026, 9, 13)  # a Sunday
    w = summary.windows(end, date(2021, 10, 1))
    for r, days in summary.RANGES.items():
        start, stop, ps, pe, ns = w[r]
        assert stop == end and start.weekday() == 0
        assert ((stop - start).days + 1) % 7 == 0
        if r != "5Y":
            assert (stop - start).days + 1 == days
            assert (pe - ps).days + 1 == days and (start - pe).days == 1 and ns == start
    start, stop, ps, pe, ns = w["5Y"]
    assert start == date(2021, 10, 4)  # clamped to the first full week of data
    assert ps == start and (pe - ps).days == 363 and (stop - ns).days == 363


def test_windows_cross_a_year_boundary():
    end = date(2027, 1, 3)  # Sunday of ISO week 2026-W53
    start, stop, ps, pe, _ = summary.windows(end, date(2021, 10, 1))["1M"]
    assert start == date(2026, 12, 7) and pe == date(2026, 12, 6) and ps == date(2026, 11, 9)
    assert emerging.iso_week(end) == "2026-W53"
    assert emerging.iso_week(date(2027, 1, 4)) == "2027-W01"


def test_month_buckets_flag_partial_ends():
    labels, idx, first, last = summary.buckets(date(2021, 10, 4), date(2026, 9, 13), "month")
    assert labels[0] == "2021-10" and labels[-1] == "2026-09" and len(labels) == 60
    assert first and last
    assert idx(date(2026, 9, 1)) == 59
    _, _, first, last = summary.buckets(date(2021, 10, 1), date(2026, 9, 30), "month")
    assert not first and not last


def test_week_buckets():
    labels, idx, _, _ = summary.buckets(date(2026, 6, 22), date(2026, 9, 13), "week")
    assert len(labels) == 12 and idx(date(2026, 9, 13)) == 11 and idx(date(2026, 6, 28)) == 0


def tiny_radar():
    row = lambda i, n: [i, n, n, 1, 0.2, 0.1, 10, 2.5, "growing", [n]]
    view = {"window": {}, "totals": {"n": 10, "n_now": 10, "n_then": 10},
            "volume": {"labels": ["2026-09-07"], "counts": [10]},
            "topics": [row("t001", 2), row("t002", 2)], "broad": [row("b01", 4)],
            "terms": {"gaining": [], "losing": []}, "categories": {}}
    return {"schema": 1, "meta": {}, "facets": ["Foundations"], "topic_cols": summary.TOPIC_COLS,
            "topics": [{"id": "t001", "facet": "Foundations", "parent": "b01"},
                       {"id": "t002", "facet": "Foundations", "parent": "b01"}],
            "broad": [{"id": "b01"}], "emerging": [],
            "views": {r: {f: copy.deepcopy(view) for f in summary.FILTERS} for r in summary.RANGES}}


def test_validate_accepts_a_good_file():
    summary.validate(tiny_radar())


@pytest.mark.parametrize("breakage, message", [
    (lambda r: r.update(schema=2), "schema"),
    (lambda r: r["views"]["1W"]["all"]["topics"][0].__setitem__(4, 1.2), "share outside"),
    (lambda r: [row.__setitem__(2, 6) for row in r["views"]["1M"]["cross"]["topics"]], "sum past 1"),
    (lambda r: r["views"]["5Y"]["primary"]["volume"].__setitem__("counts", [9]), "volume"),
    (lambda r: r["views"]["1Y"]["all"]["topics"][1].__setitem__(9, [1]), "sparkline"),
    (lambda r: r["topics"][0].__setitem__("facet", "Opportunities"), "facet"),
    (lambda r: r["views"]["3M"].pop("cross"), "filters"),
])
def test_validate_rejects_broken_files(breakage, message):
    r = tiny_radar()
    breakage(r)
    with pytest.raises(summary.Invalid, match=message):
        summary.validate(r)


def paper(i, day, authors):
    return {"id": i, "title": f"Paper {i}", "abstract": "x", "authors": authors,
            "submitted": datetime(2026, 9, day, tzinfo=timezone.utc)}


def test_single_author_rule():
    shared = [paper(f"p{k}", 1 + 7 * (k % 3), ["A. Author", f"B{k}"]) for k in range(8)]
    assert not emerging.keep_group(shared)
    mixed = [paper(f"p{k}", 1 + 7 * (k % 3), ["A. Author"] if k < 4 else [f"C{k}"]) for k in range(8)]
    assert emerging.keep_group(mixed)  # exactly half is allowed


def test_group_needs_three_weeks():
    assert not emerging.keep_group([paper(f"p{k}", 1 + 7 * (k % 2), [f"A{k}"]) for k in range(8)])


def test_name_terms_folds_words_into_phrases():
    assert emerging.name_terms(["carlo", "monte carlo", "monte", "sampling", "helium"]) == \
        ["monte carlo", "sampling", "helium"]


def test_ids_carry_over_and_a_repeat_run_is_identical(monkeypatch):
    papers = {f"p{k}": paper(f"p{k}", 1 + 7 * (k % 3), [f"A{k}"]) for k in range(16)}
    for k, p in enumerate(papers.values()):
        p["abstract"] = "spin squeezing in arrays" if k < 8 else "magic state cultivation"
    pool = {i: np.eye(4)[0 if k < 8 else 1] for k, i in enumerate(papers)}
    monkeypatch.setattr(emerging, "cluster", lambda X: (X[:, 1] > 0.5).astype(int))
    fresh = {"as_of": None, "next_id": 1, "candidates": [], "previous": None}
    week1 = emerging.find(date(2026, 9, 20), papers, set(papers), pool, fresh, floor=0.0)
    assert [c["id"] for c in week1["candidates"]] == ["e001", "e002"]
    again = emerging.find(date(2026, 9, 20), papers, set(papers), pool, week1, floor=0.0)
    assert {k: v for k, v in again.items() if k != "previous"} == {k: v for k, v in week1.items() if k != "previous"}
    week2 = emerging.find(date(2026, 9, 27), papers, set(papers), pool, week1, floor=0.0)
    assert sorted((c["id"], c["first_seen"]) for c in week2["candidates"]) == \
        [("e001", "2026-09-20"), ("e002", "2026-09-20")]


def test_a_group_needs_a_distinctive_shared_phrase(monkeypatch):
    papers = {f"p{k}": paper(f"p{k}", 1 + 7 * (k % 3), [f"A{k}"]) for k in range(16)}
    for k, p in enumerate(papers.values()):
        p["abstract"] = ("model of spin squeezing" if k < 8 else "model of magic states") if k % 8 < 3 else "model results"
    pool = {i: np.eye(4)[0 if k < 8 else 1] for k, i in enumerate(papers)}
    monkeypatch.setattr(emerging, "cluster", lambda X: (X[:, 1] > 0.5).astype(int))
    fresh = {"as_of": None, "next_id": 1, "candidates": [], "previous": None}
    out = emerging.find(date(2026, 9, 20), papers, set(papers), pool, fresh, floor=0.0)
    # "model" is in every paper, and nothing else reaches half of either group.
    assert out["candidates"] == [] and out["rejected"] == {"no distinctive shared phrase": 2}
