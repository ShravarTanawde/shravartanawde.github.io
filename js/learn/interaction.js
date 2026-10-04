/* ============================================================
   interaction.js — hover, focus, selection, filtering.

   Two kinds of highlight, and the difference matters:

     hover        the node's immediate neighbours. Cheap, glanceable, and what
                  you want while sweeping a mouse across a level.
     focus or
     selection    the node's FULL ancestor set — every prerequisite, all the way
                  up to level 0 — with the connecting edges lit, including the
                  ones transitive reduction removed from the default drawing.
                  Select shors-algorithm and the route down from the top is the
                  only thing left bright. Its direct dependents are lit in a
                  second, quieter style, so you also see what it unlocks without
                  the rest of the page flooding.

   The cluster chips are the same machinery with a different starting set.

   All of it is class toggles. No geometry is recomputed, nothing is re-rendered,
   and every transition lives in css/learn.css where prefers-reduced-motion can
   turn it off.
   ============================================================ */

import { NODES, NODE_BY_ID, NEIGHBOURS } from './graph-data.js?v=2';

/* Worked out once, from the declared prerequisites — not from the reduced set
   that gets drawn. The route you are shown is the route the data claims. */
const ANCESTORS = (function () {
  const memo = new Map();
  function of(id) {
    if (memo.has(id)) return memo.get(id);
    const out = new Set();
    memo.set(id, out);
    const node = NODE_BY_ID.get(id);
    if (node) {
      for (const p of node.prereq) {
        if (!NODE_BY_ID.has(p)) continue;
        out.add(p);
        for (const a of of(p)) out.add(a);
      }
    }
    return out;
  }
  for (const n of NODES) of(n.id);
  return memo;
})();

const DEPENDENTS = (function () {
  const m = new Map(NODES.map(function (n) { return [n.id, []]; }));
  for (const n of NODES) for (const p of n.prereq) if (m.has(p)) m.get(p).push(n.id);
  return m;
})();

export function initInteraction(view, onOpen) {
  const svg = view.svg;
  const nodeEls = view.nodeEls;
  const labelEls = view.labelEls;
  const edgeEls = view.edgeEls;

  /* What the drawing is showing, in priority order. Hover beats focus, focus
     beats the open panel, the open panel beats the cluster filter — so moving
     the mouse always answers the question you just asked. */
  const state = { hover: null, focus: null, selected: null, cluster: null };

  let applied = '';       // signature of what is currently on the elements

  function setNode(id, cls) {
    const el = nodeEls.get(id);
    if (el) el.classList.add(cls);
    const label = labelEls.get(id);
    if (label) label.classList.add(cls);
  }

  function clearClasses() {
    for (const el of nodeEls.values()) el.classList.remove('is-near', 'is-next', 'is-far');
    for (const el of labelEls.values()) el.classList.remove('is-near', 'is-next', 'is-far');
    for (const el of edgeEls) el.classList.remove('is-near', 'is-next', 'is-far');
    svg.classList.remove('is-highlighting', 'is-pathing');
  }

  /** The set of nodes in front, and the set one step behind it. */
  function activeSets() {
    if (state.hover) {
      const near = new Set(NEIGHBOURS.get(state.hover) || []);
      near.add(state.hover);
      return { mode: 'neighbours', near: near, next: new Set(), roots: [state.hover] };
    }
    const focus = state.focus || state.selected;
    if (focus && NODE_BY_ID.has(focus)) {
      const near = new Set(ANCESTORS.get(focus) || []);
      near.add(focus);
      return { mode: 'path', near: near, next: new Set(DEPENDENTS.get(focus) || []), roots: [focus] };
    }
    if (state.cluster) {
      const near = new Set();
      const roots = [];
      for (const n of NODES) {
        if (n.cluster !== state.cluster) continue;
        roots.push(n.id);
        near.add(n.id);
        for (const a of ANCESTORS.get(n.id) || []) near.add(a);
      }
      return { mode: 'path', near: near, next: new Set(), roots: roots };
    }
    return null;
  }

  function apply() {
    const active = activeSets();
    const signature = active
      ? active.mode + '|' + Array.from(active.near).sort().join(',') + '|' +
        Array.from(active.next).sort().join(',')
      : '';
    if (signature === applied) return;
    applied = signature;

    clearClasses();
    if (!active) { offscreen.hide(); return; }

    svg.classList.add('is-highlighting');
    if (active.mode === 'path') svg.classList.add('is-pathing');

    for (const [id, el] of nodeEls) {
      if (active.near.has(id)) setNode(id, 'is-near');
      else if (active.next.has(id)) setNode(id, 'is-next');
      else { el.classList.add('is-far'); const l = labelEls.get(id); if (l) l.classList.add('is-far'); }
    }

    for (const edge of edgeEls) {
      const from = edge.dataset.from;
      const to = edge.dataset.to;
      const isRelated = edge.classList.contains('gedge-related');

      if (active.mode === 'neighbours') {
        const touches = active.near.has(from) && active.near.has(to);
        edge.classList.add(touches ? 'is-near' : 'is-far');
        continue;
      }
      /* On a path, a related edge is context, not part of the route. */
      if (isRelated) {
        edge.classList.add(active.near.has(from) || active.near.has(to) ? 'is-next' : 'is-far');
        continue;
      }
      if (active.near.has(from) && active.near.has(to)) edge.classList.add('is-near');
      else if (active.near.has(from) && active.next.has(to)) edge.classList.add('is-next');
      else edge.classList.add('is-far');
    }

    offscreen.update(active);
  }

  /* ---- public surface, unchanged where it was already used ---- */

  function highlight(id) { state.hover = id || null; apply(); }
  function clear() { state.hover = null; state.focus = null; apply(); }

  function setSelected(id) {
    for (const [nodeId, el] of nodeEls) el.classList.toggle('is-selected', nodeId === id);
    for (const [nodeId, el] of labelEls) el.classList.toggle('is-selected', nodeId === id);
    state.selected = id || null;
    apply();
  }

  function setClusterFilter(cluster) { state.cluster = cluster || null; apply(); }
  function clusterFilter() { return state.cluster; }

  function setRelatedVisible(on) { svg.classList.toggle('show-related', !!on); }

  function markVisited(id) {
    const el = nodeEls.get(id);
    if (el) el.classList.add('is-visited');
  }
  function clearVisited() {
    for (const el of nodeEls.values()) el.classList.remove('is-visited');
  }

  /* ---- wiring ---- */

  for (const [id, el] of nodeEls) {
    el.addEventListener('mouseenter', function () { highlight(id); });
    el.addEventListener('mouseleave', function () { state.hover = null; apply(); });
    el.addEventListener('focus', function () { state.focus = id; state.hover = null; apply(); });
    el.addEventListener('blur', function () { if (state.focus === id) state.focus = null; apply(); });
  }

  for (const [id, el] of labelEls) {
    el.addEventListener('mouseenter', function () { highlight(id); });
    el.addEventListener('mouseleave', function () { state.hover = null; apply(); });
    el.addEventListener('click', function () { onOpen(id, nodeEls.get(id) || null); });
  }

  /* One delegated click for the nodes. The anchors keep their href so that
     middle-click and "open in new tab" still work; a plain click is handled
     here instead, which is what keeps the page from scrolling. */
  svg.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a.gnode') : null;
    if (!a) return;
    e.preventDefault();
    onOpen(a.dataset.id, a);
  });

  /* ---- prerequisites that are above the fold ----
     The drawing is taller than the window now, so a lit ancestor can easily be
     off the top of the screen. Say how many, and go there when asked. */
  const offscreen = makeOffscreenHint(svg, nodeEls);

  return {
    highlight: highlight,
    clear: clear,
    setSelected: setSelected,
    setClusterFilter: setClusterFilter,
    clusterFilter: clusterFilter,
    setRelatedVisible: setRelatedVisible,
    markVisited: markVisited,
    clearVisited: clearVisited,
    nodeElement: function (id) { return nodeEls.get(id) || null; },
    destroy: function () { offscreen.destroy(); }
  };
}

function makeOffscreenHint(svg, nodeEls) {
  if (typeof document === 'undefined' || !document.createElement) {
    return { update: function () {}, hide: function () {}, destroy: function () {} };
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'labove';
  btn.hidden = true;
  let target = null;

  btn.addEventListener('click', function () {
    if (!target || !target.scrollIntoView) return;
    target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
  if (document.body) document.body.appendChild(btn);

  function update(active) {
    if (active.mode !== 'path' || typeof btn.getBoundingClientRect !== 'function') { hide(); return; }
    let count = 0;
    let highest = null;
    let highestTop = Infinity;

    for (const id of active.near) {
      const el = nodeEls.get(id);
      if (!el || typeof el.getBoundingClientRect !== 'function') continue;
      const box = el.getBoundingClientRect();
      if (box.bottom >= 0) continue;
      count++;
      if (box.top < highestTop) { highestTop = box.top; highest = el; }
    }

    if (!count) { hide(); return; }
    target = highest;
    btn.textContent = count + (count === 1 ? ' prerequisite' : ' prerequisites') + ' above';
    btn.hidden = false;
  }

  function hide() { btn.hidden = true; target = null; }
  function destroy() { if (btn.parentNode) btn.parentNode.removeChild(btn); }

  return { update: update, hide: hide, destroy: destroy };
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}
