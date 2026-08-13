# Quantum Portfolio — front page

A static, no-server portfolio. The front page is a Bloch sphere you navigate by
"measuring" a basis. Light mode is the clean/professional face; dark mode is the
quantum/show-off face. A reading-settings panel (font, size, spacing, width) and
theme choice persist on the visitor's device.

## Files

```
index.html            front page — identity cluster + interactive Bloch sphere navigator
projects.html         |Project⟩ / |Experience⟩     (blank, wired)
learn.html            |Simulations⟩ / |Learn⟩       (blank, wired)
tools.html            |Tools⟩ / |Software⟩          (blank, wired)
.nojekyll             stops GitHub Pages running Jekyll over the folder
css/global.css        design tokens + shared chrome (top bar, theme toggle, reading panel)
css/home.css          front page only — identity cluster, sphere, contact modal
css/page.css          inner pages only — nav row, content column
js/theme.js           polarization theme toggle          (all pages)
js/accessibility.js   reading-settings panel             (all pages)
js/axis.js            swings the topbar sphere's axis    (inner pages only)
js/navigation.js      contact modal                      (index only)
js/bloch.js           Three.js Bloch sphere navigator    (index only)
assets/docs/cv.pdf    placeholder — replace with your real CV
assets/images/        photo, diagrams, favicon
```

Each `js/` file no-ops if the elements it drives are absent, so loading one on a
page that lacks them is harmless. The small `<script>` in each `<head>` stays
inline on purpose: it applies the saved theme and reading settings before first
paint, which is what prevents a flash of the wrong theme.

The three axes map to three destinations (two poles → one page for now):

- **Z** · |Project⟩ / |Experience⟩ → `projects.html`
- **X** · |Simulations⟩ / |Learn⟩ → `learn.html`
- **Y** · |Tools⟩ / |Software⟩ → `tools.html`

## Fill these in (search the files for the placeholders)

1. **Your name** — replace `Your Name` in every file (top bar + heading).
2. **Photo** — in `index.html`, swap the `photo` box for `<img src="assets/images/photo.jpg" alt="Your Name">`.
3. **About blurb + role** — edit the two lines in the identity cluster.
4. **Social links** — set the `href="#"` on LinkedIn, GitHub, ORCiD. (Ko-fi can be added later as another `.socials a`.)
5. **CV** — replace `assets/docs/cv.pdf` with your own (keep the filename).
6. **Contact form (Web3Forms)** — see below.

## Contact form setup (Web3Forms)

1. Go to web3forms.com, enter your email, and copy the free **access key**.
2. In `index.html`, replace `YOUR_ACCESS_KEY_HERE` with it.

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
- **Per-page themes:** the sims/tools pages can take a more hand-drawn aesthetic
  later without touching the front page.
- **Three.js** is pinned to r128 (global build) for maximum reliability; you can
  bump it later if you want newer features.
