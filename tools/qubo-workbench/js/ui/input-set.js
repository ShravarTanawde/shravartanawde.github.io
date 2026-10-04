/* ============================================================================
   input-set.js: the two table widgets every input mode is built out of.

     createRowsTable()      a set of things, one per row, typed columns.
                            Knapsack's items and number partitioning's numbers
                            are the same widget with different columns.
     createAdjacencyGrid()  a square, symmetric 0/1 grid, the secondary way to
                            describe a graph, for when an edge list is harder to
                            read than a matrix.

   Both are dumb: they own their DOM and report changes, and know nothing about
   QUBOs, penalties or problems. Whatever wraps them decides what the rows mean.
   ============================================================================ */

import { el, clear } from './render.js?v=1';

/* ------------------------------------------------------------- rows table -- */

/**
 * @param {object} opts
 * @param {Array<{key,label,type,step?,min?,placeholder?,width?}>} opts.columns
 * @param {Array<object>} opts.rows          mutated in place; values are strings as typed
 * @param {string} opts.addLabel             text for the add button
 * @param {string} opts.rowNoun              "item" / "number", used in the aria labels
 * @param {() => void} opts.onChange
 * @returns {{node:HTMLElement, addRow:Function, render:Function}}
 */
export function createRowsTable(opts) {
  const { columns, rows, onChange } = opts;
  const rowNoun = opts.rowNoun || 'row';
  const tbody = el('tbody');

  function cellInput(row, col, index) {
    const input = el('input', {
      class: 'wb-input', type: col.type || 'text',
      step: col.step || null, min: col.min || null, placeholder: col.placeholder || null,
      value: row[col.key] === null || row[col.key] === undefined ? '' : String(row[col.key]),
      'data-row': String(index), 'data-key': col.key,
      'aria-label': col.label + ' of ' + rowNoun + ' ' + (index + 1)
    });
    input.addEventListener('input', () => { row[col.key] = input.value; onChange(); });
    return el('td', null, [input]);
  }

  function rowNode(row, index) {
    const remove = el('button', {
      class: 'wb-icon-btn', type: 'button', title: 'Remove this ' + rowNoun, text: '×',
      'aria-label': 'Remove ' + rowNoun + ' ' + (index + 1)
    });
    remove.addEventListener('click', () => {
      rows.splice(index, 1);
      /* Never leave the table with nothing in it; an empty table offers the
         user no way back in. */
      if (!rows.length) rows.push(blankRow(columns));
      render();
      onChange();
    });
    return el('tr', { 'data-row': String(index) }, [
      el('td', { class: 'num', text: String(index + 1) }),
      ...columns.map((c) => cellInput(row, c, index)),
      el('td', { class: 'act' }, [remove])
    ]);
  }

  function render() {
    clear(tbody);
    rows.forEach((r, i) => tbody.appendChild(rowNode(r, i)));
  }

  const table = el('table', { class: 'wb-table wb-form-table' }, [
    el('thead', null, [el('tr', null, [
      el('th', { scope: 'col', class: 'num', text: '#' }),
      ...columns.map((c) => el('th', { scope: 'col', text: c.label })),
      el('th', { scope: 'col', class: 'act' }, [el('span', { class: 'vh', text: 'remove' })])
    ])]),
    tbody
  ]);

  const add = el('button', { class: 'wb-btn', type: 'button', text: opts.addLabel || '+ row' });
  add.addEventListener('click', () => {
    rows.push(blankRow(columns));
    render();
    onChange();
    const last = tbody.querySelectorAll('tr:last-child input');
    if (last.length) last[0].focus();
  });

  const node = el('div', null, [
    el('div', { class: 'wb-scroll' }, [table]),
    el('div', { class: 'wb-actions', style: 'margin-top:12px' }, [add])
  ]);

  render();
  return { node, tbody, render, addRow: add };
}

function blankRow(columns) {
  const r = {};
  for (const c of columns) r[c.key] = '';
  return r;
}

/* -------------------------------------------------------- adjacency grid -- */

/**
 * A square symmetric grid of checkboxes over `graph.vertices`. Ticking (u,v)
 * ticks (v,u) too (an undirected edge is one fact, not two), and the diagonal
 * is disabled, because a self-loop means nothing to any template here.
 *
 * @param {object} opts
 * @param {{vertices:string[], edges:Array<[number,number]>}} opts.graph  read once
 * @param {(graph:{vertices:string[],edges:Array<[number,number]>}) => void} opts.onChange
 */
export function createAdjacencyGrid(opts) {
  const vertices = opts.graph.vertices.slice();
  /* the live truth while the grid is on screen */
  const adj = vertices.map(() => vertices.map(() => false));
  for (const [u, v] of opts.graph.edges) { adj[u][v] = true; adj[v][u] = true; }

  const host = el('div');

  function emit() {
    const edges = [];
    for (let u = 0; u < vertices.length; u++) {
      for (let v = u + 1; v < vertices.length; v++) if (adj[u][v]) edges.push([u, v]);
    }
    opts.onChange({ vertices: vertices.slice(), edges: edges, duplicates: 0, raw: '' });
  }

  function render() {
    clear(host);
    const head = el('tr', null, [el('th', { scope: 'col', class: 'corner' }, [el('span', { class: 'vh', text: 'vertex' })])]);
    for (const name of vertices) head.appendChild(el('th', { scope: 'col', text: name }));

    const body = el('tbody');
    vertices.forEach((name, u) => {
      const tr = el('tr', null, [el('th', { scope: 'row', text: name })]);
      vertices.forEach((other, v) => {
        if (u === v) {
          tr.appendChild(el('td', { class: 'diag', title: 'a vertex is never joined to itself', text: '–' }));
          return;
        }
        const box = el('input', {
          type: 'checkbox', class: 'wb-cellbox',
          'aria-label': 'edge between ' + name + ' and ' + other
        });
        if (adj[u][v]) box.setAttribute('checked', '');
        box.checked = adj[u][v];
        box.addEventListener('change', () => {
          const on = box.checked;
          adj[u][v] = on; adj[v][u] = on;
          render();          /* repaint so the mirrored cell agrees */
          emit();
        });
        tr.appendChild(el('td', null, [box]));
      });
      body.appendChild(tr);
    });

    const table = el('table', { class: 'wb-table wb-grid' }, [el('thead', null, [head]), body]);
    table.setAttribute('aria-label', 'Adjacency grid, ' + vertices.length + ' vertices');
    host.appendChild(el('div', { class: 'wb-scroll' }, [table]));

    const addV = el('button', { class: 'wb-btn', type: 'button', text: '+ vertex' });
    addV.addEventListener('click', () => {
      /* Name it after the next unused integer, so a grid built from scratch
         reads 0,1,2… like the edge-list examples. */
      let i = vertices.length;
      while (vertices.includes(String(i))) i++;
      vertices.push(String(i));
      adj.forEach((row) => row.push(false));
      adj.push(vertices.map(() => false));
      render();
      emit();
    });
    const dropV = el('button', { class: 'wb-btn', type: 'button', text: '− vertex' });
    dropV.disabled = vertices.length <= 1;
    dropV.addEventListener('click', () => {
      vertices.pop();
      adj.pop();
      adj.forEach((row) => row.pop());
      render();
      emit();
    });
    host.appendChild(el('div', { class: 'wb-actions', style: 'margin-top:12px' }, [addV, dropV]));
  }

  render();
  return { node: host, read: () => ({ vertices: vertices.slice(), adj }) };
}
