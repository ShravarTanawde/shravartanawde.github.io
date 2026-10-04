import pytest

from pipeline import finalize

DRAFT = {
    "fine": [{"id": "t001", "parent": "b01", "size": 40, "terms": ["a"], "neighbours": ["t002"],
              "stability": 0.9, "unstable": False},
             {"id": "t002", "parent": "b01", "size": 35, "terms": ["b"], "neighbours": ["t001"],
              "stability": 0.2, "unstable": True}],
    "broad": [{"id": "b01", "children": ["t001", "t002"], "size": 75, "terms": ["a", "b"]}],
}


def labels(facet="Foundations"):
    fine = {i: {"name": f"Topic {i}", "description": "Papers that do things.", "facet": facet,
                "ml_adjacent": False, "coherence": "coherent"} for i in ("t001", "t002")}
    return {"facets": ["Foundations", "Miscellaneous"], "broad": {"b01": {"name": "Group", "description": "x"}},
            "fine": fine}


def test_labels_must_cover_every_topic():
    lab = labels()
    del lab["fine"]["t002"]
    with pytest.raises(SystemExit, match="missing"):
        finalize.check_labels(lab, DRAFT)


def test_facet_must_be_in_the_list():
    with pytest.raises(SystemExit, match="Facet"):
        finalize.check_labels(labels("Opportunities"), DRAFT)


def test_topics_doc_carries_labels_and_fit_fields():
    doc = finalize.topics_doc(labels(), DRAFT)
    assert doc["facets"] == ["Foundations", "Miscellaneous"]
    t2 = doc["fine"][1]
    assert (t2["name"], t2["parent"], t2["unstable"], t2["housekeeping"], t2["lineage"]) == \
        ("Topic t002", "b01", True, False, None)
    assert doc["broad"][0]["children"] == ["t001", "t002"]


def test_refuses_to_overwrite_a_version(tmp_path, monkeypatch):
    monkeypatch.setattr(finalize, "MODEL_ROOT", tmp_path / "model")
    monkeypatch.setattr(finalize, "ASSIGN_ROOT", tmp_path / "assign")
    (tmp_path / "model" / "v9").mkdir(parents=True)
    with pytest.raises(SystemExit, match="immutable"):
        finalize.finalize("v9")
