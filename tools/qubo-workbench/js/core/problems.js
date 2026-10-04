/* ============================================================================
   problems.js: the template registry.

   One entry per problem type. Every entry implements the same four things, and
   verify.js / codegen.js / the UI only ever talk to that interface, so adding
   a problem never means touching them:

     build(spec)          structured input -> the canonical model (qubo.js)
     decode(model, bits)  a bitstring -> what it means in the problem's own terms
     optimum(model)       the true answer, by exhaustive search over the PROBLEM's
                          space (not the QUBO's), the reference verify.js checks against
     bound(spec)          the closed-form safe penalty, per Appendix B

   A template is not ready to ship until BOTH build() and bound() exist. A build
   with a guessed penalty is worse than no template: above the cap the bound is
   the only thing making the output trustworthy, because nothing can check it.
   ============================================================================ */

import {
  createModel, makeVariable, zeroMatrix, addLinear, addQuadratic, encodeRange,
  indexFamily, groupsAlong, addExactlyOne
} from './qubo.js?v=1';

/* A build that cannot proceed. The message is shown to the user verbatim, so it
   says what to change, not what went wrong internally. */
export class BuildError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'BuildError';
    this.field = field || null;    // which input to highlight, when there is one
  }
}

/* ---------------------------------------------------------------- helpers -- */

/* A number as typed in a form. '' and nonsense both become null so the template
   says what is wrong, rather than Number('') quietly becoming 0. */
function toNum(s) {
  const v = String(s == null ? '' : s).trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireWholeNumber(x, label, field) {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new BuildError(label + ' needs to be a number.', field);
  }
  if (!Number.isInteger(x)) {
    throw new BuildError(
      label + ' has to be a whole number; the slack encoding counts in integers. ' +
      'If your figures have decimals, scale every weight and the capacity by the same ' +
      'power of ten.', field);
  }
}

/**
 * The penalty the tool will actually use, and where it came from.
 * `requested` is null for "auto". An override is honoured (the user may want to
 * see what a too-small penalty does), but it is recorded as an override so the
 * verdict panel can say so.
 */
function resolvePenalty(bound, requested) {
  /* A small margin above the bound: most of these bounds are strict
     inequalities, so landing exactly on one is not safe. */
  const auto = Math.ceil(bound) + 1;
  if (requested === null || requested === undefined || requested === '') {
    return { lambda: auto, source: 'lucas_bound', bound: bound };
  }
  const lambda = Number(requested);
  if (!Number.isFinite(lambda) || lambda <= 0) {
    throw new BuildError('The penalty λ has to be a positive number.', 'lambda');
  }
  return { lambda: lambda, source: 'user_override', bound: bound };
}

/* ---------------------------------------------------------------- graphs -- */

/*
   Every graph template takes the same shape from the input layer:

       { vertices: ['a','b','c'], edges: [[0,1],[1,2]], ... }

   Edges are index pairs into `vertices`, each unordered pair appearing once,
   never a self-loop. input-graph.js guarantees that; this checks it anyway,
   because a template that trusts its input is a template that builds a wrong Q
   in silence.
*/
function requireGraph(spec) {
  const vertices = spec.vertices || [];
  const edges = spec.edges || [];
  if (!vertices.length) throw new BuildError('Describe a graph first: at least one vertex.', 'graph');

  const seen = new Set();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) throw new BuildError('An edge must be a pair of vertices.', 'graph');
    const [u, v] = e;
    if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= vertices.length || v >= vertices.length) {
      throw new BuildError('An edge names a vertex that is not in the graph.', 'graph');
    }
    if (u === v) throw new BuildError('Self-loops are not allowed: ' + vertices[u] + ' cannot join itself.', 'graph');
    const key = Math.min(u, v) + ':' + Math.max(u, v);
    if (seen.has(key)) throw new BuildError('The edge ' + vertices[u] + '–' + vertices[v] + ' is listed twice.', 'graph');
    seen.add(key);
  }
  return { vertices, edges };
}

/**
 * Free text -> a graph. This is the primary way a graph gets into the tool, so
 * it forgives as much as it can and explains whatever it cannot.
 *
 * Entries are separated by commas, semicolons or new lines. Inside an entry the
 * endpoints may be joined by -, --, ->, <->, :, an en/em dash, or just a space:
 *
 *     0-1, 1-2, 2-0          three edges, three vertices
 *     A -- B, B -- C         labels can be words
 *     0-1-2-3                a chain: three edges, written once
 *     7                      a vertex on its own, with no edges
 *
 * Labels therefore cannot contain a dash or a colon; that is the price of not
 * making people type JSON. Vertices are numbered in the order they first appear.
 *
 * @returns {{vertices:string[], edges:Array<[number,number]>, duplicates:number, raw:string}}
 */
export function parseEdgeList(text) {
  const raw = String(text == null ? '' : text);
  const vertices = [];
  const index = new Map();
  const edges = [];
  const pairSeen = new Set();
  let duplicates = 0;

  const idOf = (label) => {
    if (!index.has(label)) { index.set(label, vertices.length); vertices.push(label); }
    return index.get(label);
  };

  for (const entryRaw of raw.split(/[,;\n]/)) {
    const entry = entryRaw.trim();
    if (!entry) continue;

    const parts = entry.split(/\s*(?:<->|->|--|[-\u2013\u2014:])\s*|\s+/).filter((x) => x !== '');
    if (!parts.length) continue;

    if (parts.length === 1) { idOf(parts[0]); continue; }     // an isolated vertex

    /* A chain "0-1-2" is three vertices and two edges. */
    for (let i = 0; i + 1 < parts.length; i++) {
      const u = idOf(parts[i]), v = idOf(parts[i + 1]);
      if (u === v) {
        throw new BuildError(
          '"' + entry + '" joins ' + parts[i] + ' to itself. A self-loop has no meaning here; ' +
          'remove it, or write the vertex on its own to keep it in the graph.', 'graph');
      }
      const key = Math.min(u, v) + ':' + Math.max(u, v);
      if (pairSeen.has(key)) { duplicates++; continue; }
      pairSeen.add(key);
      edges.push([u, v]);
    }
  }
  return { vertices, edges, duplicates, raw };
}

/** Degree of every vertex, and the largest of them. */
function degrees(vertices, edges) {
  const deg = new Array(vertices.length).fill(0);
  for (const [u, v] of edges) { deg[u]++; deg[v]++; }
  return { deg, max: deg.length ? Math.max(...deg) : 0 };
}

/** Adjacency as bitmasks: what the exhaustive reference searches run on. */
function adjacencyMasks(vertices, edges) {
  const adj = new Array(vertices.length).fill(0);
  for (const [u, v] of edges) { adj[u] |= (1 << v); adj[v] |= (1 << u); }
  return adj;
}

/** Vertex variables, in input order, carrying their degree for the ledger. */
function vertexVariables(vertices, deg) {
  return vertices.map((name, i) => makeVariable(
    'x·' + name, 'x' + i, 'decision', { role: 'vertex', vertexIndex: i, name: name, degree: deg[i] }
  ));
}

/** Which vertices a bitstring selects. */
function selectedVertices(model, bits) {
  const names = [], idx = [];
  model.variables.forEach((v, k) => {
    if (bits[k] && v.meta.role === 'vertex') { names.push(v.meta.name); idx.push(v.meta.vertexIndex); }
  });
  return { names, idx };
}

/** Edges with both ends inside the selection. */
function internalEdges(edges, chosen) {
  const inSet = new Set(chosen);
  return edges.filter(([u, v]) => inSet.has(u) && inSet.has(v));
}

/** Edges with exactly one end inside the selection: the cut. */
function cutEdges(edges, chosen) {
  const inSet = new Set(chosen);
  return edges.filter(([u, v]) => inSet.has(u) !== inSet.has(v));
}

/** popcount for the 32-bit masks used by the reference searches. */
function popcount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/* ========================================================================== */
/* B.1  KNAPSACK                                                              */
/* ========================================================================== */

/*
   Maximise the value carried without exceeding the capacity W.

   Exact-slack formulation. The inequality  sum_i w_i x_i <= W  becomes the
   equality  sum_i w_i x_i + sum_j c_j s_j = W,  where the slack bits s_j carry
   the coefficients from encodeRange(W) and so can represent every integer in
   [0, W]. The whole Hamiltonian is then

       E(y) = -sum_i v_i x_i  +  lambda * ( sum_k a_k y_k - W )^2

   with a_k the weight coefficient of variable k (w_i for an item, c_j for a
   slack bit). Expanding the square, using y^2 = y for bits:

       Q[k][k] = obj_k + lambda*(a_k^2 - 2*W*a_k)
       Q[k][l] = 2*lambda*a_k*a_l                    (k < l)
       offset  = lambda*W^2

   Safe penalty: lambda > max(v_i). Sketch: an assignment that overshoots by e
   pays lambda*e^2. Shedding that excess costs at most e items (every weight is
   at least 1), so at most e*max(v_i) of value. lambda*e^2 > e*max(v_i) holds for
   every e >= 1 exactly when lambda > max(v_i).

   Qubits: N + 1 + floor(log2 W).
*/

function knapsackSlack(capacity) {
  return encodeRange(capacity);
}

function knapsackBuild(spec) {
  const items = spec.items || [];
  if (!items.length) throw new BuildError('Add at least one item.', 'items');

  requireWholeNumber(spec.capacity, 'The capacity', 'capacity');
  if (spec.capacity <= 0) throw new BuildError('The capacity has to be at least 1.', 'capacity');

  items.forEach((it, i) => {
    const where = 'Item ' + (i + 1) + (it.name ? ' (' + it.name + ')' : '');
    if (typeof it.value !== 'number' || !Number.isFinite(it.value)) {
      throw new BuildError(where + ' needs a value.', 'value:' + i);
    }
    if (it.value <= 0) {
      throw new BuildError(where + ' has a value of ' + it.value +
        '. An item worth nothing is never taken. Remove it instead.', 'value:' + i);
    }
    requireWholeNumber(it.weight, where + "'s weight", 'weight:' + i);
    if (it.weight <= 0) throw new BuildError(where + ' needs a weight of at least 1.', 'weight:' + i);
  });

  const W = spec.capacity;
  const coeffs = knapsackSlack(W);
  const penalty = resolvePenalty(knapsackBound(spec), spec.lambda);
  const lambda = penalty.lambda;

  /* variables: every item first, then the slack bits. Item i is variable i, which
     keeps the ledger readable and the decode trivial. */
  const variables = [];
  const a = [];             // weight coefficient per variable
  const obj = [];           // objective coefficient per variable

  items.forEach((it, i) => {
    variables.push(makeVariable(
      'x·' + (it.name || ('item ' + (i + 1))), 'x' + i, 'decision',
      { role: 'item', itemIndex: i, name: it.name || ('item ' + (i + 1)), value: it.value, weight: it.weight }
    ));
    a.push(it.weight);
    obj.push(-it.value);    // minimising -value is maximising value
  });

  coeffs.forEach((c, j) => {
    variables.push(makeVariable(
      's' + j + '·(' + c + ')', 's' + j, 'ancilla',
      { role: 'slack', slackIndex: j, coeff: c }
    ));
    a.push(c);
    obj.push(0);
  });

  const n = variables.length;
  const Q = zeroMatrix(n);
  for (let k = 0; k < n; k++) {
    addLinear(Q, k, obj[k] + lambda * (a[k] * a[k] - 2 * W * a[k]));
    for (let l = k + 1; l < n; l++) addQuadratic(Q, k, l, 2 * lambda * a[k] * a[l]);
  }

  return createModel({
    problemType: 'knapsack',
    variables: variables,
    Q: Q,
    offset: lambda * W * W,
    penalty: penalty,
    source: {
      items: items.map((it, i) => ({
        name: it.name || ('item ' + (i + 1)), value: it.value, weight: it.weight
      })),
      capacity: W,
      lambda: spec.lambda === undefined ? null : spec.lambda,
      slackCoeffs: coeffs
    }
  });
}

/** The Hamiltonian as WRITTEN, recomputed from the problem data, not from Q. */
function knapsackReferenceEnergy(model, bits) {
  const { items, capacity, slackCoeffs } = model.source;
  const lambda = model.penalty.lambda;
  let value = 0, load = 0;
  items.forEach((it, i) => { if (bits[i]) { value += it.value; load += it.weight; } });
  slackCoeffs.forEach((c, j) => { if (bits[items.length + j]) load += c; });
  const slackDev = load - capacity;
  return -value + lambda * slackDev * slackDev;
}

function knapsackBound(spec) {
  let maxValue = 0;
  for (const it of (spec.items || [])) {
    if (typeof it.value === 'number' && Number.isFinite(it.value)) maxValue = Math.max(maxValue, it.value);
  }
  return maxValue;
}

function knapsackQubits(spec) {
  const items = (spec.items || []).length;
  const W = spec.capacity;
  if (!Number.isInteger(W) || W <= 0) return items;
  return items + knapsackSlack(W).length;
}

/**
 * What one bitstring means as a knapsack answer.
 * `feasible` is about the PROBLEM (does it fit?), `exact` is about the QUBO
 * (did the slack bits land on the equality?). They differ: a selection that fits
 * with the slack bits set wrongly is a feasible packing sitting at a higher
 * energy, which is exactly what the penalty is supposed to do.
 */
function knapsackDecode(model, bits) {
  const src = model.source;
  const chosen = [];
  let value = 0, weight = 0, slackUsed = 0;

  model.variables.forEach((v, k) => {
    if (!bits[k]) return;
    if (v.meta.role === 'item') {
      chosen.push(v.meta.name);
      value += v.meta.value;
      weight += v.meta.weight;
    } else {
      slackUsed += v.meta.coeff;
    }
  });

  const deviation = weight + slackUsed - src.capacity;
  return {
    objective: value,
    sense: 'max',
    feasible: weight <= src.capacity,
    exact: deviation === 0,
    summary: chosen.length ? chosen.join(' + ') : '(nothing)',
    parts: [
      { k: 'takes', v: chosen.length ? chosen.join(', ') : 'nothing' },
      { k: 'value', v: value },
      { k: 'weight', v: weight + ' / ' + src.capacity },
      { k: 'slack', v: slackUsed },
      { k: 'constraint', v: deviation === 0 ? 'satisfied exactly' : 'off by ' + deviation }
    ]
  };
}

/**
 * The true constrained optimum, found by enumerating item subsets: the
 * problem's own space, 2^N, not the QUBO's 2^n. This is the reference the QUBO's
 * ground state is checked against, so it must not be computed from the QUBO.
 */
function knapsackOptimum(model) {
  const items = model.source.items;
  const W = model.source.capacity;
  const N = items.length;
  let best = { objective: -Infinity, weight: 0, selection: [] };

  for (let mask = 0; mask < (1 << N); mask++) {
    let v = 0, w = 0;
    for (let i = 0; i < N; i++) {
      if (mask & (1 << i)) { v += items[i].value; w += items[i].weight; }
    }
    if (w > W) continue;
    if (v > best.objective || (v === best.objective && w < best.weight)) {
      const sel = [];
      for (let i = 0; i < N; i++) if (mask & (1 << i)) sel.push(items[i].name);
      best = { objective: v, weight: w, selection: sel };
    }
  }
  return {
    objective: best.objective,
    sense: 'max',
    summary: best.selection.length ? best.selection.join(' + ') : '(nothing)',
    detail: 'value ' + best.objective + ', weight ' + best.weight + ' / ' + W,
    selection: best.selection
  };
}

/* ========================================================================== */
/* B.2  NUMBER PARTITIONING                                                   */
/* ========================================================================== */

/*
   Split a multiset of numbers into two piles with sums as close as possible.

   Lucas writes it in spins:  H = A * (sum_i n_i s_i)^2, with s_i = +-1 saying
   which pile number i goes to. Substituting s_i = 2x_i - 1 and S = sum_i n_i:

       H = A * (2*sum_i n_i x_i - S)^2
         = A * [ 4*sum_i n_i^2 x_i + 8*sum_{i<j} n_i n_j x_i x_j
                 - 4S*sum_i n_i x_i + S^2 ]

   so  Q[i][i] = 4A*(n_i^2 - S*n_i),  Q[i][j] = 8A*n_i*n_j,  offset = A*S^2.
   The energy is exactly A * (difference between the piles)^2.

   There is no constraint here (every assignment is a legal partition), so any
   A > 0 is safe and the bound is 0. The scale only sets the units of the energy.

   Qubits: N. Lucas notes one variable can be fixed (the answer is symmetric
   under swapping the piles), saving a qubit; we do not, so that the ledger says
   one qubit per number and the two mirrored ground states are visible for what
   they are.
*/

function numpartBuild(spec) {
  const numbers = spec.numbers || [];
  if (!numbers.length) throw new BuildError('Add at least one number.', 'numbers');
  numbers.forEach((entry, i) => {
    if (typeof entry.n !== 'number' || !Number.isFinite(entry.n)) {
      throw new BuildError('Number ' + (i + 1) + ' is not a number.', 'n:' + i);
    }
    if (entry.n <= 0) throw new BuildError('Number ' + (i + 1) + ' has to be positive.', 'n:' + i);
  });

  const penalty = resolvePenalty(numpartBound(spec), spec.lambda);
  const A = penalty.lambda;
  const S = numbers.reduce((acc, e) => acc + e.n, 0);

  const variables = numbers.map((e, i) => makeVariable(
    'x·' + (e.name || e.n), 'x' + i, 'decision',
    { role: 'number', numberIndex: i, name: e.name || String(e.n), n: e.n }
  ));

  const N = variables.length;
  const Q = zeroMatrix(N);
  for (let i = 0; i < N; i++) {
    const ni = numbers[i].n;
    addLinear(Q, i, 4 * A * (ni * ni - S * ni));
    for (let j = i + 1; j < N; j++) addQuadratic(Q, i, j, 8 * A * ni * numbers[j].n);
  }

  return createModel({
    problemType: 'number_partitioning',
    variables: variables,
    Q: Q,
    offset: A * S * S,
    penalty: penalty,
    source: {
      numbers: numbers.map((e, i) => ({ name: e.name || String(e.n), n: e.n })),
      total: S,
      lambda: spec.lambda === undefined ? null : spec.lambda
    }
  });
}

/* Any positive scale works: there is nothing to violate. */
function numpartReferenceEnergy(model, bits) {
  const { numbers, total } = model.source;
  const A = model.penalty.lambda;
  let picked = 0;
  numbers.forEach((e, i) => { if (bits[i]) picked += e.n; });
  const gap = 2 * picked - total;          /* = (pile A) - (pile B) */
  return A * gap * gap;
}

function numpartBound() { return 0; }

function numpartQubits(spec) { return (spec.numbers || []).length; }

function numpartDecode(model, bits) {
  const left = [], right = [];
  let sumLeft = 0, sumRight = 0;
  model.variables.forEach((v, k) => {
    if (bits[k]) { left.push(v.meta.name); sumLeft += v.meta.n; }
    else { right.push(v.meta.name); sumRight += v.meta.n; }
  });
  const diff = Math.abs(sumLeft - sumRight);
  return {
    objective: diff,
    sense: 'min',
    feasible: true,                 /* every assignment is a legal partition */
    exact: diff === 0,
    summary: '{' + (left.join(', ') || '∅') + '} vs {' + (right.join(', ') || '∅') + '}',
    parts: [
      { k: 'pile A', v: (left.join(' + ') || 'empty') + ' = ' + sumLeft },
      { k: 'pile B', v: (right.join(' + ') || 'empty') + ' = ' + sumRight },
      { k: 'difference', v: diff }
    ]
  };
}

function numpartOptimum(model) {
  const nums = model.source.numbers.map((e) => e.n);
  const N = nums.length;
  const total = model.source.total;
  let best = Infinity, bestMask = 0;
  for (let mask = 0; mask < (1 << N); mask++) {
    let sum = 0;
    for (let i = 0; i < N; i++) if (mask & (1 << i)) sum += nums[i];
    const diff = Math.abs(2 * sum - total);
    if (diff < best) { best = diff; bestMask = mask; }
  }
  const left = [], right = [];
  for (let i = 0; i < N; i++) (bestMask & (1 << i) ? left : right).push(model.source.numbers[i].name);
  return {
    objective: best,
    sense: 'min',
    summary: '{' + (left.join(', ') || '∅') + '} vs {' + (right.join(', ') || '∅') + '}',
    detail: best === 0 ? 'a perfect split' : 'closest possible gap is ' + best,
    selection: left
  };
}

/* ========================================================================== */
/* B.3  MAXIMAL INDEPENDENT SET                                               */
/* ========================================================================== */

/*
   Pick as many vertices as possible, no two of them joined by an edge.

       H = A * sum_{(u,v) in E} x_u x_v  -  B * sum_v x_v

   so  Q[v][v] = -B,  Q[u][v] = +A on each edge,  offset = 0.
   With the objective normalised to B = 1, the energy of a valid independent set
   is minus its size.

   Safe penalty: A > B, i.e. lambda > 1. Taking a vertex gains 1 and, if it
   conflicts with anything already taken, costs at least lambda, so a conflict
   can never pay for itself.

   Qubits: |V|.
*/

function misBuild(spec) {
  const { vertices, edges } = requireGraph(spec);
  const penalty = resolvePenalty(misBound(spec), spec.lambda);
  const A = penalty.lambda, B = 1;
  const { deg } = degrees(vertices, edges);

  const variables = vertexVariables(vertices, deg);
  const Q = zeroMatrix(vertices.length);
  for (let v = 0; v < vertices.length; v++) addLinear(Q, v, -B);
  for (const [u, v] of edges) addQuadratic(Q, u, v, A);

  return createModel({
    problemType: 'max_independent_set',
    variables: variables,
    Q: Q,
    offset: 0,
    penalty: penalty,
    source: { vertices, edges, raw: spec.raw || '', lambda: spec.lambda === undefined ? null : spec.lambda }
  });
}

function misReferenceEnergy(model, bits) {
  const { edges } = model.source;
  const A = model.penalty.lambda, B = 1;
  let e = 0;
  for (const [u, v] of edges) if (bits[u] && bits[v]) e += A;
  for (let v = 0; v < bits.length; v++) if (bits[v]) e -= B;
  return e;
}

function misBound() { return 1; }                    /* B = 1 */
function graphQubits(spec) { return (spec.vertices || []).length; }

function misDecode(model, bits) {
  const { names, idx } = selectedVertices(model, bits);
  const bad = internalEdges(model.source.edges, idx);
  return {
    objective: names.length,
    sense: 'max',
    feasible: bad.length === 0,
    exact: bad.length === 0,
    summary: '{' + (names.join(', ') || '∅') + '}',
    parts: [
      { k: 'takes', v: names.join(', ') || 'nothing' },
      { k: 'size', v: names.length },
      { k: 'conflicts', v: bad.length === 0 ? 'none' : bad.length + ' edge(s) inside the set' }
    ]
  };
}

function misOptimum(model) {
  const { vertices, edges } = model.source;
  const N = vertices.length;
  const adj = adjacencyMasks(vertices, edges);
  let bestSize = -1, bestMask = 0;
  for (let mask = 0; mask < (1 << N); mask++) {
    let ok = true;
    for (let v = 0; v < N && ok; v++) if ((mask >> v) & 1) ok = (adj[v] & mask) === 0;
    if (!ok) continue;
    const size = popcount(mask);
    if (size > bestSize) { bestSize = size; bestMask = mask; }
  }
  const sel = [];
  for (let v = 0; v < N; v++) if (bestMask & (1 << v)) sel.push(vertices[v]);
  return {
    objective: bestSize,
    sense: 'max',
    summary: '{' + (sel.join(', ') || '∅') + '}',
    detail: bestSize + ' vertices, no edge between any of them',
    selection: sel
  };
}

/* ========================================================================== */
/* B.4  VERTEX COVER                                                          */
/* ========================================================================== */

/*
   Pick as FEW vertices as possible so that every edge has at least one end
   picked.

       H = A * sum_{(u,v) in E} (1 - x_u)(1 - x_v)  +  B * sum_v x_v

   Expanding (1-x_u)(1-x_v) = 1 - x_u - x_v + x_u x_v:

       Q[v][v] = B - A*deg(v),  Q[u][v] = +A on each edge,  offset = A*|E|

   A valid cover leaves every edge term at zero, so its energy is exactly its
   size. Safe penalty: A > B, i.e. lambda > 1: dropping a vertex from the cover
   saves 1 but uncovers at least one edge at a cost of lambda.

   Qubits: |V|.
*/

function vcBuild(spec) {
  const { vertices, edges } = requireGraph(spec);
  const penalty = resolvePenalty(vcBound(spec), spec.lambda);
  const A = penalty.lambda, B = 1;
  const { deg } = degrees(vertices, edges);

  const variables = vertexVariables(vertices, deg);
  const Q = zeroMatrix(vertices.length);
  for (let v = 0; v < vertices.length; v++) addLinear(Q, v, B - A * deg[v]);
  for (const [u, v] of edges) addQuadratic(Q, u, v, A);

  return createModel({
    problemType: 'vertex_cover',
    variables: variables,
    Q: Q,
    offset: A * edges.length,
    penalty: penalty,
    source: { vertices, edges, raw: spec.raw || '', lambda: spec.lambda === undefined ? null : spec.lambda }
  });
}

function vcReferenceEnergy(model, bits) {
  const { edges } = model.source;
  const A = model.penalty.lambda, B = 1;
  let e = 0;
  for (const [u, v] of edges) e += A * (1 - bits[u]) * (1 - bits[v]);
  for (let v = 0; v < bits.length; v++) if (bits[v]) e += B;
  return e;
}

function vcBound() { return 1; }                     /* B = 1 */

function vcDecode(model, bits) {
  const { names, idx } = selectedVertices(model, bits);
  const inSet = new Set(idx);
  const uncovered = model.source.edges.filter(([u, v]) => !inSet.has(u) && !inSet.has(v));
  return {
    objective: names.length,
    sense: 'min',
    feasible: uncovered.length === 0,
    exact: uncovered.length === 0,
    summary: '{' + (names.join(', ') || '∅') + '}',
    parts: [
      { k: 'covers with', v: names.join(', ') || 'nothing' },
      { k: 'size', v: names.length },
      { k: 'uncovered', v: uncovered.length === 0 ? 'none' : uncovered.length + ' edge(s)' }
    ]
  };
}

function vcOptimum(model) {
  const { vertices, edges } = model.source;
  const N = vertices.length;
  let bestSize = Infinity, bestMask = 0;
  for (let mask = 0; mask < (1 << N); mask++) {
    const size = popcount(mask);
    if (size >= bestSize) continue;
    let ok = true;
    for (const [u, v] of edges) {
      if (!((mask >> u) & 1) && !((mask >> v) & 1)) { ok = false; break; }
    }
    if (ok) { bestSize = size; bestMask = mask; }
  }
  const sel = [];
  for (let v = 0; v < N; v++) if (bestMask & (1 << v)) sel.push(vertices[v]);
  return {
    objective: bestSize === Infinity ? 0 : bestSize,
    sense: 'min',
    summary: '{' + (sel.join(', ') || '∅') + '}',
    detail: sel.length + ' vertices touch all ' + edges.length + ' edge(s)',
    selection: sel
  };
}

/* ========================================================================== */
/* B.5  GRAPH PARTITIONING                                                    */
/* ========================================================================== */

/*
   Split the vertices into two equal halves, cutting as few edges as possible.

       H = A * (sum_v (2x_v - 1))^2  +  B * sum_{(u,v) in E} (x_u + x_v - 2 x_u x_v)

   The first term is zero exactly when the halves are equal; the second counts
   the cut, since x_u + x_v - 2 x_u x_v is 1 precisely when the ends differ.
   With m = sum_v x_v the first term is (2m - N)^2, which expands to

       Q[v][v] = 4A*(1 - N) + B*deg(v)
       Q[u][v] = 8A            for EVERY pair u < v      (the balance term)
                 - 2B          additionally on each edge (the cut term)
       offset  = A*N^2

   Note the balance term couples every pair of vertices, so this is the one
   template here whose Q is dense: |V|(|V|-1)/2 quadratic entries regardless of
   how few edges the graph has.

   Safe penalty: A/B >= min(2*Delta, N)/8 (Lucas eq. 10, Delta the largest
   degree). The bound is inclusive, not strict.

   Qubits: |V|, and |V| must be even. With an odd number of vertices there is
   no equal split, and the balance term could never reach zero.
*/

function partBuild(spec) {
  const { vertices, edges } = requireGraph(spec);
  const N = vertices.length;
  if (N % 2 !== 0) {
    throw new BuildError(
      'Graph partitioning splits the vertices into two equal halves, so it needs an even number ' +
      'of them, and this graph has ' + N + '. Add or remove a vertex.', 'graph');
  }
  const penalty = resolvePenalty(partBound(spec), spec.lambda);
  const A = penalty.lambda, B = 1;
  const { deg } = degrees(vertices, edges);

  const variables = vertexVariables(vertices, deg);
  const Q = zeroMatrix(N);
  for (let v = 0; v < N; v++) addLinear(Q, v, 4 * A * (1 - N) + B * deg[v]);
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) addQuadratic(Q, u, v, 8 * A);
  for (const [u, v] of edges) addQuadratic(Q, u, v, -2 * B);

  return createModel({
    problemType: 'graph_partitioning',
    variables: variables,
    Q: Q,
    offset: A * N * N,
    penalty: penalty,
    source: { vertices, edges, raw: spec.raw || '', lambda: spec.lambda === undefined ? null : spec.lambda }
  });
}

function partReferenceEnergy(model, bits) {
  const { edges } = model.source;
  const A = model.penalty.lambda, B = 1;
  let imbalance = 0;
  for (let v = 0; v < bits.length; v++) imbalance += (2 * bits[v] - 1);
  let cut = 0;
  for (const [u, v] of edges) cut += bits[u] + bits[v] - 2 * bits[u] * bits[v];
  return A * imbalance * imbalance + B * cut;
}

/* Lucas eq. 10: A/B >= min(2*Delta, N)/8, with B normalised to 1. */
function partBound(spec) {
  const vertices = spec.vertices || [], edges = spec.edges || [];
  if (!vertices.length) return 0;
  const { max } = degrees(vertices, edges);
  return Math.min(2 * max, vertices.length) / 8;
}

function partDecode(model, bits) {
  const { vertices, edges } = model.source;
  const N = vertices.length;
  const left = [], leftIdx = [], right = [];
  model.variables.forEach((v, k) => {
    if (bits[k]) { left.push(v.meta.name); leftIdx.push(v.meta.vertexIndex); }
    else right.push(v.meta.name);
  });
  const cut = cutEdges(edges, leftIdx);
  const balanced = left.length === N / 2;
  return {
    objective: cut.length,
    sense: 'min',
    feasible: balanced,
    exact: balanced,
    summary: '{' + (left.join(', ') || '∅') + '} | {' + (right.join(', ') || '∅') + '}',
    parts: [
      { k: 'side A', v: left.join(', ') || 'empty' },
      { k: 'side B', v: right.join(', ') || 'empty' },
      { k: 'balance', v: balanced ? 'equal halves' : left.length + ' vs ' + right.length },
      { k: 'cut', v: cut.length + ' edge(s)' }
    ]
  };
}

function partOptimum(model) {
  const { vertices, edges } = model.source;
  const N = vertices.length;
  const half = N / 2;
  let bestCut = Infinity, bestMask = 0;
  for (let mask = 0; mask < (1 << N); mask++) {
    if (popcount(mask) !== half) continue;
    let cut = 0;
    for (const [u, v] of edges) if (((mask >> u) & 1) !== ((mask >> v) & 1)) cut++;
    if (cut < bestCut) { bestCut = cut; bestMask = mask; }
  }
  const left = [], right = [];
  for (let v = 0; v < N; v++) (bestMask & (1 << v) ? left : right).push(vertices[v]);
  return {
    objective: bestCut === Infinity ? 0 : bestCut,
    sense: 'min',
    summary: '{' + left.join(', ') + '} | {' + right.join(', ') + '}',
    detail: 'equal halves cutting ' + bestCut + ' of ' + edges.length + ' edge(s)',
    selection: left
  };
}

/* ========================================================================== */
/* B.6  GRAPH COLOURING                                                       */
/* ========================================================================== */

/*
   Colour every vertex so that no edge joins two vertices of the same colour.
   This is the first template with an INDEXED FAMILY: one variable per
   (vertex, colour) pair, x[v,i], laid out with each vertex's colours contiguous.

       H = A * sum_v (1 - sum_i x[v,i])^2  +  A * sum_{(u,v) in E} sum_i x[u,i] x[v,i]

   The first term is the "exactly one colour per vertex" constraint; the second
   charges A for every edge whose ends share a colour. Expanding the square
   (see addExactlyOne in qubo.js):

       Q[(v,i)][(v,i)] = -A                       for every vertex/colour
       Q[(v,i)][(v,j)] = +2A                      for i < j, same vertex
       Q[(u,i)][(v,i)] += +A                      for each edge, each colour
       offset          = A * |V|

   This is a FEASIBILITY problem: there is nothing to optimise, only to satisfy,
   so the energy of a proper colouring is exactly 0 and any A > 0 will do. The
   bound is therefore 0 and lambda is just a scale.

   Qubits: n * |V|.

   One consequence worth knowing: when the graph is NOT n-colourable the ground
   state can be degenerate between "one vertex left uncoloured" and "one edge
   left conflicting"; both cost exactly A. That is the formulation behaving
   correctly and telling you the instance is impossible, which is why verify.js
   treats a feasibility template's unsatisfiable case as an answer rather than a
   failure.
*/

const COLOUR_NAMES = ['red', 'blue', 'green', 'amber', 'violet', 'teal', 'pink', 'olive'];

function colourLabels(count) {
  return Array.from({ length: count }, (_, i) => COLOUR_NAMES[i] || ('c' + (i + 1)));
}

function colouringBuild(spec) {
  const { vertices, edges } = requireGraph(spec);
  const k = spec.colours;
  requireWholeNumber(k, 'The number of colours', 'colours');
  if (k < 1) throw new BuildError('You need at least one colour.', 'colours');
  if (k > COLOUR_NAMES.length) {
    throw new BuildError('This tool names up to ' + COLOUR_NAMES.length + ' colours; ' + k + ' is more than that.', 'colours');
  }

  const penalty = resolvePenalty(colouringBound(spec), spec.lambda);
  const A = penalty.lambda;
  const labels = colourLabels(k);

  const family = indexFamily([
    { key: 'v', labels: vertices },
    { key: 'c', labels: labels }
  ]);

  const variables = family.entries.map((e, i) => makeVariable(
    'x·' + e.labels.v + '·' + e.labels.c, 'x' + i, 'decision',
    {
      role: 'vertexColour',
      vertexIndex: e.coords.v, vertexName: e.labels.v,
      colourIndex: e.coords.c, colourName: e.labels.c
    }
  ));

  const Q = zeroMatrix(family.total);
  let offset = 0;

  /* exactly one colour per vertex */
  const groups = groupsAlong(family, 'c').map((g) => ({
    kind: 'exactly_one',
    label: 'vertex ' + g.labels.v + ' takes exactly one colour',
    members: g.members
  }));
  for (const g of groups) offset += addExactlyOne(Q, g.members, A);

  /* no edge may be monochromatic */
  for (const [u, v] of edges) {
    for (let i = 0; i < k; i++) addQuadratic(Q, family.at({ v: u, c: i }), family.at({ v: v, c: i }), A);
  }

  const model = createModel({
    problemType: 'graph_colouring',
    variables: variables,
    Q: Q,
    offset: offset,
    penalty: penalty,
    source: {
      vertices, edges, colours: k, colourNames: labels,
      raw: spec.raw || '', lambda: spec.lambda === undefined ? null : spec.lambda
    }
  });
  model.groups = groups;
  return model;
}

/* A feasibility problem: any positive scale works. */
function colouringBound() { return 0; }

function colouringQubits(spec) {
  const v = (spec.vertices || []).length;
  const k = spec.colours;
  return Number.isInteger(k) && k > 0 ? v * k : v;
}

/** The Hamiltonian as WRITTEN, recomputed from the problem data, not from Q. */
function colouringReferenceEnergy(model, bits) {
  const { vertices, edges, colours } = model.source;
  const A = model.penalty.lambda;
  const at = (v, c) => v * colours + c;
  let e = 0;
  for (let v = 0; v < vertices.length; v++) {
    let count = 0;
    for (let c = 0; c < colours; c++) if (bits[at(v, c)]) count++;
    e += A * (1 - count) * (1 - count);
  }
  for (const [u, v] of edges) {
    for (let c = 0; c < colours; c++) if (bits[at(u, c)] && bits[at(v, c)]) e += A;
  }
  return e;
}

function colouringDecode(model, bits) {
  const { vertices, edges, colours, colourNames } = model.source;
  const at = (v, c) => v * colours + c;
  const assigned = [];
  let multi = 0, none = 0;

  for (let v = 0; v < vertices.length; v++) {
    const on = [];
    for (let c = 0; c < colours; c++) if (bits[at(v, c)]) on.push(c);
    if (on.length === 0) none++;
    else if (on.length > 1) multi++;
    assigned.push(on);
  }
  const clashes = edges.filter(([u, v]) =>
    assigned[u].some((c) => assigned[v].includes(c)));

  const proper = none === 0 && multi === 0;
  return {
    objective: clashes.length,
    sense: 'min',
    /* "feasible" here means it is a colouring at all: one colour per vertex. */
    feasible: proper && clashes.length === 0,
    exact: proper,
    summary: proper
      ? vertices.map((name, v) => name + '=' + colourNames[assigned[v][0]]).join(', ')
      : (none ? none + ' vertex/vertices uncoloured' : '') +
        (none && multi ? ', ' : '') + (multi ? multi + ' with more than one colour' : ''),
    parts: [
      { k: 'colouring', v: proper ? vertices.map((name, v) => name + '=' + colourNames[assigned[v][0]]).join(' ') : 'not a colouring' },
      { k: 'one colour each', v: proper ? 'yes' : (none + ' bare, ' + multi + ' doubled') },
      { k: 'clashing edges', v: clashes.length }
    ]
  };
}

/**
 * The reference answer, searched over the PROBLEM's space: every assignment of
 * exactly one colour per vertex, k^|V| of them. Also reports how many colours
 * this graph actually needs, so the verdict can say something useful when the
 * instance is impossible.
 */
function colouringOptimum(model) {
  const { vertices, edges, colours, colourNames } = model.source;
  const N = vertices.length;

  function minClashes(k) {
    if (k < 1) return Infinity;
    const assign = new Array(N).fill(0);
    let best = Infinity, bestAssign = null;
    const total = Math.pow(k, N);
    for (let code = 0; code < total; code++) {
      let rest = code;
      for (let v = 0; v < N; v++) { assign[v] = rest % k; rest = Math.floor(rest / k); }
      let clashes = 0;
      for (const [u, v] of edges) if (assign[u] === assign[v]) clashes++;
      if (clashes < best) { best = clashes; bestAssign = assign.slice(); if (best === 0) break; }
    }
    return { clashes: best, assign: bestAssign };
  }

  const here = minClashes(colours);
  /* the chromatic number, for the message when `colours` is not enough */
  let chromatic = colours;
  if (here.clashes > 0) {
    chromatic = colours + 1;
    while (chromatic <= N && minClashes(chromatic).clashes > 0) chromatic++;
  }

  const summary = here.assign
    ? vertices.map((name, v) => name + '=' + colourNames[here.assign[v]]).join(', ')
    : '(none)';
  return {
    objective: here.clashes,
    sense: 'min',
    summary: here.clashes === 0 ? summary : 'no proper colouring with ' + colours + ' colour(s)',
    detail: here.clashes === 0
      ? 'every edge joins two different colours'
      : 'the best ' + colours + '-colouring still clashes on ' + here.clashes + ' edge(s); this graph needs ' + chromatic + ' colours',
    chromatic: chromatic,
    selection: here.assign || []
  };
}

/* ========================================================================== */
/* B.7  MAX CLIQUE  (decision form: is there a clique of size K?)             */
/* ========================================================================== */

/*
   Lucas eq. 13, the decision version: pick exactly K vertices and ask whether
   they are all pairwise joined.

       H = A * (K - sum_v x_v)^2  +  B * [ K(K-1)/2 - sum_{(u,v) in E} x_u x_v ]

   Expanding the square, with y^2 = y:

       Q[v][v] = A*(1 - 2K)
       Q[u][v] = +2A                for EVERY pair u < v      (the size term)
                 -B                 additionally on each edge  (the clique term)
       offset  = A*K^2 + B*K(K-1)/2

   Like graph partitioning, the size term couples every pair, so Q is dense
   whatever the graph looks like.

   Safe penalty: A > K*B. With B normalised to 1 that is lambda > K: dropping a
   vertex from a K-set saves at most K missing-edge charges but costs A.

   Qubits: |V|. (Lucas's largest-clique variant adds a second family of
   variables and needs A > N*B; that is a later tier, not this.)
*/

function cliqueBuild(spec) {
  const { vertices, edges } = requireGraph(spec);
  const K = spec.size;
  requireWholeNumber(K, 'The clique size K', 'size');
  if (K < 1) throw new BuildError('A clique has at least one vertex.', 'size');
  if (K > vertices.length) {
    throw new BuildError('You asked for a clique of ' + K + ' vertices, but the graph only has ' +
      vertices.length + '.', 'size');
  }

  const penalty = resolvePenalty(cliqueBound(spec), spec.lambda);
  const A = penalty.lambda, B = 1;
  const { deg } = degrees(vertices, edges);
  const N = vertices.length;

  const variables = vertexVariables(vertices, deg);
  const Q = zeroMatrix(N);
  for (let v = 0; v < N; v++) addLinear(Q, v, A * (1 - 2 * K));
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) addQuadratic(Q, u, v, 2 * A);
  for (const [u, v] of edges) addQuadratic(Q, u, v, -B);

  return createModel({
    problemType: 'max_clique',
    variables: variables,
    Q: Q,
    offset: A * K * K + B * K * (K - 1) / 2,
    penalty: penalty,
    source: { vertices, edges, size: K, raw: spec.raw || '', lambda: spec.lambda === undefined ? null : spec.lambda }
  });
}

/* A > K*B, with B = 1. */
function cliqueBound(spec) {
  const K = spec.size;
  return Number.isInteger(K) && K > 0 ? K : 0;
}

function cliqueReferenceEnergy(model, bits) {
  const { edges, size: K } = model.source;
  const A = model.penalty.lambda, B = 1;
  let chosen = 0;
  for (let v = 0; v < bits.length; v++) if (bits[v]) chosen++;
  let inside = 0;
  for (const [u, v] of edges) if (bits[u] && bits[v]) inside++;
  return A * (K - chosen) * (K - chosen) + B * (K * (K - 1) / 2 - inside);
}

function cliqueDecode(model, bits) {
  const { names, idx } = selectedVertices(model, bits);
  const K = model.source.size;
  const inside = internalEdges(model.source.edges, idx).length;
  const wanted = names.length * (names.length - 1) / 2;
  const missing = Math.max(0, K * (K - 1) / 2 - inside);
  return {
    objective: missing,
    sense: 'min',
    /* the hard constraint is the SIZE; whether it is a clique is the question */
    feasible: names.length === K,
    exact: names.length === K && missing === 0,
    summary: '{' + (names.join(', ') || '∅') + '}',
    parts: [
      { k: 'picks', v: names.join(', ') || 'nothing' },
      { k: 'size', v: names.length + ' of ' + K },
      { k: 'edges inside', v: inside + ' of ' + wanted + ' possible' },
      { k: 'missing for a clique', v: missing }
    ]
  };
}

function cliqueOptimum(model) {
  const { vertices, edges, size: K } = model.source;
  const N = vertices.length;
  const need = K * (K - 1) / 2;
  let best = Infinity, bestMask = 0;
  for (let mask = 0; mask < (1 << N); mask++) {
    if (popcount(mask) !== K) continue;
    let inside = 0;
    for (const [u, v] of edges) if (((mask >> u) & 1) && ((mask >> v) & 1)) inside++;
    const missing = need - inside;
    if (missing < best) { best = missing; bestMask = mask; if (best === 0) break; }
  }
  const sel = [];
  for (let v = 0; v < N; v++) if (bestMask & (1 << v)) sel.push(vertices[v]);
  return {
    objective: best === Infinity ? 0 : best,
    sense: 'min',
    summary: '{' + sel.join(', ') + '}',
    detail: best === 0
      ? 'all ' + need + ' internal edges present, a clique of ' + K
      : 'the best ' + K + '-set is still missing ' + best + ' edge(s); there is no ' + K + '-clique here',
    selection: sel
  };
}

/* ========================================================================== */
/* registry                                                                   */
/* ========================================================================== */

export const PROBLEMS = {
  knapsack: {
    id: 'knapsack',
    title: 'Knapsack',
    tagline: 'fit the most value into a fixed capacity',
    inputMode: 'form',
    /* shown next to the penalty, so the number on screen is never unexplained */
    boundText: 'λ > max value of any single item',
    constraintText: 'total weight = capacity, with slack bits absorbing the difference',
    build: knapsackBuild,
    bound: knapsackBound,
    qubits: knapsackQubits,
    decode: knapsackDecode,
    optimum: knapsackOptimum,
    referenceEnergy: knapsackReferenceEnergy,
    /* one line per row of the variable ledger */
    describeVar: (v) => v.meta.role === 'item'
      ? 'value ' + v.meta.value + ', weight ' + v.meta.weight
      : 'slack bit, weight coefficient ' + v.meta.coeff,
    previewText: (spec, qubits) => {
      const slack = Number.isInteger(spec.capacity) && spec.capacity > 0 ? qubits - spec.items.length : 0;
      return qubits + ' qubits: ' + spec.items.length + ' for the items' +
        (slack ? ' and ' + slack + ' slack bit' + (slack === 1 ? '' : 's') + ' for the capacity' : '') + '.';
    },
    input: {
      rows: {
        noun: 'item', addLabel: '+ item',
        columns: [
          { key: 'name', label: 'item', type: 'text', placeholder: 'name' },
          { key: 'value', label: 'value', type: 'number', step: 'any', min: '0' },
          { key: 'weight', label: 'weight', type: 'number', step: '1', min: '1' }
        ]
      },
      fields: [{
        key: 'capacity', label: 'capacity', type: 'number', step: '1', min: '1',
        note: 'Whole numbers only; the slack bits count in integers.'
      }],
      toRows: (d) => d.items.map((it) => ({ name: it.name, value: String(it.value), weight: String(it.weight) })),
      toSpec: (rows, fields) => ({
        items: rows.map((r) => ({ name: String(r.name || '').trim(), value: toNum(r.value), weight: toNum(r.weight) })),
        capacity: toNum(fields.capacity)
      })
    },
    defaults: () => ({
      items: [
        { name: 'Gold', value: 6, weight: 3 },
        { name: 'Silver', value: 5, weight: 2 },
        { name: 'Bronze', value: 4, weight: 4 }
      ],
      capacity: 5,
      lambda: null
    })
  },

  number_partitioning: {
    id: 'number_partitioning',
    title: 'Number partitioning',
    tagline: 'split a list into two equal piles',
    inputMode: 'set',
    boundText: 'any λ > 0 works, since there is no constraint to break',
    constraintText: 'none; the energy IS the squared gap between the two piles',
    build: numpartBuild,
    bound: numpartBound,
    qubits: numpartQubits,
    decode: numpartDecode,
    optimum: numpartOptimum,
    referenceEnergy: numpartReferenceEnergy,
    describeVar: (v) => 'the number ' + v.meta.n + ': on if it goes in pile A',
    previewText: (spec, qubits) => qubits + ' qubits, one per number.',
    input: {
      rows: {
        noun: 'number', addLabel: '+ number',
        columns: [
          { key: 'name', label: 'label', type: 'text', placeholder: 'optional' },
          { key: 'n', label: 'number', type: 'number', step: 'any', min: '0' }
        ]
      },
      fields: [],
      toRows: (d) => d.numbers.map((e) => ({ name: e.name, n: String(e.n) })),
      toSpec: (rows) => ({
        numbers: rows.map((r) => ({ name: String(r.name || '').trim(), n: toNum(r.n) }))
      })
    },
    defaults: () => ({
      numbers: [3, 1, 1, 2, 2, 1].map((n, i) => ({ name: 'n' + (i + 1), n })),
      lambda: null
    })
  },

  max_independent_set: {
    id: 'max_independent_set',
    title: 'Maximal independent set',
    tagline: 'most vertices, none of them neighbours',
    inputMode: 'graph',
    boundText: 'λ > 1 (the objective is normalised to B = 1)',
    constraintText: 'no edge may have both ends selected',
    build: misBuild,
    bound: misBound,
    qubits: graphQubits,
    decode: misDecode,
    optimum: misOptimum,
    referenceEnergy: misReferenceEnergy,
    describeVar: (v) => 'vertex ' + v.meta.name + ', degree ' + v.meta.degree,
    previewText: (spec, qubits) => qubits + ' qubits, one per vertex, ' +
      (spec.edges || []).length + ' edge(s).',
    defaults: () => ({ ...parseEdgeList('0-1, 1-2, 2-3, 3-4, 4-0, 0-2'), lambda: null })
  },

  vertex_cover: {
    id: 'vertex_cover',
    title: 'Vertex cover',
    tagline: 'fewest vertices that touch every edge',
    inputMode: 'graph',
    boundText: 'λ > 1 (the objective is normalised to B = 1)',
    constraintText: 'every edge needs at least one of its ends selected',
    build: vcBuild,
    bound: vcBound,
    qubits: graphQubits,
    decode: vcDecode,
    optimum: vcOptimum,
    referenceEnergy: vcReferenceEnergy,
    describeVar: (v) => 'vertex ' + v.meta.name + ', degree ' + v.meta.degree,
    previewText: (spec, qubits) => qubits + ' qubits, one per vertex, ' +
      (spec.edges || []).length + ' edge(s).',
    defaults: () => ({ ...parseEdgeList('0-1, 1-2, 2-3, 3-4, 4-0, 0-2'), lambda: null })
  },

  graph_partitioning: {
    id: 'graph_partitioning',
    title: 'Graph partitioning',
    tagline: 'two equal halves, fewest edges cut',
    inputMode: 'graph',
    boundText: 'λ ≥ min(2Δ, N)/8, Δ the largest degree',
    /* Lucas eq. 10 is an inclusive bound, unlike the strict ones above. */
    boundStrict: false,
    constraintText: 'the two sides must hold the same number of vertices',
    needsEvenVertices: true,
    build: partBuild,
    bound: partBound,
    qubits: graphQubits,
    decode: partDecode,
    optimum: partOptimum,
    referenceEnergy: partReferenceEnergy,
    describeVar: (v) => 'vertex ' + v.meta.name + ', degree ' + v.meta.degree,
    previewText: (spec, qubits) => qubits + ' qubits, one per vertex, ' +
      (spec.edges || []).length + ' edge(s).',
    defaults: () => ({ ...parseEdgeList('0-1, 1-2, 2-3, 3-0, 0-2, 4-5, 5-0'), lambda: null })
  },

  graph_colouring: {
    id: 'graph_colouring',
    title: 'Graph colouring',
    tagline: 'no edge joins two of the same colour',
    inputMode: 'graph',
    boundText: 'any λ > 0 works, since nothing is being traded off',
    constraintText: 'exactly one colour per vertex, and no edge may be monochromatic',
    feasibilityProblem: true,
    build: colouringBuild,
    bound: colouringBound,
    qubits: colouringQubits,
    decode: colouringDecode,
    optimum: colouringOptimum,
    referenceEnergy: colouringReferenceEnergy,
    describeVar: (v) => 'vertex ' + v.meta.vertexName + ' is ' + v.meta.colourName,
    previewText: (spec, qubits) => qubits + ' qubits: ' + (spec.vertices || []).length +
      ' vertices × ' + (spec.colours || 0) + ' colours. One variable per pairing.',
    input: {
      fields: [{
        key: 'colours', label: 'colours', type: 'number', step: '1', min: '1',
        note: 'Every colour multiplies the qubit count. This is the expensive dial.'
      }]
    },
    defaults: () => ({ ...parseEdgeList('0-1, 1-2, 2-0, 2-3'), colours: 3, lambda: null })
  },

  max_clique: {
    id: 'max_clique',
    title: 'Max clique (decision)',
    tagline: 'is there a clique of size K?',
    inputMode: 'graph',
    boundText: 'λ > K (the objective is normalised to B = 1)',
    constraintText: 'exactly K vertices chosen; the question is whether they are all joined',
    feasibilityProblem: true,
    build: cliqueBuild,
    bound: cliqueBound,
    qubits: graphQubits,
    decode: cliqueDecode,
    optimum: cliqueOptimum,
    referenceEnergy: cliqueReferenceEnergy,
    describeVar: (v) => 'vertex ' + v.meta.name + ', degree ' + v.meta.degree,
    previewText: (spec, qubits) => qubits + ' qubits, one per vertex, ' +
      (spec.edges || []).length + ' edge(s), looking for a clique of ' + (spec.size || 0) + '.',
    input: {
      fields: [{
        key: 'size', label: 'clique size K', type: 'number', step: '1', min: '1',
        note: 'The decision form asks about one size at a time.'
      }]
    },
    defaults: () => ({ ...parseEdgeList('0-1, 1-2, 2-0, 2-3, 3-0'), size: 3, lambda: null })
  }
};

/** Registry lookup that fails loudly rather than returning undefined. */
export function problemFor(model) {
  const p = PROBLEMS[model.problemType];
  if (!p) throw new BuildError('No template is registered for "' + model.problemType + '".');
  return p;
}

export const PROBLEM_LIST = Object.keys(PROBLEMS).map((k) => PROBLEMS[k]);
