/* ============================================================
   render.js — builds the SVG.

   One pass, no re-render afterwards. Everything that changes at runtime —
   theme, hover, visited, selection, the cluster filter, the related-edge
   toggle — is a CSS class, so the theme switch recolours the whole drawing
   without this file running again and without a flicker.

   There is not one colour literal in here. If you find yourself typing a hex
   value, it belongs in css/learn.css as a custom property instead.

   Layer order, back to front: level bands, related edges, redundant
   prerequisite edges, drawn prerequisite edges, nodes, labels. The two hidden
   layers are in the DOM from the start because path highlighting brings them
   back — building them at hover time would mean measuring geometry at hover
   time.
   ============================================================ */

import { CLUSTERS, NODES, NODE_BY_ID, labelOf } from './graph-data.js?v=2';
import {
  NODE_RADIUS, ROOT_RADIUS, GUTTER, LEVEL_GAP,
  computeLayout, edgeKey, labelBaseline, labelLines
} from './layout.js?v=2';
import { isAuthored } from './content-manifest.js?v=2';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Edges stop short of the circles so a line never runs out from under a node. */
const EDGE_TRIM = NODE_RADIUS + 4;

/* A finger is bigger than nine units. The hit target is invisible and generous. */
const HIT_RADIUS = 22;

/* How far a related edge between two topics on the SAME level bows out of the
   line, since it has no vertical distance to work with. */
const SIDEWAYS_BOW = 52;

function el(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * @param {Element} mount       container the SVG is appended to
 * @param {Set<string>} visited ids already opened
 * @returns {{svg, layout, nodeEls: Map, labelEls: Map, edgeEls: Array}}
 */
export function renderGraph(mount, visited) {
  const layout = computeLayout(NODES, CLUSTERS);
  const positions = layout.positions;
  const viewBox = layout.viewBox;
  const rows = layout.rows;
  const clusterLabel = new Map(CLUSTERS.map(function (c) { return [c.id, c.label]; }));

  const svg = el('svg', {
    class: 'lgraph',
    viewBox: '0 0 ' + viewBox.w + ' ' + viewBox.h,
    preserveAspectRatio: 'xMidYMin meet',
    role: 'group',
    'aria-label': 'Topic map. ' + NODES.length + ' topics on ' + rows.length +
      ' levels, easiest at the top; every topic sits below everything it needs first.'
  });

  const gBands = el('g', { class: 'gbands', 'aria-hidden': 'true' }, svg);
  const gRelated = el('g', { class: 'gedges gedges-related', 'aria-hidden': 'true' }, svg);
  const gHidden = el('g', { class: 'gedges gedges-redundant', 'aria-hidden': 'true' }, svg);
  const gPrereq = el('g', { class: 'gedges gedges-prereq', 'aria-hidden': 'true' }, svg);
  const gNodes = el('g', { class: 'gnodes' }, svg);
  const gLabels = el('g', { class: 'glabels', 'aria-hidden': 'true' }, svg);

  /* ---- level bands ----
     A line you can read straight across is the whole point of the change: a
     radius had to be judged by eye against sectors that were nowhere near it. */
  for (let l = 0; l < rows.length; l++) {
    const y = layout.levelY(l);
    const band = el('g', { class: 'gband' + (l % 2 ? ' is-alt' : '') }, gBands);
    band.dataset.level = l;

    if (l % 2) {
      el('rect', {
        class: 'gband-tint', x: 0, y: y - LEVEL_GAP / 2,
        width: viewBox.w, height: LEVEL_GAP
      }, band);
    }
    el('line', { class: 'gband-line', x1: GUTTER, y1: y, x2: viewBox.w - 16, y2: y }, band);

    const label = el('text', { class: 'gband-label', x: 18, y: y - 5 }, band);
    label.textContent = 'Level ' + l;
    if (l === 0) {
      const start = el('text', { class: 'gband-start', x: 18, y: y + 17 }, band);
      start.textContent = 'Start here';
    }
  }

  /* ---- edges ---- */
  const edgeEls = [];

  function addEdge(group, cls, from, to, d) {
    const path = el('path', { class: cls, d: d }, group);
    path.dataset.from = from;
    path.dataset.to = to;
    edgeEls.push(path);
    return path;
  }

  for (const n of NODES) {
    for (const p of n.prereq) {
      if (!positions.has(p)) continue;
      const key = edgeKey(p, n.id);
      if (layout.kept.has(key)) {
        addEdge(gPrereq, 'gedge gedge-prereq', p, n.id, chainPath(layout.routes.get(key)));
      } else {
        /* Implied by a longer route, so not drawn until a path is highlighted.
           Built now all the same: it has to be ready the moment one is. */
        addEdge(gHidden, 'gedge gedge-prereq is-redundant', p, n.id,
                chainPath([positions.get(p), positions.get(n.id)]));
      }
    }
    for (const r of n.related) {
      if (!positions.has(r)) continue;
      addEdge(gRelated, 'gedge gedge-related', n.id, r,
              relatedPath(positions.get(n.id), positions.get(r)));
    }
  }

  /* ---- nodes and labels ---- */
  const nodeEls = new Map();
  const labelEls = new Map();

  for (const n of NODES) {
    const p = positions.get(n.id);
    if (!p) continue;
    const stub = !isAuthored(n.id);
    const level = layout.levels.get(n.id);
    const root = level === 0;

    const a = el('a', {
      class: 'gnode' + (root ? ' is-root' : '') + (stub ? ' is-stub' : '') +
        (visited.has(n.id) ? ' is-visited' : ''),
      href: '#/node/' + n.id,
      'aria-label': n.title + '. ' + clusterLabel.get(n.cluster) +
        '. Level ' + level + (root ? ', a starting point' : '') +
        (stub ? '. Not written yet.' : '')
    }, gNodes);
    a.dataset.id = n.id;
    a.dataset.cluster = n.cluster;
    a.dataset.level = level;

    const r = root ? ROOT_RADIUS : NODE_RADIUS;
    el('circle', { class: 'gnode-hit', cx: p.x, cy: p.y, r: HIT_RADIUS }, a);
    el('circle', { class: 'gnode-ring', cx: p.x, cy: p.y, r: r + 5 }, a);
    el('circle', { class: 'gnode-dot', cx: p.x, cy: p.y, r: r }, a);
    nodeEls.set(n.id, a);

    const side = layout.labelSide.get(n.id);
    const lines = layout.labelLines.get(n.id) || labelLines(labelOf(n));
    const text = el('text', { class: 'glabel', 'text-anchor': 'middle' }, gLabels);
    text.dataset.id = n.id;
    text.dataset.side = side;
    if (stub) text.dataset.stub = '';
    lines.forEach(function (line, i) {
      const span = el('tspan', { x: p.x, y: round(labelBaseline(lines, p, side, i)) }, text);
      span.textContent = line;
    });
    labelEls.set(n.id, text);
  }

  mount.appendChild(svg);
  return { svg: svg, layout: layout, nodeEls: nodeEls, labelEls: labelEls, edgeEls: edgeEls };
}

/* ---------- path geometry ---------- */

/**
 * A chain of points, one per level, joined by cubics whose tangents are
 * vertical at both ends of every segment. Prerequisite edges all run downward
 * by construction, so the direction needs no arrowhead — and a curve that
 * leaves and arrives vertically reads as "descends from" rather than "cuts
 * across".
 */
function chainPath(points) {
  if (!points || points.length < 2) return '';
  const pts = trimEnds(points);
  let d = 'M' + round(pts[0].x) + ',' + round(pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const k = Math.max((b.y - a.y) * 0.5, 1);
    d += 'C' + round(a.x) + ',' + round(a.y + k) + ' ' +
         round(b.x) + ',' + round(b.y - k) + ' ' +
         round(b.x) + ',' + round(b.y);
  }
  return d;
}

/** Related edges have no direction, and may join two topics on one level. */
function relatedPath(a, b) {
  if (Math.abs(a.y - b.y) < 1) {
    const mx = (a.x + b.x) / 2;
    const my = a.y + SIDEWAYS_BOW;
    return 'M' + round(a.x) + ',' + round(a.y) +
           'Q' + round(mx) + ',' + round(my) + ' ' + round(b.x) + ',' + round(b.y);
  }
  return chainPath([a, b]);
}

/** Pull the two end points back to the edge of their node circles. */
function trimEnds(points) {
  const out = points.map(function (p) { return { x: p.x, y: p.y }; });
  shorten(out[0], out[1], EDGE_TRIM);
  shorten(out[out.length - 1], out[out.length - 2], EDGE_TRIM);
  return out;
}

function shorten(end, toward, by) {
  const dx = toward.x - end.x;
  const dy = toward.y - end.y;
  const len = Math.hypot(dx, dy);
  if (len < by * 2) return;
  end.x += (dx / len) * by;
  end.y += (dy / len) * by;
}

function round(v) { return Math.round(v * 10) / 10; }

/* ---------- the list that replaces the graph on a phone ---------- */

/**
 * Grouped by level, not by cluster. Read it top to bottom and the order is a
 * defensible order to learn the material in, which the cluster grouping never
 * was.
 */
export function renderList(mount, visited) {
  const layout = computeLayout(NODES, CLUSTERS);
  const clusterLabel = new Map(CLUSTERS.map(function (c) { return [c.id, c.label]; }));

  const root = document.createElement('div');
  root.className = 'llist';

  for (let l = 0; l < layout.rows.length; l++) {
    const section = document.createElement('section');
    section.className = 'llist-group';
    section.dataset.level = l;

    const h = document.createElement('h2');
    h.textContent = l === 0 ? 'Level 0 — Start here' : 'Level ' + l;
    section.appendChild(h);

    const ul = document.createElement('ul');
    for (const id of layout.rows[l]) {
      const n = NODE_BY_ID.get(id);
      const li = document.createElement('li');
      li.className = 'llist-item' +
        (isAuthored(id) ? '' : ' is-stub') +
        (visited.has(id) ? ' is-visited' : '');
      li.dataset.cluster = n.cluster;

      const a = document.createElement('a');
      a.className = 'llist-link';
      a.href = '#/node/' + id;
      a.textContent = n.title;
      a.dataset.id = id;
      li.appendChild(a);

      const tag = document.createElement('span');
      tag.className = 'llist-tag';
      tag.textContent = clusterLabel.get(n.cluster);
      li.appendChild(tag);

      if (n.prereq.length) {
        const need = document.createElement('p');
        need.className = 'llist-prereq';
        need.appendChild(document.createTextNode('after '));
        n.prereq.forEach(function (pid, i) {
          if (i) need.appendChild(document.createTextNode(', '));
          const link = document.createElement('a');
          link.href = '#/node/' + pid;
          link.textContent = (NODE_BY_ID.get(pid) || {}).title || pid;
          link.dataset.id = pid;
          need.appendChild(link);
        });
        li.appendChild(need);
      }
      ul.appendChild(li);
    }
    section.appendChild(ul);
    root.appendChild(section);
  }

  mount.appendChild(root);
  return root;
}

/* ---------- the controls above the graph ---------- */

/**
 * The cluster chips. They double as the colour key, so no cluster name is
 * typed anywhere but graph-data.js. Wiring is interaction.js's job.
 */
export function renderClusterFilter(mount) {
  const wrap = document.createElement('div');
  wrap.className = 'lfilter';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Filter the map by branch');

  for (const c of CLUSTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lchip';
    btn.dataset.cluster = c.id;
    btn.setAttribute('aria-pressed', 'false');

    const dot = document.createElement('span');
    dot.className = 'lchip-dot';
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(c.label));
    wrap.appendChild(btn);
  }

  mount.appendChild(wrap);
  return wrap;
}

/** The one toggle: related links, off by default. */
export function renderRelatedToggle(mount, initial) {
  const label = document.createElement('label');
  label.className = 'ltoggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!initial;
  label.appendChild(input);
  label.appendChild(document.createTextNode('Show related links'));

  mount.appendChild(label);
  return input;
}
