"""
The harvester's contact address is read at run time and must never be written
into a file git would commit. Both branches are public; one of them is a website.
"""

import re
import subprocess

from pipeline import config

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]")
# Placeholders used in docs and tests, and git's own bot identity.
ALLOWED = {"you@example.com", "41898282+github-actions[bot]@users.noreply.github.com"}


def committable_files():
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=config.ROOT, capture_output=True, check=True,
    ).stdout.decode()
    return [p for p in out.split("\0") if p]


def test_no_email_address_in_any_committable_file():
    hits = []
    for rel in committable_files():
        path = config.ROOT / rel
        if not path.is_file() or path.suffix in {".parquet", ".npy", ".npz"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in EMAIL.finditer(text):
            if m.group(0) not in ALLOWED:
                hits.append(f"{rel}: {m.group(0)}")
    assert not hits, "email address in a committable file: " + ", ".join(hits)


def test_the_contact_file_is_ignored():
    rc = subprocess.run(["git", "check-ignore", "-q", ".local/contact"], cwd=config.ROOT).returncode
    assert rc == 0
