"""
labels.py: recording topic labels, and the review sheet a person checks.

    python -m pipeline.labels add --version v2 < fragment.json
    python -m pipeline.labels review --version v2

`add` merges a JSON fragment ({"broad": {...}, "fine": {...}}) into
labels/<version>.json. `review` writes .local/labels/<version>/REVIEW.md: one
row per topic, grouped by broad topic, with its flags, three typical titles and
(from v2 on) what it continues, split from or merged from.

Rules, checked on every add, because these strings go straight onto the page:

  * A fine topic's name is 2 to 6 words; its description starts "Papers that"
    and is at most 25 words; its facet is in the version's facet list; its
    coherence is coherent, mixed or housekeeping.
  * No em dash anywhere.
  * Names are written by a person (or drafted with Claude and checked by one)
    from the label packets. Nothing here generates one, and the weekly Action
    never runs this.
"""

import argparse
import collections
import json
import re
import sys
from pathlib import Path

from . import config

DEFAULT_FACETS = [
    "Platforms & hardware", "Algorithms & complexity", "Error correction & fault tolerance",
    "Information & entanglement theory", "Communication & cryptography", "Sensing & metrology",
    "Many-body & simulation", "Open systems & thermodynamics", "Light-matter & quantum optics",
    "Gravity & high-energy", "Foundations", "Methods & numerics", "Miscellaneous", "Housekeeping",
]
LABELS = config.ROOT / "labels"


class BadLabel(Exception):
    pass


def check(tid, v, facets):
    def need(cond, msg):
        if not cond:
            raise BadLabel(f"{tid}: {msg}")
    need(v.get("facet") in facets, f"facet {v.get('facet')!r} is not in the facet list")
    need(v["description"].startswith("Papers that"), 'description must start "Papers that"')
    need(len(v["description"].split()) <= 25, "description is over 25 words")
    need(2 <= len(v["name"].split()) <= 6, f"name {v['name']!r} is not 2 to 6 words")
    need(v.get("coherence") in {"coherent", "mixed", "housekeeping"}, "coherence must be coherent, mixed or housekeeping")
    need(isinstance(v.get("ml_adjacent"), bool), "ml_adjacent must be true or false")
    need("—" not in v["name"] + v["description"] + v.get("note", ""), "contains an em dash")


def add(version, fragment):
    path = LABELS / f"{version}.json"
    data = json.loads(path.read_text()) if path.exists() else \
        {"version": version, "facets": DEFAULT_FACETS, "broad": {}, "fine": {}}
    facets = set(data.get("facets", DEFAULT_FACETS))
    for tid, v in fragment.get("fine", {}).items():
        check(tid, v, facets)
    for bid, v in fragment.get("broad", {}).items():
        if "—" in v["name"] + v["description"]:
            raise BadLabel(f"{bid}: contains an em dash")
    for level in ("broad", "fine"):
        data[level].update(fragment.get(level, {}))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    return data


def examples(packet):
    """First three typical titles per fine topic in one broad packet."""
    out, cur, sec = collections.defaultdict(list), None, None
    if not packet.exists():
        return out
    for line in packet.read_text().splitlines():
        if line.startswith("## t"):
            cur, sec = line.split()[1], None
        elif line.rstrip(":") in ("typical", "random", "boundary"):
            sec = line.rstrip(":")
        elif line.startswith("- ") and cur and sec == "typical" and len(out[cur]) < 3:
            m = re.match(r"- (.*?) \(\d{4}\)\. ", line)
            out[cur].append((m.group(1) if m else line[2:120]).replace("|", "/"))
    return out


def review(version):
    labels = json.loads((LABELS / f"{version}.json").read_text())
    draft = json.loads((config.LOCAL / "fit" / version / "draft.json").read_text())
    packets = config.LOCAL / "labels" / version
    fine = {t["id"]: t for t in draft["fine"]}

    def flags(tid):
        lab, fit, f = labels["fine"][tid], fine[tid], []
        if fit["unstable"]:
            f.append("UNSTABLE")
        if lab["coherence"] != "coherent":
            f.append(lab["coherence"].upper())
        if lab["facet"] == "Miscellaneous":
            f.append("MISC")
        lin = fit.get("lineage")
        if lin and lin["kind"] != "continues":
            f.append(lin["kind"].upper())
        elif lin and lin["names"] and lab["name"] != lin["names"][0]:
            f.append("RENAMED")
        return f

    flagged = {k: flags(k) for k in fine}
    facets = collections.Counter(labels["fine"][k]["facet"] for k in fine)
    sizes = collections.Counter()
    for k in fine:
        sizes[labels["fine"][k]["facet"]] += fine[k]["size"]
    out = [f"# quant-ph Radar topic labels, {version}: review sheet", "",
           f"{len(draft['broad'])} broad topics, {len(fine)} fine topics, "
           f"{sum(t['size'] for t in fine.values()):,} assigned papers in the fit window.", "",
           "Flags: **UNSTABLE** did not reappear reliably across seeds. **MIXED** covers two or more themes. "
           "**MISC** is filed under Miscellaneous. **SPLIT**, **MERGED**, **NEW** and **RENAMED** compare "
           "with the previous model (from v2 on). The note column says why.", "",
           "## Facets", "", "| facet | fine topics | papers |", "|---|---:|---:|"]
    out += [f"| {f} | {n} | {sizes[f]:,} |" for f, n in facets.most_common()] + [""]
    for title, keys in [("Unstable", {"UNSTABLE"}), ("Mixed", {"MIXED", "HOUSEKEEPING"}), ("Miscellaneous", {"MISC"}),
                        ("Changed since the previous model", {"SPLIT", "MERGED", "NEW", "RENAMED"})]:
        ids = [k for k in sorted(fine) if keys & set(flagged[k])]
        out += [f"## {title} ({len(ids)})", "", ", ".join(f"{k} {labels['fine'][k]['name']}" for k in ids), ""]
    for b in draft["broad"]:
        lb = labels["broad"][b["id"]]
        ex = examples(packets / f"{b['id']}.md")
        out += [f"## {b['id']} {lb['name']} ({b['size']:,} papers)", "", lb["description"], "",
                "| id | flags | name | description | facet | ML | size | stab. | history | examples | note |",
                "|---|---|---|---|---|---|---:|---:|---|---|---|"]
        for tid in b["children"]:
            lab, fit = labels["fine"][tid], fine[tid]
            lin = fit.get("lineage")
            hist = f"{lin['kind']} {', '.join(lin['names'])}" if lin else ""
            out.append(f"| {tid} | {' '.join(f'**{x}**' for x in flagged[tid])} | {lab['name']} | "
                       f"{lab['description']} | {lab['facet']} | {'yes' if lab['ml_adjacent'] else ''} | "
                       f"{fit['size']} | {fit['stability']:.2f} | {hist} | {'<br>'.join(ex[tid])} | {lab.get('note', '')} |")
        out.append("")
    text = "\n".join(out) + "\n"
    packets.mkdir(parents=True, exist_ok=True)
    (packets / "REVIEW.md").write_text(text)
    return packets / "REVIEW.md"


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.labels")
    ap.add_argument("action", choices=["add", "review"])
    ap.add_argument("--version", required=True)
    args = ap.parse_args(argv)
    try:
        if args.action == "add":
            data = add(args.version, json.load(sys.stdin))
            print(f"{len(data['broad'])} broad, {len(data['fine'])} fine labelled")
        else:
            print(f"Wrote {review(args.version)}")
    except BadLabel as e:
        raise SystemExit(f"Not saved: {e}")


if __name__ == "__main__":
    main()
