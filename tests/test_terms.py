from pipeline.terms import analyse, ctfidf


def test_bigrams_only_from_adjacent_words():
    t = analyse("Reinforcement learning for surface code decoding.")
    assert {"reinforcement learning", "surface code", "code decoding"} <= t
    assert "learning surface" not in t  # "for" sits between them
    assert "learning reinforcement" not in t


def test_punctuation_breaks_adjacency():
    t = analyse("We study trapped ions, neutral atoms; and photonic chips.")
    assert "trapped ions" in t and "neutral atoms" in t and "photonic chips" in t
    assert "ions neutral" not in t and "atoms photonic" not in t


def test_quantum_is_a_stopword_but_the_phrase_survives():
    t = analyse("Quantum key distribution over deployed fibre")
    assert "quantum" not in t and "quantum key" not in t
    assert "key distribution" in t and "deployed fibre" in t


def test_math_and_commands_are_stripped():
    t = analyse(r"Scaling as $\mathcal{O}(n^2)$ with \emph{barren plateaus} in \textbf{QAOA}")
    assert not any("mathcal" in x or "emph" in x or "textbf" in x for x in t)
    assert "n^2" not in t
    assert "barren" not in t or "barren plateaus" in t


def test_boilerplate_never_appears():
    t = analyse("In this paper we propose a novel framework based on our method and show results.")
    assert t == set()


def test_hyphenated_words_are_one_token():
    t = analyse("Two-qubit gates with non-Markovian noise")
    assert "two-qubit gates" in t and "non-markovian noise" in t


def test_ctfidf_prefers_terms_specific_to_a_class():
    a = [{"surface code", "decoder"}, {"surface code", "noise"}, {"surface code", "decoder"}]
    b = [{"trapped ion", "noise"}, {"trapped ion", "noise"}, {"trapped ion"}]
    ranked = ctfidf({"a": a, "b": b}, min_df=2)
    assert ranked["a"][0][0] == "surface code"
    assert ranked["b"][0][0] == "trapped ion"
    assert ranked["b"][0][1] > dict(ranked["b"])["noise"]
