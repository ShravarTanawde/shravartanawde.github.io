from datetime import datetime, timezone

import pytest

from pipeline.arxiv import ApiError, TransientError, clean_categories, is_withdrawn, parse_feed, strip_version
from tests.feeds import entry, error_feed, feed


def test_strip_version_new_and_old_style_ids():
    assert strip_version("http://arxiv.org/abs/2609.01234v2") == "2609.01234"
    assert strip_version("http://arxiv.org/abs/2609.01234") == "2609.01234"
    assert strip_version("http://arxiv.org/abs/quant-ph/0601001v3") == "quant-ph/0601001"
    assert strip_version("http://arxiv.org/abs/2609.12345v12") == "2609.12345"


def test_categories_keep_taxonomy_terms_only():
    raw = ["quant-ph", "cond-mat.str-el", "81P68", "F.2.2", "math.MP", "68Q12, 81P68",
           "I.2.6; F.1.1", "physics.atom-ph", "cs.LG", "quant-ph"]
    assert clean_categories(raw) == ["quant-ph", "cond-mat.str-el", "math.MP", "physics.atom-ph", "cs.LG"]


# Real comments from the 2021-10 to 2026-09 backfill, trimmed.
WITHDRAWN = [
    "This paper has been withdrawn by the authors. This paper has been superseded by arXiv:2405.00001",
    "This article has been withdrawn by arXiv administrators due to disputed authorship",
    "Withdrawn due to conceptual errors highlighted by referees",
    "Withdrawal due to errors: (1) entropy squeezing calculated with wrong information entropy",
    "Withdrawn for revision: the manuscript requires additional scalability analysis",
    "Withdrawn by the author due to major revision",
    "The paper is withdrawn as some errors are noticed and they need to be fixed",
    "Therefore, the current version is being withdrawn to prevent dissemination of inaccurate results",
    "The manuscript is withdrawn pending additional experiments and analysis",
    "Accordingly, I respectfully request that this work be withdrawn",
    "Hence I seek withdrawal of this paper as it might be misleading",
    "I am writing to request the withdrawal of my submission",
    "We withdraw this submission since a few components of the analysis were found to be faulty",
    "The authors have withdrawn this manuscript because institutional authorization was not obtained",
    "After careful consideration, we have decided to withdraw the manuscript",
    "This paper includes some not-fully-verified claims, and therefore need to be withdrawn",
]
NOT_WITHDRAWN = [
    "It could be withdrawn if accepted in IEEE Transaction on Quantum Engineering",
    "A previous version of this manuscript was withdrawn due to an error in interpretation.",
    "52 pages, 5 figures. This is a merger of the original version 1 with the withdrawn paper arXiv:2407.18191.",
    "14 pages, Replaces the withdrawn manuscript (arXiv:quant-ph:1911.03628)",
    "This is a replacement for the previously withdrawn paper.",
    "It is the corrected and modified version of arXiv:2105.14712, which was recently withdrawn",
    "v2: symmetry correction (the linear envelope coupling of v1 is forbidden and withdrawn; amplitude fixed)",
    "This manuscript supersedes and substantially expands upon the earlier, withdrawn preprint arXiv:2504.15607",
    "Section 6 (quantum-classical separation) is withdrawn. Lemma 6.1 extended the rate.",
    "12 pages. Complete rewrite of v1, new title. Withdrawn as erroneous: the definition (Def. 4)",
    "v3: substantive correction; v2's central claims are withdrawn",
    "Accepted at the QCI 2026 workshop; withdrawn from the proceedings because the author could not attend",
]


def test_withdrawal_notices_about_the_paper_itself():
    for c in WITHDRAWN:
        assert is_withdrawn("An abstract.", c), c


def test_other_mentions_of_withdrawal_do_not_count():
    for c in NOT_WITHDRAWN:
        assert not is_withdrawn("An abstract.", c), c


def test_abstracts_count_only_for_a_notice():
    assert is_withdrawn("Withdrawn due to an error in Eq. 3.", None)
    assert is_withdrawn("This paper has been withdrawn because of a flaw.", None)
    assert not is_withdrawn("We bound the work withdrawn from a quantum battery.", None)
    assert not is_withdrawn("Energy is withdrawn from the cavity mode.", "12 pages")


def test_parse_feed_fields():
    body = feed(2, [
        entry("2609.00001v2", published="2026-09-01T03:04:05Z", updated="2026-09-20T00:00:00Z",
              primary="cond-mat.mes-hall", cats=("cond-mat.mes-hall", "quant-ph", "81P68", "F.2.2"),
              title="Spin   qubits\n in silicon", abstract="We  study\nspins.",
              authors=("A. One", "B. Two"), comment="10 pages", journal_ref="PRX 1, 2 (2026)",
              doi="10.1/abc"),
        entry("2609.00002v1"),
    ])
    total, recs = parse_feed(body)
    assert total == 2 and len(recs) == 2
    r = recs[0]
    assert r["id"] == "2609.00001"
    assert r["title"] == "Spin qubits in silicon"
    assert r["abstract"] == "We study spins."
    assert r["authors"] == ["A. One", "B. Two"]
    assert r["primary_category"] == "cond-mat.mes-hall"
    assert r["categories"] == ["cond-mat.mes-hall", "quant-ph"]
    assert r["is_primary"] is False
    assert r["submitted"] == datetime(2026, 9, 1, 3, 4, 5, tzinfo=timezone.utc)
    assert r["updated"] == datetime(2026, 9, 20, tzinfo=timezone.utc)
    assert (r["comment"], r["journal_ref"], r["doi"]) == ("10 pages", "PRX 1, 2 (2026)", "10.1/abc")
    assert r["withdrawn"] is False
    assert recs[1]["is_primary"] is True
    assert recs[1]["comment"] is None


def test_error_entry_raises_api_error():
    with pytest.raises(ApiError, match="incorrect id format"):
        parse_feed(error_feed())


def test_garbage_body_is_transient():
    with pytest.raises(TransientError):
        parse_feed(b"<html>Service Unavailable</html")
    with pytest.raises(TransientError):
        parse_feed(b"<html><body>busy</body></html>")


def test_empty_feed():
    assert parse_feed(feed(0)) == (0, [])
