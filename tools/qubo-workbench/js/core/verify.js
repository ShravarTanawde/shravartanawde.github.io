/* ============================================================================
   verify.js — does this QUBO actually encode the problem?

   Three layers, deliberately separate, because they are trustworthy in
   different ways and at different sizes:

     1. STRUCTURAL  — cheap invariants, run at ANY size. No solving. These are
                      the only checks that exist above the cap, so they carry the
                      whole weight there and are run unconditionally.
     2. PENALTY     — is lambda at or above the closed-form safe bound? Also runs
                      at any size. This is the correctness story for instances
                      nothing can brute-force: the bound is a proof, not a guess.
     3. BRUTE FORCE — under the cap only. Enumerate all 2^n bitstrings, find the
                      ground state, and compare it with the true optimum computed
                      independently in the PROBLEM's own space. This is the only
                      layer that can say "yes, this is right" rather than "nothing
                      looks wrong".

   Layer 3 is the strongest and the least available. Layers 1 and 2 are what the
   over-cap output stands on, which is why neither is ever skipped.
   ============================================================================ */

import {
  QUBIT_CAP, capLevel, checkMatrixShape, costVector, energy, bitsFromIndex, bitsToString, pairCoeff,
  quboToIsing, isingEnergy, bitsToSpins
} from './qubo.js?v=1';
import { problemFor } from './problems.js?v=1';

/* How many co-optimal states to keep for display. Degeneracy is normal — the
   slack encoding alone can represent the same number two ways — so the count
   matters more than the list. */
const MAX_GROUND_STATES = 64;

/* How many random assignments the reference-energy check uses when the instance
   is too large to enumerate. Deterministic, so a failure is reproducible. */
const REFERENCE_SAMPLES = 300;

/** A deterministic pseudo-random bitstring — seeded by its own index. */
function sampleBits(n, seed) {
  const bits = new Uint8Array(n);
  let s = (seed * 2654435761 + 1) >>> 0;
  for (let k = 0; k < n; k++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    bits[k] = (s >>> 16) & 1;
  }
  return bits;
}

/** Whether this model's template supplies an optional hook. */
function problemHas(model, hook) {
  try { return typeof problemFor(model)[hook] === 'function'; }
  catch (e) { return false; }
}

/* Relative tolerance for "same energy". Coefficients here are sums of products
   of user-supplied numbers, so two genuinely equal energies can differ in the
   last bit or two of a double. */
function energyTolerance(magnitude) {
  return 1e-9 * Math.max(1, Math.abs(magnitude));
}

/* ------------------------------------------------------------- 1. structural */

/**
 * Cheap invariants. Returns a list of {level, label, detail}, passes included —
 * the panel shows the ticks as well as the crosses, because "nine things were
 * checked" is the reassuring part.
 *   level: 'ok' | 'warn' | 'error'
 */
export function structuralChecks(model) {
  const out = [];
  const n = model.meta.qubitCount;
  const add = (level, label, detail) => out.push({ level, label, detail: detail || '' });

  /* --- the matrix is the shape the rest of the tool assumes --- */
  const shape = checkMatrixShape(model.Q, n);
  if (shape.length) add('error', 'Q is upper-triangular and well-formed', shape.slice(0, 3).join(' '));
  else add('ok', 'Q is upper-triangular and well-formed', n + '×' + n + ', diagonal carries the linear terms');

  /* --- no orphan variables ---
     A variable with no coefficient anywhere is free: it does not change the
     energy, so it doubles the ground-state degeneracy and buys nothing. It
     almost always means a term was dropped while building. */
  const orphans = [];
  for (let k = 0; k < n; k++) {
    if (model.Q[k][k] !== 0) continue;
    let touched = false;
    for (let l = 0; l < n && !touched; l++) if (l !== k && pairCoeff(model.Q, k, l) !== 0) touched = true;
    if (!touched) orphans.push(model.variables[k] ? model.variables[k].sym : String(k));
  }
  if (orphans.length) {
    add('error', 'Every variable appears in the energy',
      orphans.slice(0, 6).join(', ') + (orphans.length > 6 ? ' and ' + (orphans.length - 6) + ' more' : '') +
      ' appear nowhere — they cannot change the energy.');
  } else {
    add('ok', 'Every variable appears in the energy', 'no free variables');
  }

  /* --- the ancilla count matches the encoding formula --- */
  const problem = problemFor(model);
  if (problem.qubits && model.source) {
    const expected = problem.qubits(model.source);
    if (expected !== n) {
      add('error', 'Qubit count matches the encoding formula',
        'built ' + n + ', the formula for this instance says ' + expected + '.');
    } else {
      add('ok', 'Qubit count matches the encoding formula',
        model.meta.decisionCount + ' decision + ' + model.meta.ancillaCount + ' ancilla = ' + n);
    }
  }

  /* --- Q reproduces the Hamiltonian as written ---
     The most error-prone step in any of these templates is expanding a square
     into linear and quadratic parts. A template can supply referenceEnergy(),
     which recomputes E(y) straight from the problem data without ever touching
     Q; if the two disagree on any bitstring, the expansion is wrong.

     Exhaustive on small instances, and a deterministic random sample otherwise —
     so this is one of the few real correctness checks that still runs ABOVE the
     cap, where nothing can be brute-forced. */
  if (problemHas(model, 'referenceEnergy')) {
    const ref = problemFor(model).referenceEnergy;
    const exhaustive = n <= 14;
    const total = exhaustive ? Math.pow(2, n) : REFERENCE_SAMPLES;
    let worst = 0, worstAt = null;
    for (let t = 0; t < total; t++) {
      const bits = exhaustive ? bitsFromIndex(t, n) : sampleBits(n, t);
      const diff = Math.abs(energy(model, bits) - ref(model, bits));
      if (diff > worst) { worst = diff; worstAt = bitsToString(bits); }
    }
    if (worst > 1e-9) {
      add('error', 'Q matches the Hamiltonian as written',
        'they differ by ' + worst + ' at ' + worstAt + ' — the expansion into Q is wrong.');
    } else {
      add('ok', 'Q matches the Hamiltonian as written',
        exhaustive ? 'checked on all ' + total + ' assignments' : 'checked on ' + total + ' sampled assignments');
    }
  }

  /* --- one-hot groups, when a template declares them (Phase 3 onwards) --- */
  if (Array.isArray(model.groups) && model.groups.length) {
    const problems = [];
    const claimed = new Map();
    for (const g of model.groups) {
      if (!Array.isArray(g.members) || !g.members.length) { problems.push('an empty group'); continue; }
      if (g.members.some((k) => !Number.isInteger(k) || k < 0 || k >= n)) { problems.push('a group naming a variable that does not exist'); continue; }
      if (new Set(g.members).size !== g.members.length) { problems.push('a group naming the same variable twice'); continue; }
      /* Two "exactly one" groups sharing a variable would be two constraints
         fighting over it — always a mistake in these templates. */
      for (const k of g.members) {
        if (claimed.has(k)) problems.push('variable ' + k + ' is in two groups at once');
        claimed.set(k, g);
      }
    }
    if (problems.length) {
      add('error', 'One-hot groups are well-formed', [...new Set(problems)].slice(0, 3).join('; ') + '.');
    } else {
      add('ok', 'One-hot groups are well-formed',
        model.groups.length + ' group(s) covering ' + claimed.size + ' of ' + n + ' variables, none shared');
    }
  }

  /* --- integrality ---
     Never rounded, only reported. A non-integer coefficient is legitimate (a
     value can be 2.5) but it is worth knowing about: it rules out some exact
     integer reasoning, and it usually means the input was not what was meant. */
  let fractional = 0;
  for (let k = 0; k < n; k++) {
    for (let l = k; l < n; l++) if (!Number.isInteger(model.Q[k][l])) fractional++;
  }
  if (!Number.isInteger(model.offset)) fractional++;
  if (fractional) {
    add('warn', 'Coefficients are whole numbers',
      fractional + ' coefficient(s) are fractional. Nothing has been rounded — they are used exactly as they are.');
  } else {
    add('ok', 'Coefficients are whole numbers', 'exact integer arithmetic throughout');
  }

  /* --- the offset is carried ---
     Cheap to check and catastrophic to miss: a dropped offset shifts every
     energy, so the browser and the emitted program would disagree by a constant. */
  if (typeof model.offset !== 'number' || !Number.isFinite(model.offset)) {
    add('error', 'The constant offset is present', 'offset is ' + model.offset);
  } else {
    add('ok', 'The constant offset is present', 'offset = ' + model.offset);
  }

  return out;
}

/* ---------------------------------------------------------------- 2. penalty */

/**
 * Is the penalty provably large enough? The bounds in Appendix B are strict
 * inequalities, so landing exactly on one is not safe.
 */
export function penaltyCheck(model) {
  const p = model.penalty;
  const problem = problemFor(model);
  /* Most of the Appendix B bounds are strict (A > B); graph partitioning's is
     inclusive (A/B >= ...). A template says which it has, and the default is the
     conservative one. */
  const strict = problem.boundStrict !== false;
  const adequate = strict ? p.lambda > p.bound : p.lambda >= p.bound;
  return {
    lambda: p.lambda,
    bound: p.bound,
    source: p.source,
    boundText: problem.boundText || '',
    adequate: adequate,
    level: adequate ? 'ok' : 'error',
    message: adequate
      ? (p.source === 'user_override'
        ? 'λ = ' + p.lambda + ' was set by hand and is above the safe bound of ' + p.bound + '.'
        : 'λ = ' + p.lambda + ' comes from the closed-form bound (' + problem.boundText + ' = ' + p.bound + ').')
      : 'λ = ' + p.lambda + ' is ' + (strict ? 'not above' : 'below') + ' the safe bound of ' + p.bound + ' (' + problem.boundText +
        '). Nothing guarantees the ground state respects the constraints — treat any result as unsound.'
  };
}

/* ------------------------------------------------------------ 3. brute force */

/**
 * Enumerate every bitstring. Under the cap only — refuse loudly rather than
 * freeze the tab.
 * @returns {{groundEnergy:number, degeneracy:number, states:Array, sampleCapped:boolean}}
 */
export function bruteForce(model) {
  const n = model.meta.qubitCount;
  if (n > QUBIT_CAP) {
    throw new RangeError('Brute force refused: ' + n + ' qubits is above the ' + QUBIT_CAP + '-qubit cap.');
  }
  const costs = costVector(model);
  let min = Infinity;
  for (let z = 0; z < costs.length; z++) if (costs[z] < min) min = costs[z];

  const tol = energyTolerance(min);
  const states = [];
  let degeneracy = 0;
  for (let z = 0; z < costs.length; z++) {
    if (costs[z] > min + tol) continue;
    degeneracy++;
    if (states.length < MAX_GROUND_STATES) states.push(z);
  }
  return {
    groundEnergy: min,
    degeneracy: degeneracy,
    states: states,
    sampleCapped: degeneracy > states.length,
    costs: costs
  };
}

/* ------------------------------------------------------------- Ising bridge */

/**
 * Step 2 shows the same energy rewritten over spins. That rewrite is pure
 * algebra, so it either holds everywhere or it is wrong — and a wrong one would
 * be invisible, shifting every energy by a constant and leaving the generated
 * code disagreeing with the browser.
 *
 * So it is checked rather than asserted: exhaustively when the instance is
 * small, on a deterministic sample when it is not. Like the reference-energy
 * check, this one still works above the cap.
 *
 * @returns {{level:string, label:string, detail:string, worst:number, checked:number}}
 */
export function isingCheck(model, ising) {
  const n = model.meta.qubitCount;
  const I = ising || quboToIsing(model);
  const exhaustive = n <= 14;
  const checked = exhaustive ? Math.pow(2, n) : REFERENCE_SAMPLES;

  let worst = 0, worstAt = null;
  for (let t = 0; t < checked; t++) {
    const bits = exhaustive ? bitsFromIndex(t, n) : sampleBits(n, t);
    const diff = Math.abs(isingEnergy(I, bitsToSpins(bits)) - energy(model, bits));
    if (diff > worst) { worst = diff; worstAt = bitsToString(bits); }
  }

  return worst > 1e-9
    ? {
      level: 'error', worst, checked,
      label: 'Spin energies reproduce the QUBO exactly',
      detail: 'they differ by ' + worst + ' at ' + worstAt + ' — the conversion has lost something, most likely the offset.'
    }
    : {
      level: 'ok', worst, checked,
      label: 'Spin energies reproduce the QUBO exactly',
      detail: (exhaustive ? 'checked on all ' + checked + ' assignments' : 'checked on ' + checked + ' sampled assignments') +
        ', offset included'
    };
}

/* ---------------------------------------------------------------- the verdict */

/**
 * Everything the verdict panel needs.
 *
 * `verdict` is one of:
 *   'verified'    brute force confirms the ground state is the true optimum
 *   'broken'      brute force says it is NOT — the formulation is wrong here
 *   'unverified'  above the cap: structure and the penalty bound are all we have
 *   'unsound'     a structural error, or a penalty below the bound
 */
export function verify(model) {
  const n = model.meta.qubitCount;
  const structural = structuralChecks(model);
  const penalty = penaltyCheck(model);
  const hasStructuralError = structural.some((c) => c.level === 'error');

  const result = {
    qubitCount: n,
    capLevel: capLevel(n),
    structural: structural,
    penalty: penalty,
    bruteForce: null,
    verdict: 'unverified',
    headline: '',
    detail: ''
  };

  if (hasStructuralError) {
    result.verdict = 'unsound';
    result.headline = 'The build is structurally wrong';
    result.detail = 'A structural check failed, so nothing downstream can be trusted. This is a bug in the template, not in your input.';
    return result;
  }

  if (n > QUBIT_CAP) {
    result.verdict = penalty.adequate ? 'unverified' : 'unsound';
    result.headline = penalty.adequate
      ? 'Sound by construction, not checked by search'
      : 'Below the safe penalty bound, and too large to check';
    result.detail = penalty.adequate
      ? 'At ' + n + ' qubits there are ' + '2^' + n + ' assignments — far too many to enumerate here. ' +
        'The structural checks passed and λ is above the closed-form bound, which is what makes this ' +
        'formulation correct by construction. Generate the code and run it elsewhere.'
      : penalty.message;
    return result;
  }

  /* --- under the cap: the real check --- */
  const problem = problemFor(model);
  const bf = bruteForce(model);
  const truth = problem.optimum(model);

  const decoded = bf.states.map((z) => {
    const bits = bitsFromIndex(z, n);
    const d = problem.decode(model, bits);
    return { index: z, bits: bitsToString(bits), decoded: d };
  });

  /* Every co-optimal state we looked at has to be a feasible, optimal answer.
     Degeneracy is normal here — the slack encoding alone can spell the same
     number two ways — so what matters is that they all decode to the truth. */
  const anyInfeasible = decoded.some((s) => !s.decoded.feasible);
  const sameObjective = decoded.every((s) => Math.abs(s.decoded.objective - truth.objective) <= energyTolerance(truth.objective));
  const recovers = !anyInfeasible && sameObjective;

  result.bruteForce = {
    groundEnergy: bf.groundEnergy,
    degeneracy: bf.degeneracy,
    sampleCapped: bf.sampleCapped,
    states: decoded,
    truth: truth,
    recovers: recovers,
    anyInfeasible: anyInfeasible,
    costs: bf.costs
  };

  if (problem.feasibilityProblem && truth.objective > 0) {
    /* Nothing was being optimised — the question was whether a solution exists,
       and it does not. The formulation is still the right one: the
       reference-energy check above is what says so, and the ground state's
       energy is exactly the smallest number of violations any assignment can
       manage. Calling this "broken" would blame the tool for the instance. */
    result.verdict = 'no_solution';
    result.headline = 'No solution exists for this instance';
    result.detail = truth.detail.charAt(0).toUpperCase() + truth.detail.slice(1) +
      '. The formulation is sound — the checks above confirm Q is the Hamiltonian as written — ' +
      'so the lowest energy it can reach, ' + formatNum(bf.groundEnergy) +
      ', is the tool telling you the answer is no.' +
      (penalty.adequate ? '' : ' Note that λ is also below the safe bound.');
  } else if (recovers && penalty.adequate) {
    result.verdict = 'verified';
    result.headline = 'Recovers the true optimum';
    result.detail = 'The ground state of this QUBO is ' + truth.summary + ' (' + truth.detail +
      '), which an independent search over the problem itself confirms is optimal.' +
      (bf.degeneracy > 1
        ? ' ' + bf.degeneracy + ' assignments share that energy' +
          (bf.sampleCapped
            ? '; the ' + decoded.length + ' examined all decode to the same answer.'
            : '; they all decode to the same answer.')
        : '');
  } else if (recovers && !penalty.adequate) {
    /* The bound is sufficient, not necessary. A small lambda can still happen to
       work on a particular instance — but only by luck, and only here. */
    result.verdict = 'lucky';
    result.headline = 'Correct on this instance, but not guaranteed';
    result.detail = 'The ground state does recover ' + truth.summary + '. But λ = ' + penalty.lambda +
      ' is below the safe bound of ' + penalty.bound + ', so that is a property of this particular ' +
      'instance, not of the formulation. Change the numbers and it can silently stop being true.';
  } else {
    result.verdict = 'broken';
    result.headline = anyInfeasible
      ? 'The ground state breaks the constraints'
      : 'The ground state is not the true optimum';
    const g = decoded[0];
    result.detail = 'Lowest energy is ' + formatNum(bf.groundEnergy) + ', at ' + g.decoded.summary +
      ' — ' + g.decoded.parts.map((p) => p.k + ' ' + p.v).join(', ') + '. The true optimum is ' +
      truth.summary + ' (' + truth.detail + ').' +
      (penalty.adequate ? '' : ' λ = ' + penalty.lambda + ' is below the safe bound of ' + penalty.bound + ', which is why.');
  }
  return result;
}

function formatNum(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
