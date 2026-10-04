"""
config.py: paths, the contact address, and the request etiquette arXiv asks for.

Rules this file keeps:

  * The contact address is never written into a committed file. Both branches
    of this repository are public, so it is read at run time from the
    RADAR_CONTACT environment variable (a repository secret in the Action), or
    on the laptop from .local/contact, and the run stops if neither exists.
    tests/test_no_contact_leak.py fails if an address turns up in a tracked file.
  * One connection at a time, and no more than one request every three
    seconds. That is the rate in arXiv's API terms
    (info.arxiv.org/help/api/tou.html, checked 4 Oct 2026), and it applies to
    every machine under our control as a whole. The interval below is a second
    wider than that for headroom.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".local"
CACHE = LOCAL / "cache"
DATA = ROOT / "data"
PAPERS = DATA / "papers"

API_URL = "https://export.arxiv.org/api/query"
LISTING_URL = "https://arxiv.org/list/quant-ph/{month}"
CATEGORY = "quant-ph"

REQUEST_INTERVAL_S = 4.0
PAGE_SIZE = 500
# The API refuses start + max_results past this, so a window that reports more
# has to be split before paging.
API_RESULT_CAP = 30000

SITE_URL = "https://shravartanawde.github.io/tools/arxiv-radar/"


def contact() -> str:
    value = os.environ.get("RADAR_CONTACT", "").strip()
    if not value:
        path = LOCAL / "contact"
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
    if not value or "@" not in value:
        raise SystemExit(
            "No contact address. Set RADAR_CONTACT, or put one in .local/contact. "
            "arXiv asks for a way to reach whoever runs a harvester."
        )
    return value


def user_agent() -> str:
    return f"quant-ph-radar/1.0 (+{SITE_URL}; mailto:{contact()})"
