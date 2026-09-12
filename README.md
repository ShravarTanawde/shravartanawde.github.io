# Quantum Portfolio

A static, no-server portfolio for **Shravar G Tanawde**. The front page is a Bloch
sphere you navigate by "measuring" a basis. Light mode is the clean/professional
face; dark mode is the quantum/show-off face. A reading-settings panel (font,
size, spacing, width) and theme choice persist on the visitor's device.

Everything is hand-written HTML/CSS/JS — no build step, no bundler, no
dependencies to install. Three.js is the only third-party runtime code, loaded
from a CDN.

## Files

```
index.html            front page — identity cluster + interactive Bloch sphere navigator
projects.html         |Project⟩ / |Experience⟩      built out: circuit view + write-up stack
learn.html            |Simulations⟩ / |Learn⟩       placeholder, wired
tools.html            |Tools⟩ / |Software⟩          placeholder, wired
.nojekyll             stops GitHub Pages running Jekyll over the folder
css/global.css        design tokens + shared chrome (top bar, theme toggle, reading panel)
css/home.css          front page only — identity cluster, sphere, contact modal
css/page.css          inner pages only — nav row, content column
css/projects.css      projects page only — circuit diagram, gates, write-up stack
js/theme.js           polarization theme toggle          (all pages)
js/accessibility.js   reading-settings panel             (all pages)
js/axis.js            swings the topbar sphere's axis    (inner pages only)
js/navigation.js      contact modal                      (index only)
js/bloch.js           Three.js Bloch sphere navigator    (index only)
js/circuit.js         projects circuit diagram           (projects only)
assets/docs/cv.pdf    the CV linked from the front page
assets/images/        Profile.png, projects/, roles/
```

Each `js/` file no-ops if the elements it drives are absent, so loading one on a
page that lacks them is harmless. The small `<script>` in each `<head>` stays
inline on purpose: it applies the saved theme and reading settings before first
paint, which is what prevents a flash of the wrong theme.

CSS and JS are linked with `?v=N` cache-busting query strings. **Bump the number
when you change a file**, or returning visitors keep the stale copy. The version
lives in every page that links the file, so `css/global.css?v=5` has to be
bumped in all four pages at once.

The three axes map to three destinations (two poles → one page for now):

- **Z** · |Project⟩ / |Experience⟩ → `projects.html`
- **X** · |Simulations⟩ / |Learn⟩ → `learn.html`
- **Y** · |Tools⟩ / |Software⟩ → `tools.html`

## The projects page

Two views of the same work: a quantum circuit you can measure, and the stack of
write-ups underneath.

**The `<details>` stack is the single source of truth.** `js/circuit.js` reads
the `data-*` attributes off each `<details class="proj">` to draw the SVG and to
wire selection, so the two views cannot desync — and with JavaScript off, or if
the SVG fails to build, the circuit section simply stays `hidden` and the stack
carries the page on its own.

Selecting a gate *is* a measurement: the other gates dim, the other registers
fade, and the stack collapses to the one project. Clicking the same gate again,
Escape, the reset button, or a click on empty wire space returns it to
superposition.

### Adding a project

Add one `<li class="proj-item">` to whichever `.stack-group` it belongs to
(Projects / Role experience / Misc), copying the shape of an existing one.
Nothing else needs touching — the circuit picks it up. The attributes on the
`<details>`:

| attribute | what it does |
|---|---|
| `data-id` | unique slug, ties the gate to the write-up |
| `data-order` | integer, left-to-right position in the circuit |
| `data-short` | the gate's label in the diagram — keep it short |
| `data-year` | shown in the meta line; free text (`2025`, `2024–25`, `Ongoing`) |
| `data-wire` | which register it sits on: `q1`, `q2`, or `classical` |
| `data-control` | optional — draws a control dot on a second wire |
| `data-type` | `project` (outlined gate) or `role` (filled gate) |
| `data-pub` | bare attribute — adds the PUBLISHED tag |

`data-order` exists because the stack is grouped by kind, so DOM order is not
chronological, and because `data-year` holds things like `Ongoing` that no date
parser should be asked about. Also update the `.stack-count` in that group's
heading — it is written by hand.

### Adding or renaming a register

The hidden `<ul id="registers">` in `projects.html` is the only place the wires
are defined — how many there are, what order they run in, and what each is
called. Edit it there and the diagram follows. A new register id also needs a
colour rule in `css/projects.css` (`.proj-page [data-wire="…"]`).

## The QUBO / QAOA Workbench

`tools/qubo-workbench/` — a self-contained tool page: describe a combinatorial
problem, get a QUBO, check it, look at the QAOA landscape, and leave with
runnable PennyLane code. No server, no network calls at runtime.

```
tools/qubo-workbench/
  index.html          the tool page (same chrome as the other pages)
  css/workbench.css   tool-only styles, all colours from global.css tokens
  js/package.json     {"type":"module"} — only so Node can import these files
                      for validation/; the browser never reads it
  js/core/qubo.js     THE SHARED CORE: model, encoders, energy, Ising, cap rule
  js/core/problems.js the template registry — one entry per problem type
  js/core/verify.js   structural checks, the penalty bound, brute force
  js/core/analysis.js Step 3 — the QAOA simulator, the closed form, the optimizers
  js/core/codegen.js  Step 4 — QUBO -> a runnable PennyLane program
  js/core/save.js     save codes — JSON -> deflate -> base64url, and back
  js/core/tooltips.js the hover/focus definition map
  js/ui/render.js     every DOM write and every number format in the tool
  js/ui/input-form.js form mode (rows + fields) and the controls every mode shares
  js/ui/input-set.js  the rows-table and adjacency-grid widgets
  js/ui/input-graph.js graph input — edge list (primary) and grid (secondary)
  js/ui/charts.js     inline-SVG charts and the eight Step 3 views
  js/ui/pipeline.js   the four-step rail, and which steps the cap allows
```

Two things that live beside the tool are **deliberately not in this repository**
(see `.gitignore`): `CLAUDE.md`, the build constraints for whoever edits the tool
next, and `validation/`, the test harnesses. The repo root *is* the published
site — Pages serves these files as-is and `.nojekyll` filters nothing — so
anything committed here is reachable over the web whether or not a page links to
it. "Not shipped" is one of the tool's own constraints, and on a Pages repo the
only way to honour it is to not commit them. They are described below so the
tooling is documented even though the files are local; if you need them, ask
whoever set the site up, or re-create them from the descriptions.

Unlike the rest of the site, this tool's JS uses **ES modules**: too many
interdependent files for IIFE globals. Still no build step, but the page must be
*served* rather than opened over `file://`. Internal imports carry the same
`?v=N` as the entry point in `index.html` — **bump them all together**, or a
browser can mix a stale module with a fresh one. `validation/site_check.mjs`
fails if they drift apart.

Every step ends with a prev/next row, and every route into a step — the rail, that
row, or a loaded save code — goes through `goTo()`, which focuses the panel without
moving the page and then scrolls to its top deliberately. A floating control in the
corner appears once a step's heading scrolls away and returns you to the start of
*that step*, not the top of the document. Both honour `prefers-reduced-motion`.

`CLAUDE.md` (local only) holds the tool's non-negotiable constraints: the
20-qubit cap and what it does and does not switch off, the no-network rule, the
penalty bounds, the QUBO-is-primary convention, and the sign convention codegen
has to apply on the way out. Read it before changing anything here.

### Checks — local only

```
sh validation/run_all.sh         # everything — 271 checks
```

None of this is in the repository. It runs from a working copy that has
`validation/` in it.

| suite | what it covers |
|---|---|
| `core_check.mjs` | the model, encoders, the energy function, Ising, save codes |
| `site_check.mjs` | chrome copied byte-identically, links resolve, `?v=` in step, no network calls |
| `knapsack_check.mjs` | the knapsack build and its safe penalty, against independent DP |
| `graph_check.mjs` | the edge-list parser and the four graph/set templates, over random instances |
| `families_check.mjs` | indexed variable families, one-hot groups, colouring and clique |
| `ising_check.mjs` | Step 2 — the spin form reproduces the QUBO exactly, offset included |
| `analysis_check.mjs` | Step 3 — the simulator, the closed form, the landscape and the optimizers |
| `codegen_check.mjs` | Step 4's artifact, save codes as checkpoints, the definition map |
| `benchmark_check.mjs` | the tool against **theorems and published benchmark instances** (below) |
| `templates_check.py` | **executes** the generated programs against a real PennyLane (see below) |
| `ui_check.mjs` | the render and form modules, executed against `fake-dom.mjs` |

There is no browser in the build environment, so `fake-dom.mjs` is a small stand-in
that models structure, attributes, text and events — enough to run the UI code and
catch what `node --check` cannot see. It is not a browser: anything about layout,
style or painting still has to be looked at.

`site_check.mjs` is what enforces the "top bar and reading panel must stay
byte-identical" rule from the notes below — it diffs the workbench's copies
against `tools.html`.

Seven templates are live — knapsack, number partitioning, maximal independent set,
vertex cover, graph partitioning, graph colouring and max clique. Steps 2 (the Ising
form) and 3 (the landscape and optimizer analysis) are live. The PennyLane codegen
follows.

### External validation

Every other suite checks the tool against a reference written for this project.
`benchmark_check.mjs` checks it against results that were settled before it existed.

**Theorems.** `validation/benchmarks/families.mjs` builds graphs whose optimum is a
closed form — complete graphs, cycles, paths, complete bipartite graphs, the
Petersen graph, the Grötzsch graph, hypercubes, Turán graphs, wheels — and asserts
the brute-forced ground state of each QUBO equals it. Independence number, vertex
cover number, clique number, chromatic number and minimum bisection, fifteen
families. Gallai's identity `α + τ = |V|` is checked across all of them, and the
Grötzsch graph is checked for the property it exists to demonstrate: triangle-free
and still needing four colours.

**Published instances.** `validation/benchmarks/*.clq` are real graphs from the
Second DIMACS Implementation Challenge (Johnson & Trick, 1996) — 28 to 64 vertices,
so well above the in-browser cap. Their published clique numbers are *not* taken on
trust: `benchmarks/dimacs.mjs` recomputes each with an exact branch-and-bound that
shares no code with the tool, and the suite refuses to continue if the two disagree.
The assertion at this size is that a published optimal clique has energy exactly
zero in the generated QUBO, that breaking it costs exactly what the formulation
says, and that the safe bound is still applied where nothing can check the answer.

Two theorem-backed instances are also in `emit_fixtures.mjs`, so `templates_check.py`
executes generated PennyLane whose correct answer is a theorem: the Petersen graph's
independence number, and C5 needing three colours.

### The version guard

`validation/templates_check.py` is the one piece that needs Python and a network.
It builds a clean venv, emits a program for every template, **runs each one**, and
diffs the numbers against what the in-browser code produced for the same instance.

```
python3 validation/templates_check.py             # against the pinned version
python3 validation/templates_check.py --latest    # against the newest release
```

Running rather than reading is the point: a deprecation inside a *minor* release
does not change the version string, so checking `pennylane.__version__` would never
notice — but executing the code does, because the code stops working. When
`--latest` passes, re-pin `PENNYLANE_VERSION` in `codegen.js`; the footer on the
tool page reads that constant, so the site follows. Intended monthly or on demand.

The harness caught a real bug the first time it ran, and the way it caught it is
worth knowing. The workbench stores the Ising form with `x=1 ↔ s=+1`, but a
`PauliZ` measurement is `+1` on `|0⟩` — so the local fields have to be negated on
the way out. Get that wrong and **⟨C⟩ is still exactly right**: the two conventions
differ by an X on every qubit, which commutes with the mixer and fixes the `|+⟩`
start. Only the measured bitstrings come back complemented. So the emitted program
cross-checks a *probability* as well as an energy.

### Step 3's two speeds

Step 3 has two speeds. At **p = 1** the QAOA expectation has a closed form —
`analyticP1()` in `analysis.js` — which never touches the statevector, so the
landscape, the optimizers and the flatness map are all instant right up to the
20-qubit cap. A whole Step 3 pass at 20 qubits takes well under a second. At
**p > 1** there is no closed form and every evaluation is a full statevector pass,
so past `DEEP_P_LIMIT` qubits the deeper-p curve is offered on a button rather
than computed unasked.

The closed form is an optimisation, not a second opinion: `analysis_check.mjs`
pins it against the statevector simulator, which is itself pinned against
`qaoa_reference.mjs` — a deliberately slow, independently written QAOA that shares
no code with the tool. If the heatmap is ever wrong, one of those links fails.

Adding a template means one entry in `js/core/problems.js`: `build`, `bound`,
`decode`, `optimum` and an input schema. The picker, the ledger, the verdict panel
and the checks all pick it up on their own. **A template is not finished until its
safe-λ bound is implemented and a random sweep confirms the default λ recovers the
true optimum** — above the cap that bound is the only thing standing behind the
output.

Templates should also supply `referenceEnergy(model, bits)`: the Hamiltonian written
out longhand from the problem data, never touching `Q`. `verify.js` compares the two
on every assignment for small instances and on a deterministic sample for large ones,
which is what catches a mistake in expanding a square into linear and quadratic
terms — and it is the only real correctness check that still runs above the cap.

## Still to do

- **`learn.html` and `tools.html`** are placeholders. The chrome, nav and axis
  animation all work; only `<main>` needs writing. `tools.html` should end up
  linking to `tools/qubo-workbench/`.
- **`assets/docs/cv.pdf`** — keep the filename when you refresh it, so the link
  in `index.html` doesn't need touching.

## Contact form (Web3Forms)

Already configured — the access key is in the contact form in `index.html`. To
point it at a different inbox, get a new free key at web3forms.com and replace
the `access_key` value.

Your email address never appears in the page source — only the opaque key does,
so scrapers can't harvest it. A hidden honeypot field (`botcheck`) filters bots.

## Run locally

Because pages load fonts/Three.js over the network and navigate between files,
serve them rather than opening via `file://`:

```
cd this-folder
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages (free, no server)

1. Create a repo and push these files to the root.
2. Repo → **Settings → Pages** → Source: `main` branch, `/root`.
3. Your site goes live at `https://<username>.github.io/<repo>/`.

## The page transition

Leaving the front page, the big sphere zooms out into the top bar, where it
becomes the mini sphere that serves as the home link — and zooms back out when
you return. That is a **cross-document view transition**: `css/global.css` opts
in with `@view-transition { navigation: auto; }`, and the two elements share
`view-transition-name: bloch` (`.sphere-wrap` on the front page,
`.brand-sphere` in the bar). No JavaScript drives it.

It needs Chrome 126+ or Safari 18.2+. Firefox has not shipped cross-document
view transitions, so `js/bloch.js` flies the sphere up to the bar itself before
navigating (front page → section only; the reverse needs the incoming page's
layout to aim at). Everything degrades to a plain page load.

The mini sphere shows all three observables faintly with the current page's axis
highlighted — vertical for **Z**, and the two foreshortened isometric diagonals
for **X** and **Y**. Moving between sections swings that axis into its new
orientation: the pre-paint script seeds it with the previous page's angle from
`sessionStorage`, and `js/axis.js` transitions it to this page's.

Nothing breaks if 3D/JS is unavailable: the six ket labels are real links, so
navigation and keyboard/screen-reader use keep working.

## Notes for later

- **Shared chrome:** the top bar, theme toggle and reading panel live in
  `css/global.css` + `js/theme.js` + `js/accessibility.js`, so editing them in one
  place updates all four pages. The *markup* for the toggle and the top bar is
  still duplicated per page and must stay byte-identical. It is deliberately not
  injected by JavaScript: the bar holds the sphere the page transition morphs
  into, so it has to exist before first paint. If the duplication starts to hurt,
  add a small build step that generates the three inner pages from one template
  rather than moving the bar to runtime.
- **The axis table** (`{z, x, y}` angles and scales) appears twice: in the inline
  pre-paint script of each inner page, and in `js/axis.js`. They must stay in
  sync — the inline copy seeds the starting angle, `axis.js` animates to the end
  one.
- **Per-page themes:** the sims/tools pages can take a more hand-drawn aesthetic
  later without touching the front page.
- **Three.js** is pinned to r128 (global build) for maximum reliability; you can
  bump it later if you want newer features.
