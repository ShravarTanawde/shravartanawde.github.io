"""
weekly.py: the weekly update, and the GitHub Action's entry point.

    python -m pipeline.weekly --main ../portfolio            (normal run)
    python -m pipeline.weekly --main .. --end 2026-09-27      (a specific week)

Steps, for the newest ISO week arXiv has fully announced (ending `end`, a
Sunday at least two days ago; see windows.last_announced_week_end):

  1. Harvest every paper submitted in the 90 days to `end` and keep the ones
     no shard has yet, in data/papers/weekly/YYYY-Www.parquet. Ninety days,
     not fourteen: about 3% of papers sit in arXiv's moderation queue for two to
     eight weeks, and a shorter look-back would never see them at all.
  2. Embed and assign every paper up to `end` that the current model has not
     assigned yet, with model.assign: new papers, late papers, and anything a
     failed week left behind. Write data/assign/vN/weekly/YYYY-Www.parquet,
     whose "through" metadata moves the page's window forward.
  3. Add that run's unassigned papers to data/pool/, and look for emerging
     groups (pipeline.emerging).
  4. Rebuild radar.json and details.json from every shard (pipeline.summary).
  5. Gates. If any fails, every file this run wrote is removed again, nothing
     reaches the main checkout, and the job summary says why:
       - this week has fewer than half the papers of the trailing 8-week median;
       - arXiv returned an error the client could not retry past;
       - the summary fails validation (schema, shares in [0, 1], shares
         summing to at most 1);
       - the total paper count fell against the published summary.
  6. Write the two data files into the main checkout, unless nothing but the
     timestamp changed: a second run in the same week adds no rows and leaves
     nothing to commit.

Nothing here writes prose. Emerging groups are named by their terms only.
"""

import argparse
import json
import os
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import config, emerging, store, summary
from .arxiv import ApiError, Client, TransientError, log
from .embed import DEFAULT_MODEL, embed_papers, pin_revision
from .finalize import ASSIGN_ROOT, MODEL_ROOT, write_assignments
from .harvest import harvest_window
from .model import UNASSIGNED, assign
from .windows import last_announced_week_end

LOOKBACK_DAYS = 90
MIN_WEEK_SHARE = 0.5
TRAILING_WEEKS = 8
REFIT_AFTER_DAYS = 100
UNASSIGNED_WARN = 0.25
UNASSIGNED_WEEKS = 4
DATA_OUT = Path("tools/arxiv-radar/data")


class Abort(Exception):
    pass


class Run:
    """What this run wrote, so a failed gate can take it all back."""

    def __init__(self):
        self.written = []
        self.restore = {}
        self.lines = []

    def wrote(self, path):
        self.written.append(Path(path))

    def keep_old(self, path):
        path = Path(path)
        if path not in self.restore:
            self.restore[path] = path.read_bytes() if path.exists() else None

    def roll_back(self):
        for p in self.written:
            p.unlink(missing_ok=True)
        for p, old in self.restore.items():
            if old is None:
                p.unlink(missing_ok=True)
            else:
                p.write_bytes(old)

    def say(self, line):
        self.lines.append(line)
        log(line)


def week_counts(papers, end: date, weeks: int):
    """Papers per week for the `weeks` weeks ending on `end`, oldest first."""
    counts = [0] * weeks
    start = end - timedelta(days=7 * weeks - 1)
    for p in papers:
        d = p["submitted"].date()
        if start <= d <= end:
            counts[(d - start).days // 7] += 1
    return counts


def harvest_new(run, client, end, days):
    first = end - timedelta(days=days - 1)
    try:
        total, recs = harvest_window(client, first, end)
    except (ApiError, TransientError) as e:
        raise Abort(f"arXiv error that retries could not get past: {e}") from e
    known = {p["id"] for p in store.read_papers(config.PAPERS)}
    new = [r for r in recs if r["id"] not in known]
    run.say(f"Harvested {len(recs)} papers submitted {first} to {end} ({client.requests} requests); {len(new)} new.")
    if new:
        path = emerging.free_path(config.PAPERS / "weekly", emerging.iso_week(end), ".parquet")
        store.write_shard(path, new)
        run.wrote(path)
    return len(new)


def assign_missing(run, version, end):
    mdir = MODEL_ROOT / version
    model = json.loads((mdir / "model.json").read_text())
    thr_by_id = json.loads((mdir / "thresholds.json").read_text())
    fid = list(thr_by_id)
    C = np.load(mdir / "centroids.npy").astype(np.float32)
    thr = np.array([thr_by_id[t] for t in fid], dtype=np.float32)
    assigned, through = summary.read_assignments(version)
    todo = sorted((p for p in store.read_papers(config.PAPERS)
                   if p["submitted"].date() <= end and p["id"] not in assigned), key=lambda p: p["id"])
    if not todo and through >= end:
        run.say(f"Every paper up to {end} is already assigned under {version}.")
        return [], []
    pin_revision(DEFAULT_MODEL, model["revision"])
    ids, X = embed_papers(todo, DEFAULT_MODEL) if todo else ([], np.zeros((0, C.shape[1]), np.float32))
    topic, sim = assign(X, C, thr) if todo else (np.array([], int), np.array([], np.float32))
    week = emerging.iso_week(end)
    path = emerging.free_path(ASSIGN_ROOT / version / "weekly", week, ".parquet")
    write_assignments(path, ids, topic, sim, fid, max(end, through))
    run.wrote(path)
    unassigned = [k for k, t in enumerate(topic) if t == UNASSIGNED]
    if unassigned:
        pool_path = emerging.free_path(emerging.POOL, week, ".npz")
        emerging.write_pool(week, [ids[k] for k in unassigned], X[unassigned], path=pool_path)
        run.wrote(pool_path)
    run.say(f"Assigned {len(ids)} papers under {version}; {len(unassigned)} unassigned "
            f"({100 * len(unassigned) / max(len(ids), 1):.1f}%).")
    return ids, topic


def gates(run, ctx, radar, details, published):
    try:
        summary.validate(radar, details)
    except summary.Invalid as e:
        raise Abort(f"the summary failed validation: {e}") from e
    counts = week_counts(ctx.papers.values(), ctx.data_through, TRAILING_WEEKS + 1)
    this, trailing = counts[-1], statistics.median(counts[:-1])
    if this < MIN_WEEK_SHARE * trailing:
        raise Abort(f"only {this} papers in the week to {ctx.data_through}, under half the "
                    f"trailing {TRAILING_WEEKS}-week median of {trailing:g}")
    if published and radar["meta"]["n_papers_total"] < published["meta"]["n_papers_total"]:
        raise Abort(f"total papers fell from {published['meta']['n_papers_total']} to "
                    f"{radar['meta']['n_papers_total']}")
    run.say(f"Gates passed: {this} papers this week against a trailing median of {trailing:g}; "
            f"{radar['meta']['n_papers_total']} papers in total.")


def refit_warnings(ctx, today):
    out = []
    age = (today - date.fromisoformat(ctx.model["fitted_on"])).days
    if age > REFIT_AFTER_DAYS:
        out.append(f"The topic model is {age} days old; a refit is due (runbook in the data-branch README).")
    end = ctx.data_through
    shares = []
    for k in range(UNASSIGNED_WEEKS):
        a, b = end - timedelta(days=7 * k + 6), end - timedelta(days=7 * k)
        week = [i for i, p in ctx.papers.items() if a <= p["submitted"].date() <= b]
        shares.append(sum(ctx.assigned[i] is None for i in week) / max(len(week), 1))
    if all(s > UNASSIGNED_WARN for s in shares):
        out.append(f"More than {UNASSIGNED_WARN:.0%} of papers have been unassigned for {UNASSIGNED_WEEKS} "
                   f"weeks running ({', '.join(f'{100 * s:.1f}%' for s in reversed(shares))}); a refit is due.")
    return out, shares[0]


def same_apart_from_timestamp(a, b):
    if a is None or b is None:
        return False
    strip = lambda d: {**d, "meta": {k: v for k, v in d["meta"].items() if k != "generated_at"}}
    return strip(a) == strip(b)


def run_week(end: date, main_dir: Path, days: int = LOOKBACK_DAYS, client=None, today=None, harvest=True):
    run = Run()
    out_dir = main_dir / DATA_OUT
    published = json.loads((out_dir / "radar.json").read_text()) if (out_dir / "radar.json").exists() else None
    published_details = json.loads((out_dir / "details.json").read_text()) if (out_dir / "details.json").exists() else None
    ok = True
    try:
        version = summary.latest_version()
        if harvest:
            harvest_new(run, client or Client(), end, days)
        assign_missing(run, version, end)
        ctx = summary.load_context()
        run.keep_old(emerging.STATE)
        state = emerging.find(ctx.data_through, ctx.papers, ctx.unassigned_ids, emerging.read_pool(),
                              emerging.load_state(), emerging.tightness_floor(*summary.read_similarity(version)))
        emerging.save_state(state)
        run.say(f"Emerging: {len(state['candidates'])} groups from a pool of {state['pool_size']} unassigned papers.")
        radar, details = summary.build(ctx)
        gates(run, ctx, radar, details, published)
        warnings, unassigned_now = refit_warnings(ctx, today or datetime.now(timezone.utc).date())
        run.say(f"Unassigned last week: {100 * unassigned_now:.1f}%.")
        for w in warnings:
            run.say("Warning: " + w)
        if same_apart_from_timestamp(radar, published) and details == published_details:
            run.say("The summary is unchanged apart from its timestamp; nothing to publish.")
        else:
            summary.write(out_dir, radar, details)
            run.say(f"Wrote radar.json and details.json through {ctx.data_through}.")
    except Abort as e:
        ok = False
        run.roll_back()
        run.say(f"Aborted, nothing published: {e}. The site keeps last week's data.")
    except Exception:
        run.roll_back()
        raise
    return ok, run


def job_summary(run, ok, end):
    text = f"## quant-ph Radar, week to {end}\n\n" + ("" if ok else "**Aborted.**\n\n") + \
        "\n".join(f"- {line}" for line in run.lines) + "\n"
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text)
    return text


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.weekly")
    ap.add_argument("--main", required=True, help="the main-branch checkout (the site)")
    ap.add_argument("--end", help="the week's Sunday, YYYY-MM-DD (default: the newest fully announced week)")
    ap.add_argument("--days-back", type=int, default=LOOKBACK_DAYS)
    ap.add_argument("--no-harvest", action="store_true", help="skip arXiv; assign and rebuild only")
    args = ap.parse_args(argv)
    end = date.fromisoformat(args.end) if args.end else last_announced_week_end(datetime.now(timezone.utc))
    if end.weekday() != 6:
        raise SystemExit(f"{end} is not a Sunday")
    ok, run = run_week(end, Path(args.main), args.days_back, harvest=not args.no_harvest)
    job_summary(run, ok, end)
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
