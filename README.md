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

## Still to do

- **`learn.html` and `tools.html`** are placeholders. The chrome, nav and axis
  animation all work; only `<main>` needs writing.
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
