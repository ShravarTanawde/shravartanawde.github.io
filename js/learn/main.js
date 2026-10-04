/* ============================================================
   main.js — wiring and routing.

   Routes are hash-based so GitHub Pages needs no configuration and no 404
   rewrite rules:

       learn.html              the map
       learn.html#/node/<id>   the map, with that topic open

   A direct link renders the map and opens the panel in the same pass — there is
   no redirect and no flash of an empty page. Back closes, forward reopens, and
   neither ever scrolls the page, because the anchors are intercepted and the
   history entries are pushed by hand.
   ============================================================ */

import { NODE_BY_ID } from './graph-data.js?v=2';
import { renderGraph, renderList, renderClusterFilter, renderRelatedToggle } from './render.js?v=2';
import { initInteraction } from './interaction.js?v=2';
import { initPanel } from './panel.js?v=2';
import * as progress from './progress.js?v=2';

const ROUTE = /^#\/node\/([A-Za-z0-9-]+)$/;
const NARROW = '(max-width: 620px)';

const stage = document.getElementById('graphStage');
const filterMount = document.getElementById('graphFilter');
const toggleMount = document.getElementById('graphToggles');
const controls = document.getElementById('graphControls');
const resetWrap = document.getElementById('progressReset');

const RELATED_FLAG = 'showRelated';
if (stage) boot();

function boot() {
  const narrow = window.matchMedia(NARROW);

  let view = null;          // graph view, or null on narrow screens
  let interaction = null;

  /* View settings outlive a rebuild: crossing the breakpoint should not quietly
     turn the reader's filter or toggle off. */
  let cluster = null;
  let showRelated = progress.getFlag(RELATED_FLAG, false);

  const panel = initPanel({
    mount: document.body,
    onClose: closeNode
  });

  build();
  wireControls();
  wireReset();

  /* Rebuild when the viewport crosses the breakpoint. The SVG is destroyed, not
     hidden: on a phone it is not in the DOM at all. */
  narrow.addEventListener('change', function () {
    build();
    const id = routeId();
    if (id) interaction && interaction.setSelected(id);
  });

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

  /* Escape closes the panel wherever focus happens to be. The panel handles it
     too, for when focus is inside; this covers the rest of the page. */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.isOpen()) closeNode();
  });

  /* Every in-page topic link, wherever it lives: the list fallback, the panel's
     neighbour links, the stub state. One listener, one rule. */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a[href^="#/node/"]') : null;
    if (!a || a.classList.contains('gnode')) return;   // graph nodes are handled by interaction.js
    e.preventDefault();
    openNode(a.dataset.id || (a.getAttribute('href') || '').replace('#/node/', ''), null);
  });

  route();
  runDebugChecks();

  /* ---------- building ---------- */

  function build() {
    if (interaction) interaction.destroy();
    stage.textContent = '';
    view = null;
    interaction = null;

    if (narrow.matches) {
      renderList(stage, progress.visited());
      stage.dataset.mode = 'list';
      if (controls) controls.hidden = true;     // nothing to filter: there is no graph
      return;
    }
    view = renderGraph(stage, progress.visited());
    interaction = initInteraction(view, openNode);
    interaction.setRelatedVisible(showRelated);
    interaction.setClusterFilter(cluster);
    stage.dataset.mode = 'graph';
    if (controls) controls.hidden = false;
  }

  /* ---------- controls above the graph ---------- */

  function wireControls() {
    if (filterMount) {
      const chips = renderClusterFilter(filterMount);
      chips.addEventListener('click', function (e) {
        const btn = e.target.closest ? e.target.closest('.lchip') : null;
        if (!btn) return;
        /* One at a time, and clicking the live one clears it. Two filters at
           once would only ever mean "most of the map", which is no filter. */
        cluster = cluster === btn.dataset.cluster ? null : btn.dataset.cluster;
        chips.querySelectorAll('.lchip').forEach(function (c) {
          c.setAttribute('aria-pressed', c.dataset.cluster === cluster ? 'true' : 'false');
        });
        if (interaction) interaction.setClusterFilter(cluster);
      });
    }

    if (toggleMount) {
      const input = renderRelatedToggle(toggleMount, showRelated);
      input.addEventListener('change', function () {
        showRelated = input.checked;
        progress.setFlag(RELATED_FLAG, showRelated);
        if (interaction) interaction.setRelatedVisible(showRelated);
      });
    }
  }

  /* ---------- routing ---------- */

  function routeId() {
    const m = ROUTE.exec(location.hash);
    return m ? m[1] : null;
  }

  function openNode(id, fromEl) {
    if (!id) return;
    if (routeId() === id) { panel.open(id, fromEl); return; }
    history.pushState({ learn: id }, '', '#/node/' + id);
    route(null, fromEl);
  }

  function closeNode() {
    history.pushState({ learn: null }, '', location.pathname + location.search);
    route();
  }

  function route(_event, fromEl) {
    const id = routeId();

    if (!id) {
      panel.close();
      if (interaction) interaction.setSelected(null);
      return;
    }

    if (NODE_BY_ID.has(id)) {
      if (progress.markVisited(id) && interaction) interaction.markVisited(id);
      /* Selecting is enough: interaction.js lights the whole route up to
         level 0 from the selection. Calling highlight() here as well would
         fake a hover, and a hover deliberately outranks a selection — which
         would replace the route with the immediate neighbours. */
      if (interaction) interaction.setSelected(id);
      markListVisited(id);
    } else if (interaction) {
      interaction.setSelected(null);
    }

    panel.open(id, fromEl || (interaction ? interaction.nodeElement(id) : null));
  }

  function markListVisited(id) {
    if (stage.dataset.mode !== 'list') return;
    const link = stage.querySelector('a[href="#/node/' + id + '"]');
    if (link && link.parentElement) link.parentElement.classList.add('is-visited');
  }

  /* ---------- progress reset ---------- */

  function wireReset() {
    if (!resetWrap) return;
    if (!progress.available()) { resetWrap.hidden = true; return; }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lreset';
    btn.textContent = 'Reset visited topics';
    btn.addEventListener('click', function () {
      progress.reset();
      if (interaction) interaction.clearVisited();
      stage.querySelectorAll('.is-visited').forEach(function (el) { el.classList.remove('is-visited'); });
      btn.blur();
    });
    resetWrap.appendChild(btn);
  }

  /* ---------- ?debug=1 ---------- */

  function runDebugChecks() {
    if (!/[?&]debug=1\b/.test(location.search)) return;
    import('../../tools/validate-graph.mjs?v=2')
      .then(function (m) {
        const r = m.runChecks();
        for (const line of r.info) console.info('learn graph:', line);
        for (const w of r.warnings) console.warn('learn graph:', w);
        if (r.errors.length) {
          console.error('learn graph: ' + r.errors.length + ' problem(s)');
          for (const e of r.errors) console.error('  -', e);
        } else {
          console.info('learn graph: ok');
        }
      })
      .catch(function (e) { console.error('learn graph: could not run checks', e); });
  }
}
