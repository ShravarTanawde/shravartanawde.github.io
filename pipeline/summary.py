"""
summary.py: build the page's two data files from every shard.

    python -m pipeline.summary --out ../portfolio/tools/arxiv-radar/data

Writes radar.json (every range x filter, every topic) and details.json (paper
lists for the topic panel). The exact shape is documented in the main README
and checked by validate() before anything is written.

Rules:

  * Built from all shards every time, never patched: a failed or half-pushed
    week heals on the next run, because nothing here depends on last week's
    output.
  * Windows end on data_through, the last day every paper is assigned for. It
    comes from the assignment shards' own "through" metadata, not from the
    calendar, so a paper the model has not seen yet can never be counted.
  * Shares are papers in the topic / all papers in the window under the same
    filter. Unassigned papers stay in the denominator, so shares sum below 1.
  * Topic rows are arrays in a fixed column order (topic_cols) to keep the
    file small. Numbers are rounded to four significant figures.
  * Sparklines hold counts per bucket, not shares; the page divides by the
    view's volume counts, which keeps every row to small integers.
  * Terms gaining and losing ground are drawn only from the topics' own terms
    (each topic's top 20). Compared freely, the list fills with writing style:
    "pivotal" and "showcasing" falling, "fixes" and "budgets" rising, across
    every field at once. Restricting to terms that characterise some topic
    keeps the section about what papers are on.
"""

import argparse
import json
import math
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

from . import config, emerging, stats, store
from .arxiv import log
from .terms import analyse
from .windows import month_end

SCHEMA = 1
RANGES = {"1W": 7, "1M": 28, "3M": 91, "6M": 182, "1Y": 364, "5Y": 1820}
GRANULARITY = {"1W": "day", "1M": "day", "3M": "week", "6M": "week", "1Y": "week", "5Y": "month"}
FILTERS = ("all", "primary", "cross")
TOPIC_COLS = ["id", "n", "n_now", "n_then", "share_now", "share_then", "delta_pts", "z", "signal", "spark"]
TREND_QUARTERS = 20
QUARTER_DAYS = 91
LATEST = 20
EMERGING_SHOWN = 10
TOP_TERMS = 10
CATEGORIES = 12
CROSS_SOURCES = 10


def sig(x, n=4):
    if x == 0 or not math.isfinite(x):
        return 0
    return round(x, n - 1 - int(math.floor(math.log10(abs(x)))))


class Context:
    pass


def latest_version():
    versions = sorted((p.name for p in (config.DATA / "model").glob("v*")), key=lambda v: int(v[1:]))
    if not versions:
        raise SystemExit("No model in data/model/; run pipeline.finalize first")
    return versions[-1]


def read_assignments(version):
    """{id: topic or None}, and the last day the shards cover."""
    root = config.DATA / "assign" / version
    paths = [root / "backfill.parquet"] + sorted((root / "weekly").glob("*.parquet"))
    out, through = {}, None
    for path in paths:
        if not path.exists():
            continue
        meta = pq.read_schema(path).metadata or {}
        t = date.fromisoformat(meta[b"through"].decode())
        through = t if through is None else max(through, t)
        tab = pq.read_table(path, columns=["id", "topic"]).to_pydict()
        out.update(zip(tab["id"], tab["topic"]))
    if through is None:
        raise SystemExit(f"No assignments for {version}")
    return out, through


def read_similarity(version):
    """(topic, similarity) for every assigned paper, from the backfill."""
    tab = pq.read_table(config.DATA / "assign" / version / "backfill.parquet", columns=["topic", "similarity"])
    return tab["topic"].to_pylist(), tab["similarity"].to_numpy()


def load_context():
    ctx = Context()
    ctx.version = latest_version()
    mdir = config.DATA / "model" / ctx.version
    ctx.model = json.loads((mdir / "model.json").read_text())
    ctx.topics = json.loads((mdir / "topics.json").read_text())
    ctx.typical = json.loads((mdir / "typical.json").read_text())
    assigned, ctx.data_through = read_assignments(ctx.version)
    if ctx.data_through.weekday() != 6:
        raise SystemExit(f"Assignments end on {ctx.data_through}, which is not a Sunday")
    papers = {}
    missing = 0
    for p in store.read_papers(config.PAPERS):
        if p["submitted"].date() > ctx.data_through:
            continue
        if p["id"] not in assigned:
            missing += 1
            continue
        papers[p["id"]] = p
    if missing:
        raise SystemExit(f"{missing} papers up to {ctx.data_through} have no assignment under {ctx.version}")
    ctx.papers = papers
    ctx.assigned = {i: assigned[i] for i in papers}
    ctx.unassigned_ids = {i for i, t in ctx.assigned.items() if t is None}
    return ctx


def windows(end: date, first: date):
    """{range: (start, end, prev_start, prev_end, now_start)}.

    For 5Y the comparison is the first 364 days of the range against the last
    364, so now_start marks the last year and prev_* the first."""
    out = {}
    for r, days in RANGES.items():
        start = end - timedelta(days=days - 1)
        if r == "5Y":
            first_monday = first + timedelta(days=(7 - first.weekday()) % 7)
            start = max(start, first_monday)
            out[r] = (start, end, start, start + timedelta(days=363), end - timedelta(days=363))
        else:
            out[r] = (start, end, start - timedelta(days=days), start - timedelta(days=1), start)
    return out


def buckets(start: date, end: date, gran: str):
    """Bucket start dates, labels, and a function day -> bucket index."""
    if gran == "day":
        n = (end - start).days + 1
        labels = [(start + timedelta(days=k)).isoformat() for k in range(n)]
        return labels, (lambda d: (d - start).days), False, False
    if gran == "week":
        n = ((end - start).days + 1) // 7
        labels = [(start + timedelta(days=7 * k)).isoformat() for k in range(n)]
        return labels, (lambda d: (d - start).days // 7), False, False
    labels, cur = [], date(start.year, start.month, 1)
    while cur <= end:
        labels.append(f"{cur.year:04d}-{cur.month:02d}")
        cur = month_end(cur) + timedelta(days=1)
    idx = lambda d: (d.year - start.year) * 12 + d.month - start.month
    return labels, idx, start.day != 1, end != month_end(date(end.year, end.month, 1))


def build(ctx):
    fine = ctx.topics["fine"]
    broad = ctx.topics["broad"]
    fine_idx = {t["id"]: k for k, t in enumerate(fine)}
    parent_idx = {b["id"]: k for k, b in enumerate(broad)}
    fine_parent = np.array([parent_idx[t["parent"]] for t in fine])
    ids = sorted(ctx.papers, key=lambda i: (ctx.papers[i]["submitted"], i))
    P = [ctx.papers[i] for i in ids]
    first = P[0]["submitted"].date()
    end = ctx.data_through
    day = np.array([(p["submitted"].date() - first).days for p in P])
    topic = np.array([-1 if ctx.assigned[i] is None else fine_idx[ctx.assigned[i]] for i in ids])
    btopic = np.where(topic >= 0, fine_parent[np.maximum(topic, 0)], -1)
    primary = np.array([p["is_primary"] for p in P])
    masks = {"all": np.ones(len(P), bool), "primary": primary, "cross": ~primary}
    K, B = len(fine), len(broad)

    log("Reading terms from every abstract")
    term_sets = [analyse(p["title"] + ". " + p["abstract"]) for p in P]
    topical = {t for x in fine + broad for t in x["terms"]}
    vocab = Counter(t for s in term_sets for t in s if t in topical)
    vocab = {t: k for k, t in enumerate(sorted(t for t, c in vocab.items() if c >= stats.TERM_MIN["1W"]))}
    names = sorted(vocab, key=vocab.get)
    flat = np.fromiter((vocab[t] for s in term_sets for t in s if t in vocab), dtype=np.int32)
    owner = np.repeat(np.arange(len(P)), [sum(1 for t in s if t in vocab) for s in term_sets])

    def df(mask):
        c = np.bincount(flat[mask[owner]], minlength=len(vocab))
        return {names[k]: int(v) for k, v in zip(np.flatnonzero(c), c[c > 0])}

    def dmask(a: date, b: date):
        return (day >= (a - first).days) & (day <= (b - first).days)

    views = {}
    for r, (start, stop, ps, pe, ns) in windows(end, first).items():
        labels, bidx, partial_first, partial_last = buckets(start, stop, GRANULARITY[r])
        win, now, then = dmask(start, stop), dmask(ns, stop), dmask(ps, pe)
        views[r] = {}
        for f in FILTERS:
            m = masks[f]
            w, wn, wt = win & m, now & m, then & m
            N, Nn, Nt = int(w.sum()), int(wn.sum()), int(wt.sum())
            bucket = np.array([bidx(first + timedelta(days=int(d))) for d in day[w]]) if N else np.array([], int)
            volume = np.bincount(bucket, minlength=len(labels)).tolist() if N else [0] * len(labels)

            def rows(tp, k, prefix):
                cnt = np.bincount(tp[w][tp[w] >= 0], minlength=k)
                cn = np.bincount(tp[wn][tp[wn] >= 0], minlength=k)
                ct = np.bincount(tp[wt][tp[wt] >= 0], minlength=k)
                sp = np.zeros((k, len(labels)), int)
                sel = tp[w] >= 0
                np.add.at(sp, (tp[w][sel], bucket[sel]), 1)
                out = []
                for c in range(k):
                    sn = cn[c] / Nn if Nn else 0.0
                    st = ct[c] / Nt if Nt else 0.0
                    z = stats.ztest(cn[c], Nn, ct[c], Nt)
                    out.append([prefix(c), int(cnt[c]), int(cn[c]), int(ct[c]), sig(sn), sig(st),
                                sig(100 * (sn - st)), round(z, 2),
                                stats.signal(z, cn[c] + ct[c], stats.MIN_COMBINED[r]), sp[c].tolist()])
                return out

            scores = stats.term_scores(df(wn), Nn, df(wt), Nt, stats.TERM_MIN[r])
            folded = stats.fold_terms(scores, df(wn), df(wt)) if scores else {"gaining": [], "losing": []}
            cats = Counter(c for p, keep in zip(P, w) if keep for c in set(p["categories"]) if c != "quant-ph")
            srcs = Counter(p["primary_category"] for p, keep in zip(P, w) if keep and not p["is_primary"])
            views[r][f] = {
                "window": {"start": start.isoformat(), "end": stop.isoformat(),
                           "prev_start": ps.isoformat(), "prev_end": pe.isoformat(),
                           "now_start": ns.isoformat(), "granularity": GRANULARITY[r]},
                "totals": {"n": N, "n_now": Nn, "n_then": Nt,
                           "primary_share": sig(float(primary[w].mean())) if N else 0,
                           "unassigned_share": sig(float((topic[w] < 0).mean())) if N else 0},
                "volume": {"labels": labels, "counts": volume,
                           "partial_first": partial_first, "partial_last": partial_last},
                "topics": rows(topic, K, lambda c: fine[c]["id"]),
                "broad": rows(btopic, B, lambda c: broad[c]["id"]),
                "terms": {k: [[t, sig(100 * e), sig(100 * l), round(s, 3)] + ([why] if why else [])
                              for t, e, l, s, why in v] for k, v in folded.items()},
                "categories": {
                    "colisted": [[c, sig(100 * n / N)] for c, n in cats.most_common(CATEGORIES)] if N else [],
                    "cross_sources": [[c, sig(100 * n / N)] for c, n in srcs.most_common(CROSS_SOURCES)] if N else [],
                },
            }

    # Five-year trend: share fitted over 20 quarters of 13 weeks, whole ones only.
    q_starts = [end - timedelta(days=QUARTER_DAYS * (TREND_QUARTERS - q) - 1) for q in range(TREND_QUARTERS)]
    q_starts = [s for s in q_starts if s >= first]
    q_idx = np.full(len(P), -1)
    for q, s in enumerate(q_starts):
        q_idx[dmask(s, s + timedelta(days=QUARTER_DAYS - 1))] = q
    t_years = [(QUARTER_DAYS * q + QUARTER_DAYS / 2) / 365.25 for q in range(len(q_starts))]

    def trend(tp, k):
        out = [dict() for _ in range(k)]
        for f in FILTERS:
            sel = (q_idx >= 0) & masks[f]
            totals = np.bincount(q_idx[sel], minlength=len(q_starts))
            both = sel & (tp >= 0)
            counts = np.zeros((k, len(q_starts)), int)
            np.add.at(counts, (tp[both], q_idx[both]), 1)
            for c in range(k):
                fit = stats.poisson_trend(counts[c], totals, t_years)
                out[c][f] = None if fit is None else [round(100 * v, 1) for v in fit]
        return out

    fine_trend, broad_trend = trend(topic, K), trend(btopic, B)
    n5 = np.bincount(topic[topic >= 0], minlength=K)
    topics = [{
        "id": t["id"], "name": t["name"], "description": t["description"], "facet": t["facet"],
        "parent": t["parent"], "ml_adjacent": t["ml_adjacent"], "housekeeping": t["housekeeping"],
        "unstable": t["unstable"], "terms": t["terms"][:TOP_TERMS], "neighbours": t["neighbours"],
        "lineage": t["lineage"], "trend": fine_trend[c], "n_total": int(n5[c]),
    } for c, t in enumerate(fine)]
    broad_out = [{
        "id": b["id"], "name": b["name"], "description": b["description"], "children": b["children"],
        "terms": b["terms"][:TOP_TERMS], "trend": broad_trend[c],
    } for c, b in enumerate(broad)]

    state = emerging.load_state()
    if state.get("as_of") not in (None, end.isoformat()):
        raise SystemExit(f"Emerging state is for {state['as_of']}, not {end}; run pipeline.emerging")
    emerging_out = [{
        "id": c["id"], "first_seen": c["first_seen"], "n": c["n"], "weeks_seen": c["weeks_seen"],
        "weekly": c["weekly"], "terms": c["terms"],
        "papers": [[i, ctx.papers[i]["title"], ctx.papers[i]["submitted"].date().isoformat()]
                   for i in c["paper_ids"]],
    } for c in state.get("candidates", [])[:EMERGING_SHOWN]]

    last_week = dmask(end - timedelta(days=6), end)
    radar = {
        "schema": SCHEMA,
        "meta": {
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "data_through": end.isoformat(), "first_date": first.isoformat(),
            "n_papers_total": len(P),
            "model": {"version": ctx.version, "fitted_on": ctx.model["fitted_on"],
                      "embedding_model": ctx.model["embedding_model"], "revision": ctx.model["revision"],
                      "n_topics": K, "n_broad": B},
            "unassigned_last_week_pct": round(100 * float((topic[last_week] < 0).mean()), 1),
            "emerging_weeks": state.get("weeks", []),
        },
        "facets": ctx.topics["facets"],
        "topic_cols": TOPIC_COLS,
        "topics": topics,
        "broad": broad_out,
        "views": views,
        "emerging": emerging_out,
    }

    def paper_row(i, with_primary):
        p = ctx.papers[i]
        row = [i, p["title"], p["submitted"].date().isoformat()]
        return row + [1 if p["is_primary"] else 0] if with_primary else row

    by_topic = {}
    for i in reversed(ids):
        t = ctx.assigned[i]
        if t is not None and len(by_topic.setdefault(t, [])) < LATEST:
            by_topic[t].append(i)
    details = {
        "schema": SCHEMA,
        "cols": {"typical": ["id", "title", "submitted"], "latest": ["id", "title", "submitted", "is_primary"]},
        "topics": {t["id"]: {"typical": [paper_row(i, False) for i in ctx.typical[t["id"]] if i in ctx.papers],
                             "latest": [paper_row(i, True) for i in by_topic.get(t["id"], [])]}
                   for t in fine},
    }
    return radar, details


class Invalid(Exception):
    pass


def validate(radar, details=None):
    """Structural and numeric checks; raises Invalid with the first problem."""
    def need(cond, msg):
        if not cond:
            raise Invalid(msg)

    need(radar.get("schema") == SCHEMA, "unknown schema")
    for key in ("meta", "facets", "topic_cols", "topics", "broad", "views", "emerging"):
        need(key in radar, f"missing {key}")
    need(radar["topic_cols"] == TOPIC_COLS, "topic_cols changed")
    ids = [t["id"] for t in radar["topics"]]
    bids = [b["id"] for b in radar["broad"]]
    need(len(set(ids)) == len(ids) and len(set(bids)) == len(bids), "duplicate topic ids")
    facets = set(radar["facets"])
    for t in radar["topics"]:
        need(t["facet"] in facets, f"{t['id']} has an unknown facet")
        need(t["parent"] in bids, f"{t['id']} has an unknown parent")
    need(set(RANGES) == set(radar["views"]), "ranges missing")
    for r, byf in radar["views"].items():
        need(set(FILTERS) == set(byf), f"{r}: filters missing")
        for f, v in byf.items():
            where = f"{r}/{f}"
            tot = v["totals"]
            need(sum(v["volume"]["counts"]) == tot["n"], f"{where}: volume does not add up to n")
            need(len(v["volume"]["labels"]) == len(v["volume"]["counts"]), f"{where}: volume labels")
            for level, expect in (("topics", ids), ("broad", bids)):
                rows = v[level]
                need([row[0] for row in rows] == expect, f"{where}: {level} out of order")
                need(all(0 <= row[4] <= 1 and 0 <= row[5] <= 1 for row in rows), f"{where}: share outside [0, 1]")
                # Judged on exact counts: the stored shares are rounded to four
                # significant figures, and 400 roundings can add up past 1e-6.
                s_now = sum(row[2] for row in rows) / max(tot["n_now"], 1)
                s_then = sum(row[3] for row in rows) / max(tot["n_then"], 1)
                need(s_now <= 1 + 1e-6 and s_then <= 1 + 1e-6, f"{where}: {level} shares sum past 1")
                need(sum(row[1] for row in rows) <= tot["n"], f"{where}: {level} counts exceed n")
                need(all(sum(row[9]) == row[1] for row in rows), f"{where}: sparkline does not add up")
                need(all(row[8] in ("growing", "cooling", "steady", "sparse") for row in rows), f"{where}: signal")
    if details is not None:
        need(details.get("schema") == SCHEMA, "details: unknown schema")
        need(set(details["topics"]) == set(ids), "details: topics differ from radar")


def write(out_dir: Path, radar, details):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, doc in (("radar.json", radar), ("details.json", details)):
        tmp = out_dir / (name + ".tmp")
        tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
        tmp.replace(out_dir / name)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.summary")
    ap.add_argument("--out", required=True, help="the tool's data/ folder in the main checkout")
    args = ap.parse_args(argv)
    ctx = load_context()
    radar, details = build(ctx)
    validate(radar, details)
    write(Path(args.out), radar, details)
    sizes = {n: (Path(args.out) / n).stat().st_size for n in ("radar.json", "details.json")}
    log(f"Summary through {ctx.data_through}: {len(ctx.papers)} papers; "
        + ", ".join(f"{n} {s / 1e6:.2f} MB" for n, s in sizes.items()))


if __name__ == "__main__":
    main()
