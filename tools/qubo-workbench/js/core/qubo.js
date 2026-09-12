/* ============================================================================
   qubo.js — THE SHARED CORE.  Frozen contract; every other module depends on it.

   One in-memory object describes a problem instance. Step 1 produces it; Steps
   2-4 and save.js only ever consume it. No other module may invent its own shape.

   Conventions that are decided here and nowhere else:

     * The primary representation is QUBO, over bits y_k in {0,1}.
       Ising (spins s_k in {-1,+1}) is ALWAYS derived via quboToIsing(), never
       entered and never stored. This kills the 0/1-vs-±1 bug class at the root.

     * Q is upper-triangular, including the diagonal:
         Q[k][k] = linear coefficient on y_k
         Q[k][l] = quadratic coefficient on y_k*y_l, for k < l  (one entry per pair)
       Entries with k > l are structurally zero and are never read.

     * The energy is
         E(y) = sum_k Q[k][k]*y_k + sum_{k<l} Q[k][l]*y_k*y_l + offset
       and `offset` is part of the model, not a detail. Dropping it silently
       shifts every energy and makes emitted code disagree with the browser.

     * Bit ordering (matters for brute force, the statevector sim and codegen):
       variable 0 is the MOST significant bit of the integer index.
         bits[k] = (z >> (n - 1 - k)) & 1
       This is the ordering PennyLane uses for qml.probs(wires=range(n)), so the
       tool and the emitted program agree without a reversal anywhere.
   ============================================================================ */

/* Envelope version for the model object. Bump only on a breaking shape change. */
export const SCHEMA_VERSION = 1;

/* The soft, per-feature line (see CLAUDE.md constraint 5). Simulation, brute
   force, verification and landscape analysis stop here; codegen never does. */
export const QUBIT_CAP = 20;
export const QUBIT_WARN = 18;

/* Bytes per amplitude of a dense statevector: complex128. */
const BYTES_PER_AMPLITUDE = 16;

/* ---------------------------------------------------------------- variables */

/**
 * One column/row of Q.
 * @param {string} label human-facing name, e.g. "x·Gold" or "x[v2,c1]"
 * @param {string} sym   short symbol used in formulas, e.g. "x0"
 * @param {"decision"|"ancilla"} kind
 * @param {object} [meta] problem-specific payload (item index, colour, slack coeff…)
 */
export function makeVariable(label, sym, kind, meta) {
  return { label: String(label), sym: String(sym), kind: kind, meta: meta || {} };
}

/* ------------------------------------------------------------------- matrix */

/** n×n array of zeros. Only the upper triangle is ever written. */
export function zeroMatrix(n) {
  const Q = new Array(n);
  for (let i = 0; i < n; i++) Q[i] = new Array(n).fill(0);
  return Q;
}

/** Q[k][k] += v */
export function addLinear(Q, k, v) {
  if (v === 0) return Q;
  Q[k][k] += v;
  return Q;
}

/** Q[min][max] += v — accepts the indices in either order, stays upper-triangular. */
export function addQuadratic(Q, k, l, v) {
  if (v === 0) return Q;
  if (k === l) { Q[k][k] += v; return Q; }   // y*y = y for bits, so it folds into linear
  const a = k < l ? k : l, b = k < l ? l : k;
  Q[a][b] += v;
  return Q;
}

/** The stored coefficient for the unordered pair {k,l}; 0 for k===l. */
export function pairCoeff(Q, k, l) {
  if (k === l) return 0;
  return k < l ? Q[k][l] : Q[l][k];
}

/**
 * Shape check only — no solving. Returns a list of problem strings (empty = fine).
 * verify.js layers the problem-specific checks on top of this.
 */
export function checkMatrixShape(Q, n) {
  const problems = [];
  if (!Array.isArray(Q) || Q.length !== n) {
    problems.push('Q has ' + (Array.isArray(Q) ? Q.length : 'no') + ' rows, expected ' + n + '.');
    return problems;
  }
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(Q[i]) || Q[i].length !== n) {
      problems.push('Row ' + i + ' has the wrong length.');
      continue;
    }
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(Q[i][j])) problems.push('Q[' + i + '][' + j + '] is not a finite number.');
      else if (j < i && Q[i][j] !== 0) problems.push('Q[' + i + '][' + j + '] is below the diagonal and non-zero — Q must be upper-triangular.');
    }
  }
  return problems;
}

/* -------------------------------------------------------------------- model */

/**
 * Derived counters. memoryBytes is what a dense statevector of this instance
 * would cost; it is the honest size signal. We never estimate a runtime — that
 * is machine-dependent and erodes trust.
 */
export function computeMeta(variables) {
  const qubitCount = variables.length;
  let decisionCount = 0, ancillaCount = 0;
  for (const v of variables) {
    if (v.kind === 'ancilla') ancillaCount++; else decisionCount++;
  }
  return {
    qubitCount: qubitCount,
    decisionCount: decisionCount,
    ancillaCount: ancillaCount,
    /* 16 * 2^n. Math.pow keeps this exact well past any n we would ever show. */
    memoryBytes: BYTES_PER_AMPLITUDE * Math.pow(2, qubitCount)
  };
}

/**
 * Build the canonical model. `meta` is always recomputed from `variables` — it
 * is derived state and callers must not hand-author it.
 *
 * @param {object} spec {problemType, variables, Q, offset, penalty, meta?}
 * @returns {object} the model described at the top of this file
 */
export function createModel(spec) {
  const variables = spec.variables || [];
  const model = {
    schemaVersion: SCHEMA_VERSION,
    problemType: spec.problemType,
    convention: 'QUBO',
    variables: variables,
    Q: spec.Q || zeroMatrix(variables.length),
    offset: spec.offset || 0,
    penalty: spec.penalty || { lambda: 0, source: 'lucas_bound', bound: 0 },
    meta: computeMeta(variables)
  };
  /* Anything a template wants to keep for re-editing (the item table, the edge
     list) rides along here and is saved with the model. */
  if (spec.source) model.source = spec.source;
  return model;
}

/** True when the instance is small enough to simulate / brute force / verify. */
export function withinCap(model) {
  return model.meta.qubitCount <= QUBIT_CAP;
}

/**
 * Where an instance sits relative to the soft line. One function so the banner,
 * the size readout, verify.js, analysis.js and codegen.js cannot disagree about
 * what "over the cap" means.
 *   'ok'   — everything runs
 *   'warn' — still runs, but the next couple of variables will switch things off
 *   'over' — build + codegen only; no simulation, verification or landscape
 */
export function capLevel(qubitCount) {
  if (qubitCount > QUBIT_CAP) return 'over';
  if (qubitCount >= QUBIT_WARN) return 'warn';
  return 'ok';
}

/* ------------------------------------------------------------------- energy */

/**
 * THE energy function. verify.js, analysis.js and the cost vector all route
 * through this (or through costVector, which is this unrolled) so there is
 * exactly one definition in the tool.
 *
 * @param {number[][]} Q upper-triangular
 * @param {number} offset
 * @param {ArrayLike<number>} bits y_k in {0,1}, length n
 */
export function energyFromQ(Q, offset, bits) {
  const n = bits.length;
  let e = offset;
  for (let k = 0; k < n; k++) {
    if (!bits[k]) continue;
    e += Q[k][k];
    for (let l = k + 1; l < n; l++) if (bits[l]) e += Q[k][l];
  }
  return e;
}

/** energyFromQ against a model. */
export function energy(model, bits) {
  return energyFromQ(model.Q, model.offset, bits);
}

/* -------------------------------------------------------- bitstring indexing */

/** bits[k] = (z >> (n-1-k)) & 1 — variable 0 is the most significant bit. */
export function bitsFromIndex(z, n) {
  const bits = new Uint8Array(n);
  for (let k = 0; k < n; k++) bits[k] = (z >>> (n - 1 - k)) & 1;
  return bits;
}

/** Inverse of bitsFromIndex. */
export function indexFromBits(bits) {
  const n = bits.length;
  let z = 0;
  for (let k = 0; k < n; k++) if (bits[k]) z += Math.pow(2, n - 1 - k);
  return z;
}

/** "0110" for display / codegen comparison, same ordering as above. */
export function bitsToString(bits) {
  let s = '';
  for (let k = 0; k < bits.length; k++) s += bits[k] ? '1' : '0';
  return s;
}

/**
 * E(z) for every bitstring, as a dense Float64Array of length 2^n — the diagonal
 * cost vector the QAOA phase separator acts on, and the input to brute force.
 * Capped: this is the one allocation that can take the tab down.
 *
 * Built incrementally: each z differs from a smaller index by one set bit, so
 * the cost is O(n * 2^n) rather than O(n^2 * 2^n).
 */
export function costVector(model) {
  const n = model.meta.qubitCount;
  if (n > QUBIT_CAP) {
    throw new RangeError('costVector refused: ' + n + ' qubits is above the ' + QUBIT_CAP + '-qubit cap.');
  }
  const Q = model.Q;
  const size = Math.pow(2, n);
  const out = new Float64Array(size);
  out[0] = model.offset;
  for (let z = 1; z < size; z++) {
    /* lowest set bit of z -> the variable it belongs to */
    const low = z & -z;
    const bitPos = Math.round(Math.log2(low));      // 0 = last variable
    const k = n - 1 - bitPos;
    const rest = z ^ low;
    let e = out[rest] + Q[k][k];
    /* interactions between k and the variables already set in `rest` */
    let r = rest;
    while (r) {
      const lowR = r & -r;
      const l = n - 1 - Math.round(Math.log2(lowR));
      e += k < l ? Q[k][l] : Q[l][k];
      r ^= lowR;
    }
    out[z] = e;
  }
  return out;
}

/* --------------------------------------------------------- indexed families --
   From Phase 3 onwards a template does not name its variables one at a time: it
   declares a family like x[vertex, colour] and gets |V| * n of them, in a fixed
   order, with a way to find any one of them again.

   Mixed-radix, last axis fastest — so a (vertex, colour) family runs
   v0c0, v0c1, ... v0cn, v1c0, ... That keeps each vertex's colours contiguous,
   which is what makes the one-hot groups and the matrix picture readable.
                                                                              */

/**
 * @param {Array<{key:string, labels:string[]}>} axes
 * @returns {{axes, sizes:number[], total:number,
 *            entries:Array<{position:number, coords:object, labels:object}>,
 *            at:(coords:object|number[]) => number}}
 */
export function indexFamily(axes) {
  const sizes = axes.map((a) => a.labels.length);
  const total = sizes.reduce((a, b) => a * b, 1);

  /* strides for mixed-radix addressing, last axis fastest */
  const strides = new Array(axes.length).fill(1);
  for (let i = axes.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * sizes[i + 1];

  const entries = [];
  for (let position = 0; position < total; position++) {
    const coords = {}, labels = {};
    for (let a = 0; a < axes.length; a++) {
      const i = Math.floor(position / strides[a]) % sizes[a];
      coords[axes[a].key] = i;
      labels[axes[a].key] = axes[a].labels[i];
    }
    entries.push({ position, coords, labels });
  }

  function at(coords) {
    let position = 0;
    for (let a = 0; a < axes.length; a++) {
      const i = Array.isArray(coords) ? coords[a] : coords[axes[a].key];
      if (!Number.isInteger(i) || i < 0 || i >= sizes[a]) {
        throw new RangeError('Index ' + i + ' is outside axis "' + axes[a].key + '" (0..' + (sizes[a] - 1) + ').');
      }
      position += i * strides[a];
    }
    return position;
  }

  return { axes, sizes, strides, total, entries, at };
}

/**
 * Every group of variables that differ only along `axisKey` — one group per
 * combination of the other axes. For x[vertex, colour] along 'colour' that is
 * exactly "the colours available to vertex v", one group per vertex, which is
 * what an "exactly one" constraint gets applied to.
 *
 * @returns {Array<{members:number[], labels:object, kind:string}>}
 */
export function groupsAlong(family, axisKey) {
  const axisPos = family.axes.findIndex((a) => a.key === axisKey);
  if (axisPos < 0) throw new RangeError('No axis "' + axisKey + '" in this family.');
  const groups = new Map();

  for (const e of family.entries) {
    /* a group is identified by every coordinate EXCEPT the one being varied */
    const key = family.axes.map((a, i) => (i === axisPos ? '*' : e.coords[a.key])).join('|');
    if (!groups.has(key)) {
      const labels = {};
      for (const a of family.axes) if (a.key !== axisKey) labels[a.key] = e.labels[a.key];
      groups.set(key, { members: [], labels, kind: 'exactly_one' });
    }
    groups.get(key).members.push(e.position);
  }
  return [...groups.values()];
}

/**
 * Adds the "exactly one of these is on" penalty  A * (1 - sum_k y_k)^2  to Q.
 *
 * Expanding, and using y^2 = y for bits:
 *     (1 - sum y)^2 = 1 - sum_k y_k + 2 * sum_{k<l} y_k y_l
 * so each member takes -A on the diagonal, each pair takes +2A, and the leading
 * 1 becomes a constant.
 *
 * @returns {number} the constant this contributes — the CALLER must add it to
 *   the model's offset. Returning it rather than hiding it is deliberate: a
 *   dropped offset is the bug this whole tool is built to avoid.
 */
export function addExactlyOne(Q, members, A) {
  for (const k of members) addLinear(Q, k, -A);
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) addQuadratic(Q, members[a], members[b], 2 * A);
  }
  return A;
}

/* ---------------------------------------------------------- integer encoding */

/**
 * Appendix A — bounded integer -> binary, the "log trick" (Lucas §2.4).
 * Coefficients for representing every integer in [0, N] exactly once-coverable,
 * with the minimum number of bits.
 *   encodeRange(5) -> [1,2,2]   encodeRange(7) -> [1,2,4]
 */
export function encodeRange(N) {
  if (!(N > 0)) return [];
  const k = Math.floor(Math.log2(N));
  const c = [];
  for (let i = 0; i < k; i++) c.push(Math.pow(2, i));
  const last = N - (Math.pow(2, k) - 1);
  if (last > 0) c.push(last);
  return c;
}

/* -------------------------------------------------------------- QUBO -> Ising */

/**
 * Appendix C. Substitution x_i = (1 + s_i)/2, i.e. s_i = 2x_i - 1, so x=1 <-> s=+1.
 *
 *   J_ij    = Q_ij / 4                              (i < j)
 *   h_i     = Q_ii / 2 + (1/4) * sum_{j != i} Q_ij
 *   offset' = c + sum_i Q_ii/2 + sum_{i<j} Q_ij/4
 *
 * Sign convention: E = sum_i h_i s_i + sum_{i<j} J_ij s_i s_j + offset. No
 * leading minus. This convention is used everywhere in the tool, and these
 * numbers are exactly the coefficients PennyLane wants on Z_i and Z_i Z_j.
 *
 * @returns {{h:number[], J:Array<{i:number,j:number,value:number}>, offset:number, n:number}}
 */
export function quboToIsing(model) {
  const n = model.meta.qubitCount;
  const Q = model.Q;
  const h = new Array(n).fill(0);
  const J = [];
  let offset = model.offset;

  for (let i = 0; i < n; i++) {
    h[i] += Q[i][i] / 2;
    offset += Q[i][i] / 2;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const q = Q[i][j];
      if (q === 0) continue;
      J.push({ i: i, j: j, value: q / 4 });
      h[i] += q / 4;
      h[j] += q / 4;
      offset += q / 4;
    }
  }
  return { h: h, J: J, offset: offset, n: n };
}

/** E(s) in the convention documented on quboToIsing. */
export function isingEnergy(ising, spins) {
  let e = ising.offset;
  for (let i = 0; i < ising.h.length; i++) e += ising.h[i] * spins[i];
  for (const t of ising.J) e += t.value * spins[t.i] * spins[t.j];
  return e;
}

/** bits {0,1} -> spins {-1,+1}, per s = 2x - 1. */
export function bitsToSpins(bits) {
  const s = new Int8Array(bits.length);
  for (let k = 0; k < bits.length; k++) s[k] = bits[k] ? 1 : -1;
  return s;
}

/** spins {-1,+1} -> bits {0,1}. */
export function spinsToBits(spins) {
  const b = new Uint8Array(spins.length);
  for (let k = 0; k < spins.length; k++) b[k] = spins[k] > 0 ? 1 : 0;
  return b;
}

/* -------------------------------------------------------------- presentation */

/** "1.2 MB" / "16 GB" — for the memory readout next to the qubit count. */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const digits = v < 10 && i > 0 ? 1 : 0;
  return v.toFixed(digits) + ' ' + units[i];
}
