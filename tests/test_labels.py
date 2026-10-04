import json

import pytest

from pipeline import labels

GOOD = {"name": "Spin squeezing", "description": "Papers that make spin-squeezed states.",
        "facet": "Sensing & metrology", "ml_adjacent": False, "coherence": "coherent"}


@pytest.fixture
def where(tmp_path, monkeypatch):
    monkeypatch.setattr(labels, "LABELS", tmp_path)
    return tmp_path


def test_add_merges_and_keeps_the_facet_list(where):
    labels.add("v2", {"fine": {"t001": GOOD}, "broad": {"b01": {"name": "Sensing", "description": "Papers on it."}}})
    data = labels.add("v2", {"fine": {"t002": {**GOOD, "name": "Atom interferometry"}}})
    assert set(data["fine"]) == {"t001", "t002"} and "Miscellaneous" in data["facets"]
    assert json.loads((where / "v2.json").read_text())["fine"]["t002"]["name"] == "Atom interferometry"


@pytest.mark.parametrize("change, message", [
    ({"name": "Squeezing"}, "2 to 6 words"),
    ({"description": "This topic is about squeezing."}, "Papers that"),
    ({"description": "Papers that " + "do " * 30}, "over 25 words"),
    ({"facet": "Opportunities"}, "facet"),
    ({"coherence": "fine"}, "coherence"),
    ({"name": "Spin squeezing — arrays"}, "em dash"),
])
def test_add_refuses_bad_labels_and_saves_nothing(where, change, message):
    with pytest.raises(labels.BadLabel, match=message):
        labels.add("v2", {"fine": {"t001": {**GOOD, **change}}})
    assert not (where / "v2.json").exists()
