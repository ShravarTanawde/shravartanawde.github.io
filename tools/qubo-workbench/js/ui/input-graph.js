/* ============================================================================
   input-graph.js: describing a graph.

   The edge list is the PRIMARY input: it is the fastest thing to type, the
   easiest to paste from somewhere else, and it scales to graphs far larger than
   a grid could show. The adjacency grid is a secondary view of the same graph,
   for when a matrix is easier to read than a list.

   Both views edit ONE piece of state ({vertices, edges}), so they cannot
   disagree. Switching views rewrites the other view from that state; it never
   merges two half-edited versions.

   There is no image/photo/OCR input and there will not be one.
   ============================================================================ */

import { el, clear } from './render.js?v=1';
import { parseEdgeList } from '../core/problems.js?v=1';
import { createAdjacencyGrid } from './input-set.js?v=1';
import { createFooter, createFields, buildOnEnter } from './input-form.js?v=1';

/** {vertices, edges} -> the canonical text form. */
export function graphToText(graph) {
  const parts = graph.edges.map(([u, v]) => graph.vertices[u] + '-' + graph.vertices[v]);
  /* A vertex with no edges would vanish from a pure edge list, so it is written
     on its own, the same form the parser accepts. */
  const touched = new Set();
  for (const [u, v] of graph.edges) { touched.add(u); touched.add(v); }
  graph.vertices.forEach((name, i) => { if (!touched.has(i)) parts.push(name); });
  return parts.join(', ');
}

export function initGraph(host, problem, onBuild) {
  /* The single source of truth. Both views read and write this. */
  let graph = (() => {
    const d = problem.defaults();
    return { vertices: d.vertices || [], edges: d.edges || [] };
  })();
  let view = 'list';

  /* Some graph templates need a scalar as well as the graph: colouring needs a
     colour count, clique needs K. They are declared the same way form-mode
     fields are, and rendered by the same code. */
  const fieldValues = {};
  const defaults = problem.defaults();
  for (const f of ((problem.input && problem.input.fields) || [])) {
    fieldValues[f.key] = String(defaults[f.key] ?? '');
  }

  clear(host);

  const footer = createFooter(problem, () => Object.assign({
    vertices: graph.vertices,
    edges: graph.edges,
    raw: graphToText(graph)
  }, readFields()), onBuild);

  function readFields() {
    const out = {};
    for (const f of ((problem.input && problem.input.fields) || [])) {
      const raw = String(fieldValues[f.key] ?? '').trim();
      const n = raw === '' ? null : Number(raw);
      out[f.key] = f.type === 'text' ? raw : (Number.isFinite(n) ? n : null);
    }
    return out;
  }

  /* --- the edge list ---------------------------------------------------- */

  const textarea = el('textarea', {
    class: 'wb-input wb-textarea', id: 'wbEdges', rows: '4', spellcheck: 'false',
    'aria-describedby': 'wbEdgesHelp'
  });
  textarea.value = graphToText(graph);

  const help = el('p', { class: 'wb-field-note', id: 'wbEdgesHelp' }, [
    'One edge per entry, separated by commas or new lines. ',
    el('code', { class: 'wb-tok', text: '0-1' }), ' joins two vertices; ',
    el('code', { class: 'wb-tok', text: '0-1-2' }), ' is a chain; a name on its own, like ',
    el('code', { class: 'wb-tok', text: '7' }), ', adds a vertex with no edges. Labels can be words, ',
    'just not ones containing a dash or a colon.'
  ]);

  const summary = el('p', { class: 'wb-field-note wb-graph-summary' });

  textarea.addEventListener('input', () => {
    try {
      const parsed = parseEdgeList(textarea.value);
      graph = { vertices: parsed.vertices, edges: parsed.edges };
      setSummary(parsed.duplicates, null);
    } catch (err) {
      /* Keep the last good graph while the text is mid-edit, and say what is
         wrong without throwing the user's typing away. */
      setSummary(0, err.message);
    }
    footer.refresh();
  });

  function setSummary(duplicates, problemText) {
    clear(summary);
    summary.dataset.level = problemText ? 'warn' : 'ok';
    if (problemText) {
      summary.appendChild(el('b', { text: problemText }));
      return;
    }
    summary.appendChild(document.createTextNode(
      graph.vertices.length + ' vertex/vertices, ' + graph.edges.length + ' edge(s)' +
      (duplicates ? ', with ' + duplicates + ' repeated edge(s) folded together' : '') + '.'));
  }

  const listView = el('div', { class: 'wb-field wb-field-wide' }, [
    el('label', { for: 'wbEdges', text: 'edges' }),
    textarea,
    help,
    summary
  ]);

  /* --- the adjacency grid ------------------------------------------------ */

  const gridView = el('div', { hidden: true });

  function renderGrid() {
    clear(gridView);
    const grid = createAdjacencyGrid({
      graph: graph,
      onChange: (next) => {
        graph = { vertices: next.vertices, edges: next.edges };
        footer.refresh();
      }
    });
    gridView.appendChild(el('p', { class: 'wb-field-note', text:
      'Tick a cell to join two vertices. The grid is symmetric: an edge is one fact, ' +
      'so the mirrored cell follows on its own.' }));
    gridView.appendChild(grid.node);
  }

  /* --- the view switch --------------------------------------------------- */

  const tabList = el('button', { class: 'wb-tab', type: 'button', 'aria-pressed': 'true', text: 'edge list' });
  const tabGrid = el('button', { class: 'wb-tab', type: 'button', 'aria-pressed': 'false', text: 'adjacency grid' });

  function show(next) {
    view = next;
    tabList.setAttribute('aria-pressed', String(next === 'list'));
    tabGrid.setAttribute('aria-pressed', String(next === 'grid'));
    listView.hidden = next !== 'list';
    gridView.hidden = next !== 'grid';
    /* Rewrite the view being entered from the shared state, so the two can never
       drift apart. */
    if (next === 'list') { textarea.value = graphToText(graph); setSummary(0, null); }
    else renderGrid();
  }

  tabList.addEventListener('click', () => show('list'));
  tabGrid.addEventListener('click', () => show('grid'));

  const tabs = el('div', { class: 'wb-tabs', role: 'group', 'aria-label': 'How to describe the graph' }, [tabList, tabGrid]);

  const fields = createFields((problem.input && problem.input.fields) || [], fieldValues, () => footer.refresh());

  const body = el('div', null, [tabs, listView, gridView, fields.node]);
  const form = el('div', { class: 'wb-form' }, [body, footer.node]);
  footer.attach(body, fields.nodes);
  host.appendChild(form);

  buildOnEnter(form, footer.build);
  setSummary(0, null);
  footer.refresh();

  return { build: footer.build, readSpec: footer.readSpec, graph: () => graph };
}
