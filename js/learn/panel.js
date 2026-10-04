/* ============================================================
   panel.js — the node view.

   Opens over the graph as an in-page view, not a navigation: the SVG stays
   mounted underneath, so closing is instant and the map never has to be rebuilt.

   Content for a written node is a fragment in learn/nodes/<id>.html, fetched on
   first open and kept in memory after that. Nodes that are not written yet get
   the stub state, which is written once here and used by all 74 of them. That
   state is most of what a visitor will meet for a long while, so it is built
   with the same care as the real thing: it says what the topic is, says plainly
   that it is not written, and hands over the neighbouring topics.
   ============================================================ */

import { NODE_BY_ID, CLUSTER_BY_ID, NODES, TOOL_LINKS } from './graph-data.js?v=2';
import { isAuthored } from './content-manifest.js?v=2';
import { mountSim, unmountSim } from './sim-host.js?v=2';

const FRAGMENT_BASE = 'learn/nodes/';

/* id -> html string, or null if it could not be fetched. */
const cache = new Map();

export function initPanel(options) {
  const root = document.createElement('div');
  root.className = 'npanel';
  root.id = 'nodePanel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'npanel-title');
  root.hidden = true;

  const sheet = make('div', 'npanel-sheet');
  const btnClose = make('button', 'npanel-close');
  btnClose.type = 'button';
  btnClose.setAttribute('aria-label', 'Close topic');
  btnClose.textContent = 'Close';

  const elCluster = make('p', 'npanel-cluster');
  const elTitle = make('h2', 'npanel-title');
  elTitle.id = 'npanel-title';
  elTitle.setAttribute('tabindex', '-1');
  const elBody = make('div', 'npanel-body');
  const elSim = make('div', 'npanel-sim');
  elSim.hidden = true;
  const elLinks = make('nav', 'npanel-links');
  elLinks.setAttribute('aria-label', 'Neighbouring topics');
  elLinks.hidden = true;
  const elTool = make('div', 'npanel-tool');
  elTool.hidden = true;

  for (const part of [btnClose, elCluster, elTitle, elBody, elSim, elLinks, elTool]) sheet.appendChild(part);
  root.appendChild(sheet);

  options.mount.appendChild(root);

  let currentId = null;
  let returnFocus = null;
  let openToken = 0;      // guards against a slow fetch landing after a close

  btnClose.addEventListener('click', function () { options.onClose(); });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); options.onClose(); }
  });

  /* Everything a reader sees first — the title, the cluster, the neighbours,
     the panel itself — is done synchronously, before any await. Only the
     fragment is fetched, and only for a node that has one. Clicking through the
     map therefore swaps the panel in the same tick as the click, with no frame
     where the previous topic's title is still standing under the new one. */
  function open(id, focusReturnEl) {
    const node = NODE_BY_ID.get(id);
    returnFocus = focusReturnEl || returnFocus;
    const token = ++openToken;

    unmountSim();
    elSim.hidden = true;
    elSim.textContent = '';

    if (!node) {
      renderUnknown(id);
      show();
      return;
    }

    currentId = id;
    elCluster.textContent = (CLUSTER_BY_ID.get(node.cluster) || {}).label || '';
    elTitle.textContent = node.title;
    renderLinks(node);
    renderTool(node);
    show();

    if (!isAuthored(id)) {
      renderStub(node);
      return;
    }

    elBody.textContent = '';
    elBody.appendChild(placeholder('Loading…'));
    return loadInto(id, token, node);
  }

  async function loadInto(id, token, node) {
    const html = await fetchFragment(id);
    if (token !== openToken) return;             // a newer open won the race

    if (html === null) {
      renderStub(node, true);
      return;
    }

    let article;
    try {
      article = parseFragment(html);
    } catch (e) {
      /* A fragment that will not parse is the same kind of problem as one that
         will not download: say so, keep the topic, do not leave "Loading…" on
         the screen for ever. */
      console.warn('learn: could not parse ' + id, e);
      renderStub(node, true);
      return;
    }

    elBody.textContent = '';
    elBody.appendChild(article);
    announce(elBody);

    const simId = article.getAttribute('data-sim');
    if (simId) {
      elSim.hidden = false;
      mountSim(simId, elSim);
    }
  }

  function show() {
    root.hidden = false;
    sheet.scrollTop = 0;
    elTitle.focus({ preventScroll: true });
  }

  function close() {
    if (root.hidden) return;
    openToken++;
    unmountSim();
    root.hidden = true;
    currentId = null;
    if (returnFocus && document.contains(returnFocus)) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  /* ---------- the states ---------- */

  function renderStub(node, afterFailure) {
    elBody.textContent = '';

    const lead = document.createElement('p');
    lead.className = 'npanel-stub-lead';
    lead.textContent = afterFailure
      ? 'This topic is written, but its text could not be loaded just now.'
      : node.title + ' is on the map, but not written yet.';
    elBody.appendChild(lead);

    if (!afterFailure) {
      const p = document.createElement('p');
      p.className = 'npanel-stub-note';
      p.textContent = 'Topics are written one at a time. The links below go to its ' +
        'neighbours on the map, some of which may already be.';
      elBody.appendChild(p);
    }
    announce(elBody);
  }

  function renderUnknown(id) {
    currentId = null;
    elCluster.textContent = '';
    elTitle.textContent = 'No such topic';
    elLinks.hidden = true;
    elTool.hidden = true;
    elBody.textContent = '';

    const p = document.createElement('p');
    p.textContent = 'There is no topic called “' + id + '” on this map.';
    elBody.appendChild(p);

    const back = document.createElement('p');
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'npanel-back';
    a.textContent = 'Back to the map';
    a.addEventListener('click', function (e) { e.preventDefault(); options.onClose(); });
    back.appendChild(a);
    elBody.appendChild(back);
  }

  function renderLinks(node) {
    elLinks.textContent = '';
    const groups = [
      ['Builds on', node.prereq],
      ['Leads to', NODES.filter(function (m) { return m.prereq.indexOf(node.id) !== -1; }).map(function (m) { return m.id; })],
      ['Related', relatedOf(node.id)]
    ];

    let any = false;
    for (const [heading, ids] of groups) {
      if (!ids.length) continue;
      any = true;
      const h = document.createElement('h3');
      h.textContent = heading;
      elLinks.appendChild(h);

      const ul = document.createElement('ul');
      for (const id of ids) {
        const other = NODE_BY_ID.get(id);
        if (!other) continue;
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#/node/' + id;
        a.dataset.id = id;
        a.textContent = other.title;
        if (!isAuthored(id)) {
          a.classList.add('is-stub');
          const flag = document.createElement('span');
          flag.className = 'npanel-unwritten';
          flag.textContent = 'not written yet';
          li.appendChild(a);
          li.appendChild(flag);
        } else {
          li.appendChild(a);
        }
        ul.appendChild(li);
      }
      elLinks.appendChild(ul);
    }
    elLinks.hidden = !any;
  }

  function renderTool(node) {
    const link = TOOL_LINKS[node.id];
    elTool.textContent = '';
    if (!link) { elTool.hidden = true; return; }
    elTool.hidden = false;

    if (link.href) {
      const a = document.createElement('a');
      a.className = 'npanel-toollink';
      a.href = link.href;
      a.textContent = link.label;
      elTool.appendChild(a);
      const note = document.createElement('span');
      note.className = 'npanel-toolnote';
      note.textContent = 'leaves the map';
      elTool.appendChild(note);
    } else {
      const span = document.createElement('span');
      span.className = 'npanel-toolpending';
      span.textContent = link.label + ' — not built yet';
      elTool.appendChild(span);
    }
  }

  return {
    element: root,
    open: open,
    close: close,
    isOpen: function () { return !root.hidden; },
    current: function () { return currentId; }
  };
}

/* ---------- helpers ---------- */

function make(tag, cls) {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function relatedOf(id) {
  const out = [];
  const self = NODE_BY_ID.get(id);
  if (self) for (const r of self.related) out.push(r);
  for (const n of NODES) if (n.related.indexOf(id) !== -1) out.push(n.id);
  return out;
}

function placeholder(text) {
  const p = document.createElement('p');
  p.className = 'npanel-placeholder';
  p.textContent = text;
  return p;
}

async function fetchFragment(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const res = await fetch(FRAGMENT_BASE + id + '.html', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const html = await res.text();
    cache.set(id, html);
    return html;
  } catch (e) {
    console.warn('learn: could not load ' + id, e);
    cache.set(id, null);
    return null;
  }
}

/**
 * Fragments are authored relative to learn/nodes/, which is where they live and
 * where they make sense to read on their own. They are injected into learn.html
 * at the site root, so every relative src and href in them is resolved against
 * the folder they came from before the markup is attached. Without this, a
 * doodle written as "../../assets/..." would resolve two levels above the root.
 *
 * Note the depth: learn/nodes/ is two deep, so the site root is "../../", not
 * "../". A fragment written with one level would quietly point at learn/assets/.
 */
function parseFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = new URL(FRAGMENT_BASE, location.href);

  for (const node of doc.querySelectorAll('[src]')) {
    node.setAttribute('src', new URL(node.getAttribute('src'), base).href);
  }
  for (const node of doc.querySelectorAll('[href]')) {
    const raw = node.getAttribute('href');
    if (raw && raw[0] !== '#') node.setAttribute('href', new URL(raw, base).href);
  }

  const article = doc.querySelector('article.node-content') || doc.body.firstElementChild;
  if (!article) {
    const empty = document.createElement('article');
    empty.className = 'node-content';
    return empty;
  }
  return document.adoptNode(article);
}

/* Tell js/accessibility.js that there is new text on the page, so the reading
   panel's font, size, tracking and measure are applied to it too. */
function announce(el) {
  document.dispatchEvent(new CustomEvent('learn:content-rendered', { detail: { el: el } }));
}
