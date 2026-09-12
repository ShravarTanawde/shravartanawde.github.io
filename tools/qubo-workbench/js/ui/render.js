/* ============================================================================
   render.js — the tool's only DOM writers.

   Every module that puts numbers on screen comes through here, so formatting
   (how a coefficient is rounded, how a byte count is worded) is decided once.
   Nothing in here computes anything: it is handed a model and it draws.
   ============================================================================ */

import { capLevel, formatBytes, QUBIT_CAP, QUBIT_WARN } from '../core/qubo.js?v=1';
import { problemFor } from '../core/problems.js?v=1';
import { quboToIsing } from '../core/qubo.js?v=1';
import { isingCheck } from '../core/verify.js?v=1';

/* ------------------------------------------------------------- DOM helpers -- */

/**
 * el('div', {class:'x', text:'hi'}, [childNode, 'string'])
 * `text` sets textContent; every other key is set as an attribute. There is no
 * innerHTML path anywhere in this file — a problem name or an item label is
 * user input and is only ever written as text.
 */
export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** A bitstring for display, in qubo.js's ordering (variable 0 is the MSB). */
export function bitsToStringFor(z, n) {
  let out = '';
  for (let k = 0; k < n; k++) out += (z >>> (n - 1 - k)) & 1;
  return out;
}

/* ---------------------------------------------------------------- numbers -- */

/**
 * A coefficient as it should appear in a matrix cell or a formula.
 * Integers stay bare (they usually are — the encodings are integral), and
 * anything else is trimmed rather than padded, so a column of numbers reads as
 * numbers and not as a wall of zeroes.
 */
export function formatCoeff(x, maxDecimals = 4) {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x)) return String(x);
  const s = x.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '');
  /* a value that rounds away entirely is worth showing as such */
  return Number(s) === 0 && x !== 0 ? x.toExponential(1) : s;
}

/**
 * A term's sign and magnitude for an expression: "+\u20093", "\u2212\u20092.5".
 * U+2212 MINUS SIGN rather than a hyphen, and a U+2009 THIN SPACE between the
 * operator and the number, because these are set as mathematics and a hyphen
 * next to a digit reads as part of the number.
 */
export function signedCoeff(x, maxDecimals = 4) {
  const s = formatCoeff(Math.abs(x), maxDecimals);
  return (x < 0 ? '\u2212' : '+') + '\u2009' + s;
}

/* ------------------------------------------------------------ size readout --
   Constraint 4.5: qubit count, decision/ancilla split, statevector memory.
   Never a runtime estimate.                                                  */

export function renderSizeReadout(host, model) {
  const m = model.meta;
  const level = capLevel(m.qubitCount);
  clear(host);
  host.setAttribute('data-cap', level);

  const cell = (k, v, note) => el('div', { class: 'cell' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v' }, [String(v), note ? el('small', { text: ' ' + note }) : null])
  ]);

  host.appendChild(cell('Qubits', m.qubitCount,
    level === 'over' ? 'over the ' + QUBIT_CAP + ' cap'
      : level === 'warn' ? 'cap is ' + QUBIT_CAP
        : null));
  host.appendChild(cell('Decision', m.decisionCount));
  host.appendChild(cell('Ancilla', m.ancillaCount));
  host.appendChild(cell('Statevector', formatBytes(m.memoryBytes), '16 × 2^' + m.qubitCount));
  return host;
}

/* ------------------------------------------------------------- the callout --
   One banner, three states. The over-cap wording is fixed by CLAUDE.md and must
   keep its meaning: it has to name exactly what stops working.                */

export const BOUNDARY_COPY = {
  over: 'Above ~' + QUBIT_CAP + ' qubits, this tool generates code but can’t run, verify, ' +
        'or analyze the landscape in your browser. You’ll get the formulation and ' +
        'PennyLane code to run yourself.',
  warn: 'At ' + QUBIT_WARN + ' qubits you are close to the line. Above ~' + QUBIT_CAP +
        ' qubits the tool still builds the formulation and generates PennyLane code, but ' +
        'brute-force verification, the statevector simulation and the landscape analysis ' +
        'all switch off.'
};

/**
 * Writes the cap banner into `host` (a .wb-callout) and returns the level.
 * Hides itself when there is nothing to say.
 */
export function renderBoundaryNotice(host, qubitCount) {
  const level = capLevel(qubitCount);
  clear(host);
  if (level === 'ok') { host.hidden = true; host.removeAttribute('data-level'); return level; }

  host.hidden = false;
  host.setAttribute('data-level', level === 'over' ? 'stop' : 'warn');
  host.setAttribute('role', 'status');
  host.appendChild(el('span', { class: 'ico', 'aria-hidden': 'true', text: level === 'over' ? '!' : '~' }));
  host.appendChild(el('p', {
    class: 'title',
    text: level === 'over'
      ? qubitCount + ' qubits — code generation only'
      : qubitCount + ' qubits — approaching the limit'
  }));
  host.appendChild(el('p', { text: BOUNDARY_COPY[level] }));
  return level;
}

/* ============================================================================
   Step 1 views: the ledger, the matrix, the verdict.
   ============================================================================ */


/* ------------------------------------------------------------- the ledger --
   Which qubit is which. The decision/ancilla split is the thing people get
   wrong when reading a Q matrix, so it is a column, not a footnote.          */

export function renderLedger(host, model) {
  const problem = problemFor(model);
  clear(host);

  const head = el('tr', null, [
    el('th', { scope: 'col', class: 'num', text: '#' }),
    el('th', { scope: 'col', text: 'qubit' }),
    el('th', { scope: 'col', text: 'stands for' }),
    el('th', { scope: 'col', text: 'kind' }),
    el('th', { scope: 'col', text: 'detail' })
  ]);

  const body = el('tbody');
  model.variables.forEach((v, k) => {
    body.appendChild(el('tr', { 'data-kind': v.kind }, [
      el('td', { class: 'num', text: String(k) }),
      el('th', { scope: 'row', class: 'sym', text: v.sym }),
      el('td', { text: v.label }),
      el('td', null, [el('span', { class: 'wb-badge', 'data-kind': v.kind, text: v.kind })]),
      el('td', { class: 'wb-muted', text: problem.describeVar ? problem.describeVar(v) : '' })
    ]));
  });

  host.appendChild(el('table', { class: 'wb-table wb-ledger' }, [el('thead', null, [head]), body]));

  /* Templates with indexed families declare their one-hot groups. Showing them
     next to the ledger is what makes a wall of x[v,c] variables legible: the
     grouping IS the structure, and it is otherwise invisible in the matrix. */
  if (Array.isArray(model.groups) && model.groups.length) {
    const list = el('ul', { class: 'wb-groups' });
    for (const g of model.groups.slice(0, 12)) {
      list.appendChild(el('li', null, [
        el('b', { text: g.label }),
        el('span', { class: 'wb-mono wb-muted', text: ' — ' + g.members.map((k) => model.variables[k].sym).join(', ') })
      ]));
    }
    host.appendChild(el('div', { class: 'wb-groups-wrap' }, [
      el('p', { class: 'wb-groups-head', text:
        model.groups.length + ' "exactly one" constraint' + (model.groups.length === 1 ? '' : 's') +
        ', each over the variables below' }),
      list,
      model.groups.length > 12
        ? el('p', { class: 'wb-muted wb-bf-note', text: 'and ' + (model.groups.length - 12) + ' more.' })
        : null
    ]));
  }
  return host;
}

/* ------------------------------------------------------------- the matrix --
   Upper-triangular, so the lower half is left blank rather than mirrored — the
   blank IS the convention, and mirroring it would suggest the pair coefficient
   is counted twice.

   Colour encodes sign and magnitude: cool = pulls the energy down (a reward),
   warm = pushes it up (a penalty). The number is in every cell, so the tint is
   decoration and nothing is lost without it.                                 */

/* Past this many variables a grid stops being a picture and becomes a wall:
   33x33 is already over a thousand cells, and nobody reads a coefficient out of
   it. Above the line we describe the matrix instead of drawing it. The instance
   is still perfectly usable — codegen is never capped — so this is a display
   decision, not another limit. */
const MATRIX_DRAW_LIMIT = 32;

export function renderMatrix(host, model) {
  const n = model.meta.qubitCount;
  const Q = model.Q;
  clear(host);

  let peak = 0;
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) peak = Math.max(peak, Math.abs(Q[i][j]));

  if (n > MATRIX_DRAW_LIMIT) {
    let nonzero = 0, lowest = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        if (Q[i][j] === 0) continue;
        nonzero++;
        lowest = Math.min(lowest, Math.abs(Q[i][j]));
      }
    }
    const density = nonzero / (n * (n + 1) / 2);
    host.appendChild(el('div', { class: 'wb-callout', 'data-level': 'note' }, [
      el('span', { class: 'ico', 'aria-hidden': 'true', text: 'i' }),
      el('p', { class: 'title', text: n + '×' + n + ' — too large to draw usefully' }),
      el('p', { text:
        nonzero + ' non-zero coefficients of a possible ' + (n * (n + 1) / 2) +
        ' (' + Math.round(density * 100) + '% filled), ranging from ' + formatCoeff(lowest) +
        ' to ' + formatCoeff(peak) + ' in magnitude. The full matrix is written out in the ' +
        'generated code in Step 4, where it can actually be read by something.' })
    ]));
    host.appendChild(el('p', { class: 'wb-offset' }, [
      'constant offset ', el('b', { text: formatCoeff(model.offset) }),
      ' — added to every energy, and carried through to the Ising form and the generated code.'
    ]));
    return host;
  }

  const head = el('tr', null, [el('th', { scope: 'col', class: 'corner', text: '' })]);
  for (let j = 0; j < n; j++) head.appendChild(el('th', { scope: 'col', text: model.variables[j].sym }));

  const body = el('tbody');
  for (let i = 0; i < n; i++) {
    const row = el('tr', null, [el('th', { scope: 'row', text: model.variables[i].sym })]);
    for (let j = 0; j < n; j++) {
      if (j < i) { row.appendChild(el('td', { class: 'blank', 'aria-hidden': 'true' })); continue; }
      const q = Q[i][j];
      const cell = el('td', {
        class: 'q' + (i === j ? ' diag' : '') + (q === 0 ? ' zero' : ''),
        title: (i === j
          ? 'linear term on ' + model.variables[i].sym
          : 'pair term on ' + model.variables[i].sym + '·' + model.variables[j].sym) + ' = ' + q,
        text: q === 0 ? '·' : formatCoeff(q)
      });
      if (q !== 0 && peak > 0) {
        cell.style.setProperty('--tint', (Math.abs(q) / peak).toFixed(3));
        cell.dataset.sign = q < 0 ? 'neg' : 'pos';
      }
      row.appendChild(cell);
    }
    body.appendChild(row);
  }

  const table = el('table', { class: 'wb-table wb-matrix' }, [el('thead', null, [head]), body]);
  table.setAttribute('aria-label', 'The Q matrix, ' + n + ' by ' + n + ', upper triangular');
  host.appendChild(el('div', { class: 'wb-scroll' }, [table]));

  host.appendChild(el('p', { class: 'wb-legend' }, [
    el('span', { class: 'swatch', 'data-sign': 'neg', 'aria-hidden': 'true' }),
    'lowers the energy — a reward',
    el('span', { class: 'swatch', 'data-sign': 'pos', 'aria-hidden': 'true' }),
    'raises it — a penalty',
    el('span', { class: 'sep', text: '·' }),
    'blank cells are below the diagonal; every pair is counted once'
  ]));

  host.appendChild(el('p', { class: 'wb-offset' }, [
    'constant offset ',
    el('b', { text: formatCoeff(model.offset) }),
    ' — added to every energy, and carried through to the Ising form and the generated code.'
  ]));
  return host;
}

/* ------------------------------------------------------------ the verdict --
   Four outcomes, and the difference between them is the whole point:
     verified    brute force confirms it
     lucky       right here, but the penalty is below the bound, so not in general
     no_solution the instance has no answer — which IS the answer, not a failure
     unverified  too big to check; structure + the closed-form bound are the case
     broken      demonstrably wrong
     unsound     a structural failure, or a penalty with nothing behind it       */

const VERDICT_STYLE = {
  verified: { level: 'ok', ico: '✓' },
  lucky: { level: 'warn', ico: '~' },
  unverified: { level: 'note', ico: 'i' },
  no_solution: { level: 'note', ico: '∅' },
  broken: { level: 'stop', ico: '✕' },
  unsound: { level: 'stop', ico: '!' }
};

export function renderVerdict(host, result, model) {
  clear(host);
  const style = VERDICT_STYLE[result.verdict] || VERDICT_STYLE.unverified;

  host.appendChild(el('div', { class: 'wb-verdict-head', 'data-level': style.level }, [
    el('span', { class: 'ico', 'aria-hidden': 'true', text: style.ico }),
    el('div', null, [
      el('p', { class: 'title', text: result.headline }),
      el('p', { class: 'detail', text: result.detail })
    ])
  ]));

  /* --- the penalty, always, at any size --- */
  const p = result.penalty;
  host.appendChild(el('div', { class: 'wb-check', 'data-level': p.adequate ? 'ok' : 'error' }, [
    el('span', { class: 'mark', 'aria-hidden': 'true', text: p.adequate ? '✓' : '✕' }),
    el('div', null, [
      el('b', { text: 'Penalty λ = ' + formatCoeff(p.lambda) + (p.source === 'user_override' ? ' (set by hand)' : ' (from the bound)') }),
      el('span', { class: 'wb-muted', text: p.message })
    ])
  ]));

  /* --- the structural checks --- */
  const list = el('div', { class: 'wb-checks' });
  for (const c of result.structural) {
    list.appendChild(el('div', { class: 'wb-check', 'data-level': c.level }, [
      el('span', { class: 'mark', 'aria-hidden': 'true', text: c.level === 'ok' ? '✓' : c.level === 'warn' ? '~' : '✕' }),
      el('div', null, [el('b', { text: c.label }), el('span', { class: 'wb-muted', text: c.detail })])
    ]));
  }
  host.appendChild(list);

  /* --- what brute force found, when it was allowed to run --- */
  const bf = result.bruteForce;
  if (!bf) {
    host.appendChild(el('p', { class: 'wb-muted wb-bf-note', text:
      'No search was run: ' + result.qubitCount + ' qubits is above the in-browser limit. ' +
      'The checks above are the ones that hold at any size.' }));
    return host;
  }

  const grid = el('div', { class: 'wb-facts' });
  const fact = (k, v) => grid.appendChild(el('div', { class: 'fact' }, [
    el('span', { class: 'k', text: k }), el('span', { class: 'v', text: String(v) })
  ]));
  fact('Ground energy', formatCoeff(bf.groundEnergy));
  fact('True optimum', bf.truth.summary);
  fact('', bf.truth.detail);
  fact('Co-optimal states', bf.degeneracy + (bf.sampleCapped ? ' (showing ' + bf.states.length + ')' : ''));
  host.appendChild(grid);

  const states = el('table', { class: 'wb-table wb-states' }, [
    el('thead', null, [el('tr', null, [
      el('th', { scope: 'col', text: 'bitstring' }),
      el('th', { scope: 'col', text: 'reads as' }),
      el('th', { scope: 'col', text: 'feasible' })
    ])]),
    el('tbody', null, bf.states.slice(0, 8).map((s) => el('tr', null, [
      el('th', { scope: 'row', class: 'sym', text: s.bits }),
      el('td', { text: s.decoded.parts.map((q) => q.k + ' ' + q.v).join(' · ') }),
      el('td', null, [el('span', {
        class: 'wb-badge', 'data-kind': s.decoded.feasible ? 'ok' : 'bad',
        text: s.decoded.feasible ? 'yes' : 'no'
      })])
    ])))
  ]);
  host.appendChild(el('div', { class: 'wb-scroll' }, [states]));
  if (bf.states.length > 8) {
    host.appendChild(el('p', { class: 'wb-muted wb-bf-note', text:
      'Showing 8 of ' + bf.degeneracy + ' assignments at the same lowest energy.' }));
  }
  return host;
}


/* ============================================================================
   Step 2: the Ising form.

   A bridge, not a feature. It exists to show that the same energy, rewritten
   over spins, is the same energy — and to hand over the three numbers a
   simulator or a device actually takes: h, J, and the offset.

   The offset gets its own line rather than a footnote. It is the part everyone
   drops, and dropping it is exactly what makes an emitted program disagree with
   the browser by a constant.
   ============================================================================ */

/* Past this many terms the explicit expression stops helping and the tables do
   the work instead. */
const EXPRESSION_TERM_LIMIT = 24;

export function renderIsing(host, model) {
  const I = quboToIsing(model);
  const check = isingCheck(model, I);
  const n = I.n;
  clear(host);

  /* --- the substitution, stated once --- */
  host.appendChild(el('div', { class: 'wb-formula' },
    ['s_i = 2·y_i − 1          y_i ∈ {0,1}  ↦  s_i ∈ {−1, +1}\n' +
     'E(s) = Σ_i h_i·s_i  +  Σ_{i<j} J_ij·s_i·s_j  +  offset']));

  host.appendChild(el('p', { class: 'wb-muted', text:
    'No minus sign in front: these are the coefficients as PennyLane wants them, ' +
    'directly on Z_i and Z_i Z_j. Step 4 writes them out for you.' }));

  /* --- the size, locked in here --- */
  const m = model.meta;
  host.appendChild(el('div', { class: 'wb-facts wb-facts-boxed' }, [
    fact('Qubits', String(n)),
    fact('Fields h', String(I.h.filter((x) => x !== 0).length) + ' non-zero'),
    fact('Couplings J', String(I.J.filter((t) => t.value !== 0).length) + ' non-zero'),
    fact('Statevector', formatBytes(m.memoryBytes), '16 × 2^' + n)
  ]));

  /* --- the offset, on its own --- */
  host.appendChild(el('div', { class: 'wb-offset-box' }, [
    el('span', { class: 'k', text: 'constant offset' }),
    el('b', { text: formatCoeff(I.offset) }),
    el('span', { class: 'wb-muted', text:
      'Every energy above is shifted by this. A device never sees it — it does not ' +
      'change which state is lowest — but every number the tool or the generated code ' +
      'prints includes it.' })
  ]));

  /* --- h --- */
  host.appendChild(el('h4', { class: 'wb-h4', text: 'Local fields h' }));
  host.appendChild(el('div', { class: 'wb-scroll' }, [
    el('table', { class: 'wb-table wb-ising' }, [
      el('thead', null, [el('tr', null, [
        el('th', { scope: 'col', text: 'qubit' }),
        el('th', { scope: 'col', text: 'stands for' }),
        el('th', { scope: 'col', class: 'right', text: 'h' })
      ])]),
      el('tbody', null, I.h.map((v, i) => el('tr', null, [
        el('th', { scope: 'row', class: 'sym', text: model.variables[i].sym }),
        el('td', { class: 'wb-muted', text: model.variables[i].label }),
        el('td', { class: 'right' + (v === 0 ? ' zero' : ''), text: formatCoeff(v) })
      ])))
    ])
  ]));

  /* --- J --- */
  const live = I.J.filter((t) => t.value !== 0);
  host.appendChild(el('h4', { class: 'wb-h4', text: 'Couplings J' }));
  if (!live.length) {
    host.appendChild(el('p', { class: 'wb-muted', text:
      'None — this instance has no interacting pairs, so every qubit is independent.' }));
  } else {
    host.appendChild(el('div', { class: 'wb-scroll' }, [
      el('table', { class: 'wb-table wb-ising' }, [
        el('thead', null, [el('tr', null, [
          el('th', { scope: 'col', text: 'pair' }),
          el('th', { scope: 'col', class: 'right', text: 'J' })
        ])]),
        el('tbody', null, live.slice(0, 200).map((t) => el('tr', null, [
          el('th', { scope: 'row', class: 'sym', text: model.variables[t.i].sym + ' · ' + model.variables[t.j].sym }),
          el('td', { class: 'right', text: formatCoeff(t.value) })
        ])))
      ])
    ]));
    if (live.length > 200) {
      host.appendChild(el('p', { class: 'wb-muted wb-bf-note', text:
        'Showing 200 of ' + live.length + ' couplings. All of them are written out in Step 4.' }));
    }
  }

  /* --- the expression, when it is short enough to read --- */
  const terms = I.h.filter((x) => x !== 0).length + live.length;
  if (terms && terms <= EXPRESSION_TERM_LIMIT) {
    const parts = [];
    I.h.forEach((v, i) => { if (v !== 0) parts.push(signedCoeff(v) + ' ' + model.variables[i].sym.replace('x', 's')); });
    for (const t of live) {
      parts.push(signedCoeff(t.value) + ' ' +
        model.variables[t.i].sym.replace('x', 's') + '·' + model.variables[t.j].sym.replace('x', 's'));
    }
    if (I.offset !== 0) parts.push(signedCoeff(I.offset));
    host.appendChild(el('h4', { class: 'wb-h4', text: 'Written out' }));
    host.appendChild(el('div', { class: 'wb-formula', text: 'E(s) = ' + parts.join(' ').replace(/^\+ /, '') }));
  }

  /* --- the check --- */
  host.appendChild(el('div', { class: 'wb-check', 'data-level': check.level }, [
    el('span', { class: 'mark', 'aria-hidden': 'true', text: check.level === 'ok' ? '✓' : '✕' }),
    el('div', null, [el('b', { text: check.label }), el('span', { class: 'wb-muted', text: check.detail })])
  ]));

  return host;
}

function fact(k, v, note) {
  return el('div', { class: 'fact' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v' }, [v, note ? el('small', { text: ' ' + note }) : null])
  ]);
}

/* ============================================================================
   Step 4: the generated program.

   This is the artifact the visitor leaves with, and above the cap it is the only
   thing the tool produces — so the panel never hides anything behind a limit.
   The extras are off by default on purpose: the small default is the version
   that has actually been executed end to end against a real PennyLane release.
   ============================================================================ */

export function renderCodegen(host, result, opts) {
  const o = opts || {};
  clear(host);

  /* --- what this is --- */
  host.appendChild(el('div', { class: 'wb-facts wb-facts-boxed' }, [
    el('div', { class: 'fact' }, [el('span', { class: 'k', text: 'Framework' }), el('span', { class: 'v', text: 'PennyLane ' + result.version })]),
    el('div', { class: 'fact' }, [el('span', { class: 'k', text: 'Seed' }), el('span', { class: 'v', text: String(result.seed) })]),
    el('div', { class: 'fact' }, [el('span', { class: 'k', text: 'Lines' }), el('span', { class: 'v', text: String(result.code.split('\n').length) })]),
    el('div', { class: 'fact' }, [el('span', { class: 'k', text: 'Device' }), el('span', { class: 'v', text: result.overCap ? 'lightning.tensor (MPS)' : 'default.qubit' })])
  ]));

  if (result.overCap) {
    host.appendChild(el('div', { class: 'wb-callout', 'data-level': 'stop' }, [
      el('span', { class: 'ico', 'aria-hidden': 'true', text: '!' }),
      el('p', { class: 'title', text: 'Generated, but never executed here' }),
      el('p', { text:
        'Above ~' + QUBIT_CAP + ' qubits, this tool generates code but can’t run, verify, or ' +
        'analyze the landscape in your browser. You’ll get the formulation and PennyLane code to ' +
        'run yourself. The program says so at the top, and it asks for a tensor-network device ' +
        'rather than a dense statevector, which at this size would exhaust a free Colab instance.' })
    ]));
  } else {
    host.appendChild(el('div', { class: 'wb-check', 'data-level': 'ok' }, [
      el('span', { class: 'mark', 'aria-hidden': 'true', text: '✓' }),
      el('div', null, [
        el('b', { text: 'The program carries its own cross-check' }),
        el('span', { class: 'wb-muted', text:
          'It prints ⟨C⟩ at the parameters found here — ' + formatCoeff(o.expectation, 6) +
          ' — next to the value it computes itself. Those two agreeing is what makes this code ' +
          'trustworthy; the optimisation it then runs uses PennyLane’s own optimizer, so that ' +
          'number is its own.' })
      ])
    ]));
  }

  /* --- extras, off by default --- */
  const toggles = el('div', { class: 'wb-toggles', role: 'group', 'aria-label': 'Optional extras' }, [
    el('p', { class: 'wb-toggles-head', text: 'Add to the program (each one makes it longer and slower)' }),
    ...[
      ['lambdaSweep', 'penalty sweep', 'rebuild at several λ and show what each ground state becomes'],
      ['optimizerBakeOff', 'optimizer bake-off', 'gradient descent, Adam and SPSA from the same start'],
      ['initComparison', 'initialisation comparison', 'the same optimizer from four different starts']
    ].map(([key, label, note]) => {
      const id = 'wbExtra-' + key;
      const box = el('input', { type: 'checkbox', id: id, 'data-extra': key });
      box.checked = !!(o.extras && o.extras[key]);
      if (box.checked) box.setAttribute('checked', '');
      return el('div', { class: 'wb-toggle' }, [
        box,
        el('label', { for: id }, [el('b', { text: label }), el('span', { text: ' — ' + note })])
      ]);
    })
  ]);
  host.appendChild(toggles);

  /* --- the code --- */
  const pre = el('pre', { class: 'wb-code', id: 'wbCode', tabindex: '0' }, [el('code', { text: result.code })]);
  host.appendChild(el('div', { class: 'wb-actions wb-code-actions' }, [
    el('button', { class: 'wb-btn primary', type: 'button', id: 'wbCopy', text: 'Copy the whole program' }),
    el('a', {
      class: 'wb-btn', id: 'wbColab', href: result.colabUrl, target: '_blank', rel: 'noopener noreferrer'
    }, ['Open a blank Colab ↗']),
    el('span', { class: 'wb-copy-note', id: 'wbCopyNote', role: 'status', 'aria-live': 'polite' })
  ]));
  host.appendChild(pre);

  host.appendChild(el('p', { class: 'wb-muted wb-bf-note', text:
    'Paste it into a fresh notebook and run it — there is nothing to fill in. The pip line is ' +
    'included and the version is pinned, because a program that needs an edit before it runs is ' +
    'not really finished.' }));
  return host;
}
