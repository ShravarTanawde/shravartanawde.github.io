# quant-ph Radar: pipeline and data

This is the `radar-data` branch of the portfolio repository. It holds everything
behind the quant-ph Radar page (`tools/arxiv-radar/` on `main`): the Python
pipeline that harvests arXiv, the paper metadata, the topic model, and the weekly
shards. The page itself only ever sees the two summary files this pipeline
writes into the `main` checkout.

It is a separate orphan branch because `main` is the published site. GitHub
Pages serves `main` as-is, so anything committed there is reachable on the web.
This branch is public on GitHub as part of the repository, which is fine (arXiv
metadata is CC0), but it is never served as part of the site.

Paper metadata comes from arXiv.org through the arXiv API, under CC0. This
project is not affiliated with or endorsed by arXiv.

## What is here

```
pipeline/                  the Python package, run as python -m pipeline.<step>
  config.py                paths, the API address, rate limit, the contact lookup
  windows.py               calendar maths: Sundays, whole-week windows, months
  arxiv.py                 the API client (rate limit, retries) and Atom parsing
  harvest.py               month-by-month backfill, resumable from a cache
  listing.py               checks a harvested month against arXiv's listing page
  check.py                 integrity check over all shards
  store.py                 reading and writing paper shards (never overwrites)
  embed.py                 bge-small embeddings, cached by arXiv id, revision pinned
  compare.py               the blind bge-small vs SPECTER2 comparison (kept for record)
  terms.py                 the adjacency analyser and c-TF-IDF
  model.py                 THE ASSIGNMENT RULE, shared by the fit and the weekly job
  fit.py                   UMAP + HDBSCAN topics, stability across seeds, lineage
  lineage.py               continues / split / merged / new against the previous model
  label_prep.py            one review packet per broad topic, for naming
  labels.py                records labels (with checks) and writes REVIEW.md
  finalize.py              turns a reviewed fit into data/model/vN/ and the backfill
  stats.py                 z-test, the 5-year trend fit, term folding
  emerging.py              groups of unassigned papers ("Not yet a topic")
  summary.py               builds radar.json and details.json, and validates them
  weekly.py                the weekly update; the GitHub Action's entry point
  requirements.txt         laptop: everything, pinned
  requirements-weekly.txt  the Action: only what weekly.py needs
tests/                     no network, fixture-based; python -m pytest
labels/vN.json             topic names, descriptions and facets, written by hand
data/
  papers/YYYY/YYYY-MM.parquet        backfill, one file per month
  papers/weekly/YYYY-Www.parquet     papers each weekly run found that no shard had
  model/vN/                          one directory per topic-model version
    model.json                       embedding model, pinned revision, window, parameters
    centroids.npy                    one row per fine topic, in embedding space
    thresholds.json                  per-topic assignment thresholds
    topics.json                      facets, broad and fine topics with labels, lineage
    typical.json                     6 typical papers per fine topic
  assign/vN/backfill.parquet         id, topic, similarity for every backfill paper
  assign/vN/weekly/YYYY-Www.parquet  the same for each weekly run
  pool/YYYY-Www.npz                  embeddings of each run's unassigned papers
  emerging/state.json                the current emerging groups, and last week's
.local/                    NOT COMMITTED: venv, harvest cache, embeddings, fit artefacts
```

Assignment shards carry a `through` date in their Parquet metadata. The page's
windows end there, so a paper the model has not seen yet is never counted.

## Why binary data is append-only

Git keeps every version of every file, and Parquet and `.npz` are already
compressed, so git cannot shrink them further. A data file rewritten every week
would grow the repository by its full size every week. So **a committed binary
file is never rewritten**: `store.write_shard`, the pool writer and `finalize`
all refuse to overwrite. New data goes into new files, readers deduplicate by
arXiv id, and a later file wins. A second run in the same week that finds late
papers writes `YYYY-Www-2.parquet` rather than touching the first.

`data/emerging/state.json` is small text and is rewritten weekly; git
delta-compresses that well. The summary JSON on `main` is rewritten weekly for
the same reason.

## Setting up the laptop

Python 3.11. The environment lives inside `.local/` so nothing about it is
committed:

```
conda create -p .local/venv python=3.11
.local/venv/bin/pip install -r pipeline/requirements.txt
```

The embedder uses an NVIDIA GPU if one is present (fp32: on a GTX 1650, fp16 was
three times slower) and the CPU otherwise.

The harvester sends a User-Agent with a contact address, as arXiv asks of API
clients. The address is **never committed**: put it in `.local/contact` (one
line), or set `RADAR_CONTACT`. A test fails if any email address appears in a
file git would commit.

## Commands

All from this directory, with `.local/venv/bin/python -m`:

| step | what it does |
|---|---|
| `pipeline.harvest` | backfill every month from the start of the five-year window to now; re-running resumes |
| `pipeline.harvest --month 2026-09` | one month |
| `pipeline.check` | all months present, no duplicate ids, every paper in the right month |
| `pipeline.listing --reconcile 2026-09` | compares a month with arXiv's listing page, paper by paper |
| `pipeline.embed` | embeds every paper not cached yet |
| `pipeline.fit --version vN` | finds topics, checks stability and lineage; writes `.local/fit/vN/` |
| `pipeline.label_prep --version vN` | writes one review packet per broad topic to `.local/labels/vN/` |
| `pipeline.labels add --version vN < fragment.json` | records labels, refusing ones that break the rules |
| `pipeline.labels review --version vN` | writes `.local/labels/vN/REVIEW.md` |
| `pipeline.finalize --version vN` | writes `data/model/vN/`, the backfill assignments and the pool seed |
| `pipeline.emerging` | recomputes the emerging groups for the current week |
| `pipeline.summary --out ../portfolio/tools/arxiv-radar/data` | rebuilds the page's two data files |
| `pipeline.weekly --main ../portfolio` | the whole weekly update, as the Action runs it |
| `pytest` | the tests; no network |

`pipeline.weekly` takes `--end YYYY-MM-DD` (a Sunday) to run a specific week,
`--days-back` (default 90) and `--no-harvest`.

## How the numbers are made, in brief

- **Topics.** Each abstract is embedded with `BAAI/bge-small-en-v1.5` (the
  revision is pinned in `model.json`). UMAP reduces the vectors to 8 dimensions,
  HDBSCAN finds dense groups of at least 30 papers (the fine topics), and Ward
  linkage over their centres groups them into 60 broad topics.
- **Assignment** (`model.py`): a paper joins the fine topic whose centre it is
  closest to, if it is at least as close as that topic's own 5th-percentile
  member (never below 0.80 cosine). Otherwise it is unassigned. The weekly job
  uses the identical rule, so a paper lands in the same place whether it arrived
  in the backfill or last weekend.
- **Change** is a two-proportion z-test on each topic's share. The page marks
  growth or cooling only at |z| >= 2, and says "too few papers" below a minimum
  count.
- **The 5-year trend** fits all 20 quarters at once with a Poisson regression
  on the topic's count, using the quarter's total papers as exposure. It
  measures change in share, not in volume. Its range is a 95% interval widened
  by the overdispersion the data shows.
- **Emerging groups** are clusters of unassigned papers from the last 12 weeks
  that span 3 or more weeks, are not one author's series, are at least as tight
  as nine in ten topics, and share a phrase most of their papers use and the
  rest of the pool rarely does.

## The weekly job

`.github/workflows/radar-weekly.yml` on `main` runs every Sunday at 18:30 UTC
(midnight IST). It reports the newest week arXiv has fully announced, which on
a Sunday is the week that ended the Sunday before (`windows.last_announced_week_end`:
a week counts once it ended at least two days ago, because Friday-to-Sunday
submissions only appear with Monday's announcement). It checks this branch out into
`radar-data/`, runs `python -m pipeline.weekly --main ..`, and commits this
branch first, then `main`. Each run:

1. harvests the last 90 days (about 3% of papers wait two to eight weeks in
   arXiv's moderation queue, and a shorter look-back would never see them);
2. assigns every paper up to the week's end that the current model has not
   assigned yet;
3. adds that run's unassigned papers to the pool and recomputes emerging groups;
4. rebuilds the summary from all shards;
5. stops if any gate fails (a week under half the trailing 8-week median, an
   unresolved arXiv error, a summary that fails validation, a falling total),
   deleting what it wrote so nothing is committed;
6. writes the two data files into `main`, unless only the timestamp changed.

A run that fails after pushing this branch but before pushing `main` heals the
next week, because the summary is rebuilt from every shard.

## Quarterly refit runbook

Every three months or so, or when the job summary says a refit is due (model
older than 100 days, or more than 25% of papers unassigned four weeks running):

1. **Catch up.** Pull both branches. Run `pipeline.harvest` and `pipeline.embed`;
   only papers not seen before get embedded.
2. **Fit.** `pipeline.fit --version v{N+1}`. It uses the full five-year window
   up to the last complete week, minus the two most recent weeks, which are held
   out to test the weekly path. It reports topic counts, the unassigned share and
   stability, and computes lineage against vN: for each new topic, whether it
   continues an old one, split from one, merged from several, or is new.
3. **Packets.** `pipeline.label_prep --version v{N+1}`. Each packet shows a
   topic's size, share by year, terms, neighbours, 12 typical papers, 4 random
   and 4 boundary ones, and its lineage.
4. **Label.** Read the packets, titles and abstracts both. A topic that
   *continues* keeps its old name unless its content moved; split, merged and
   new topics get fresh names. Record them with `pipeline.labels add`, which
   refuses a name of the wrong length, a description that does not start
   "Papers that", an unknown facet or an em dash. Never name a topic from its
   terms alone.
5. **Review.** `pipeline.labels review --version v{N+1}`, and read `REVIEW.md`.
   It flags unstable, mixed and Miscellaneous topics, and everything that split,
   merged, is new or was renamed. A person checks it and edits `labels/v{N+1}.json`.
6. **Finalise.** `pipeline.finalize --version v{N+1}` writes `data/model/v{N+1}/`
   and re-assigns **all** papers under the new model into a new
   `data/assign/v{N+1}/backfill.parquet`. Old versions stay untouched.
7. **Check the weekly path** on the holdout: `pipeline.weekly --main ../portfolio
   --end <last Sunday>`. It should assign the held-out weeks, pass its gates,
   and add nothing on a second run.
8. **Publish.** Look at the page locally (`python -m http.server` from the
   `main` checkout), then commit both branches and push. The weekly job picks up
   the newest model version on its own.
