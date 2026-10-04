"""
terms.py: the phrases a group of papers has in common, and how to rank them.

Rules:

  * The adjacency analyser: unigrams, plus bigrams only of words that are next
    to each other in the text. Punctuation splits the text into runs, and a
    stopword breaks adjacency. sklearn's n-grams drop stopwords first and then
    glue the neighbours together, which makes phrases nobody wrote ("learning
    reinforcement" out of "reinforcement learning" read backwards across a
    removed word); this never does.
  * Math ($...$) and LaTeX commands are stripped before anything else, so
    "\\mathcal{O}" never becomes a term.
  * "quantum" is a stopword. Every paper here is quantum, so it separates
    nothing, and dropping it turns "quantum key distribution" into the bigram
    "key distribution", which is the part that carries the meaning.
  * Counts are documents, not occurrences: a term counts once per paper, so one
    abstract that repeats a word twenty times cannot carry a topic's terms.
  * Ranking is class-based TF-IDF (c-TF-IDF): how much of a class's papers use a
    term, weighted down by how common the term is everywhere.
"""

import math
import re
from collections import Counter

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

BOILERPLATE = {
    "we", "our", "show", "shows", "shown", "propose", "proposed", "paper", "result", "results",
    "study", "studies", "studied", "demonstrate", "demonstrated", "approach", "approaches",
    "method", "methods", "novel", "based", "using", "use", "used", "provide", "provides",
    "investigate", "investigated", "scheme", "schemes", "protocol", "protocols", "framework",
    "frameworks", "quantum", "work", "present", "presented", "find", "found", "new", "also",
    "can", "may", "however", "thus", "furthermore", "moreover", "here", "two", "one", "via",
    "well", "within", "respectively", "e.g", "i.e", "et", "al", "obtain", "obtained", "case",
    "cases", "particular", "particularly", "general", "different", "various", "effect", "effects",
    "high", "low", "large", "small", "significant", "significantly", "recent", "recently",
    "important", "analysis", "problem", "problems", "allows", "allow", "enables", "enable",
    "terms", "order", "number", "able", "given", "way", "first", "second", "both", "each",
    "while", "due", "type", "types", "form", "level", "levels", "range", "key",
}
STOPWORDS = frozenset(ENGLISH_STOP_WORDS) | BOILERPLATE
# "key" is in the list for "key result"; key distribution is kept by name below.
KEEP = frozenset({"key"})

MATH = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]", re.S)
COMMAND = re.compile(r"\\[a-zA-Z]+\*?(?:\{[^{}]*\})?")
RUNS = re.compile(r"[^\w\s\-]+|\s-\s|--+")
WORD = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def clean(text: str) -> str:
    text = MATH.sub(" , ", text)
    text = COMMAND.sub(" , ", text)
    return text.lower()


def analyse(text: str):
    """The set of terms in one text: unigrams and adjacent bigrams."""
    out = set()
    for run in RUNS.split(clean(text)):
        prev = None
        for tok in run.split():
            tok = tok.strip("-_")
            stop = (tok in STOPWORDS and tok not in KEEP) or not WORD.match(tok) or len(tok) < 2
            if stop:
                prev = None
                continue
            if tok not in STOPWORDS:
                out.add(tok)
            if prev is not None:
                out.add(prev + " " + tok)
            prev = tok
    return out


def doc_terms(papers):
    return [analyse(p["title"] + ". " + p["abstract"]) for p in papers]


def ctfidf(class_docs, all_df=None, n_docs=None, top=20, min_df=3):
    """class_docs: {class: [set of terms per paper]}. Returns {class: [(term, score)]}.

    tf is the share of the class's papers using the term; idf is
    log(1 + N / df) over every paper, so a term every class uses scores low."""
    if all_df is None:
        all_df = Counter(t for docs in class_docs.values() for d in docs for t in d)
        n_docs = sum(len(docs) for docs in class_docs.values())
    out = {}
    for c, docs in class_docs.items():
        df = Counter(t for d in docs for t in d)
        n = max(len(docs), 1)
        scored = [(t, (k / n) * math.log(1 + n_docs / all_df[t])) for t, k in df.items() if k >= min_df]
        scored.sort(key=lambda x: (-x[1], x[0]))
        out[c] = scored[:top]
    return out
