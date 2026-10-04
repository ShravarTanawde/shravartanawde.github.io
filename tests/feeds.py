"""
feeds.py: builds Atom feeds shaped like the arXiv API's, for tests that must not
touch the network.
"""

from xml.sax.saxutils import escape

HEAD = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<feed xmlns="http://www.w3.org/2005/Atom" '
    'xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" '
    'xmlns:arxiv="http://arxiv.org/schemas/atom">\n'
    "<title>arXiv Query</title>\n"
    "<opensearch:totalResults>{total}</opensearch:totalResults>\n"
)


def entry(arxiv_id, published="2026-09-10T12:00:00Z", primary="quant-ph",
          cats=("quant-ph",), title="A title", abstract="An abstract.",
          authors=("A. Author",), comment=None, journal_ref=None, doi=None,
          updated=None):
    parts = [
        "<entry>",
        f"<id>http://arxiv.org/abs/{arxiv_id}</id>",
        f"<updated>{updated or published}</updated>",
        f"<published>{published}</published>",
        f"<title>{escape(title)}</title>",
        f"<summary>{escape(abstract)}</summary>",
    ]
    parts += [f"<author><name>{escape(a)}</name></author>" for a in authors]
    if comment:
        parts.append(f"<arxiv:comment>{escape(comment)}</arxiv:comment>")
    if journal_ref:
        parts.append(f"<arxiv:journal_ref>{escape(journal_ref)}</arxiv:journal_ref>")
    if doi:
        parts.append(f"<arxiv:doi>{escape(doi)}</arxiv:doi>")
    parts.append(f'<arxiv:primary_category term="{primary}" scheme="http://arxiv.org/schemas/atom"/>')
    parts += [f'<category term="{escape(c)}" scheme="http://arxiv.org/schemas/atom"/>' for c in cats]
    parts.append("</entry>")
    return "\n".join(parts)


def feed(total, entries=()):
    return (HEAD.format(total=total) + "\n".join(entries) + "\n</feed>\n").encode("utf-8")


def error_feed(message="incorrect id format for 1234.12345"):
    return feed(1, [
        "<entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1234.12345</id>"
        "<title>Error</title>"
        f"<summary>{escape(message)}</summary>"
        "<updated>2026-10-04T00:00:00Z</updated>"
        "<link href=\"http://arxiv.org/api/errors#incorrect_id\" rel=\"alternate\" type=\"text/html\"/>"
        "<author><name>arXiv api core</name></author></entry>"
    ])
