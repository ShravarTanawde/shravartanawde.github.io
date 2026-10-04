/* ============================================================================
   analysis.js: Step 3.  QAOA on this instance, simulated in the browser.

   EVERYTHING HERE IS GATED BEHIND THE QUBIT CAP. A dense statevector doubles
   with every qubit; above the cap nothing in this file is allowed to run, and
   the functions refuse rather than trying.

   The simulator is hand-written, per Appendix D:

       psi_0 = |+>^n                                (uniform superposition)
       per layer:  psi <- mixer(beta) . [ exp(-i*gamma*C) (*) psi ]
       F(params)  = sum_z |psi_z|^2 C[z]

   The phase separator is elementwise on the diagonal cost vector; no matrix is
   ever built. The mixer is a per-qubit Rx: mixer(beta) = prod_i (cos b I - i sin b X),
   which is Rx(2*beta) on each qubit, applied in place by walking bit-partner pairs.

   C[z] is the model's own energy INCLUDING the offset. A constant offset is a
   global phase in the separator, so it changes nothing about the state, but it
   does shift F, which is exactly what makes the number here comparable with the
   number the generated code prints.

   Bit ordering is qubo.js's: variable 0 is the most significant bit, which is
   what PennyLane's qml.probs(wires=range(n)) uses. No reversal anywhere.
   ============================================================================ */

import { QUBIT_CAP, costVector, quboToIsing } from './qubo.js?v=1';

/*
   A second, softer line, and it is about DEPTH, not size.

   At p=1 everything here runs through the closed form below, which never touches
   the statevector, so it is instant right up to the 20-qubit cap. At p>1 there is
   no closed form: every evaluation costs a full statevector pass, and that
   doubles with each qubit. Past this many qubits the tool therefore computes the
   deeper-p curve only when asked, rather than freezing the tab to produce
   something nobody requested.

   This is a structural fact about 2^n, not a guess about the visitor's machine,
   so it is a threshold and never a predicted runtime.
*/
export const DEEP_P_LIMIT = 14;

/* ------------------------------------------------------------------- seeds -- */

/** mulberry32: small, fast, and identical every run for a given seed. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------- simulator -- */

/**
 * Everything Step 3 needs, precomputed once per model.
 * @throws {RangeError} above the cap; the caller must check first.
 */
export function makeSimulator(model) {
  const n = model.meta.qubitCount;
  if (n > QUBIT_CAP) {
    throw new RangeError('Simulation refused: ' + n + ' qubits is above the ' + QUBIT_CAP + '-qubit cap.');
  }
  const costs = costVector(model);          // already cap-guarded, offset included
  const size = costs.length;

  let emin = Infinity, emax = -Infinity;
  for (let z = 0; z < size; z++) {
    if (costs[z] < emin) emin = costs[z];
    if (costs[z] > emax) emax = costs[z];
  }
  const tol = 1e-9 * Math.max(1, Math.abs(emin));
  const ground = [];
  for (let z = 0; z < size; z++) if (costs[z] <= emin + tol) ground.push(z);

  /* scratch buffers, reused by every evaluation so a 4096-point sweep does not
     allocate 4096 statevectors */
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  const amp0 = 1 / Math.sqrt(size);

  /** Run the circuit for `params` = [g0..g_{p-1}, b0..b_{p-1}]; leaves re/im set. */
  function run(params) {
    const p = params.length >> 1;
    re.fill(amp0);
    im.fill(0);
    for (let layer = 0; layer < p; layer++) {
      phaseSeparator(params[layer]);
      mixer(params[p + layer]);
    }
  }

  function phaseSeparator(gamma) {
    for (let z = 0; z < size; z++) {
      const theta = gamma * costs[z];
      const c = Math.cos(theta), s = Math.sin(theta);
      const a = re[z], b = im[z];
      /* (a + bi) * (cos - i sin) */
      re[z] = a * c + b * s;
      im[z] = b * c - a * s;
    }
  }

  /* (cos b I - i sin b X) on each qubit, in place, over bit-partner pairs. */
  function mixer(beta) {
    const c = Math.cos(beta), s = Math.sin(beta);
    for (let k = 0; k < n; k++) {
      const bit = 1 << (n - 1 - k);           // variable 0 is the MSB
      for (let z = 0; z < size; z++) {
        if (z & bit) continue;                // visit each pair once, from the 0 side
        const w = z | bit;
        const r0 = re[z], i0 = im[z], r1 = re[w], i1 = im[w];
        re[z] = c * r0 + s * i1;
        im[z] = c * i0 - s * r1;
        re[w] = c * r1 + s * i0;
        im[w] = c * i1 - s * r0;
      }
    }
  }

  /** <C> for these parameters. */
  function expectation(params) {
    run(params);
    let f = 0;
    for (let z = 0; z < size; z++) f += (re[z] * re[z] + im[z] * im[z]) * costs[z];
    return f;
  }

  /** The full output distribution for these parameters. */
  function probabilities(params) {
    run(params);
    const out = new Float64Array(size);
    for (let z = 0; z < size; z++) out[z] = re[z] * re[z] + im[z] * im[z];
    return out;
  }

  /**
   * Central finite differences. The cost Hamiltonian has arbitrary eigenvalues,
   * so the parameter-shift rule does not apply to gamma; differences are the
   * honest choice on a simulator and are exact to well past display precision.
   */
  function gradient(params, h = 1e-5) {
    const g = new Float64Array(params.length);
    const work = Float64Array.from(params);
    for (let i = 0; i < params.length; i++) {
      const keep = work[i];
      work[i] = keep + h; const up = expectation(work);
      work[i] = keep - h; const down = expectation(work);
      work[i] = keep;
      g[i] = (up - down) / (2 * h);
    }
    return g;
  }

  /**
   * How far along the road from the worst assignment to the best this state is.
   *   1.0 = the ground state exactly, 0.0 = the worst assignment.
   * Stated this way because it is well defined whatever the sign or offset of
   * the energies, which the textbook <C>/C_max is not, once a QUBO carries a
   * constant term. The UI says this in words rather than printing a bare number.
   */
  function ratio(f) {
    const span = emax - emin;
    return span <= 0 ? 1 : (emax - f) / span;
  }

  /** Total probability of landing on a true ground state. */
  function groundProbability(probs) {
    let total = 0;
    for (const z of ground) total += probs[z];
    return total;
  }

  return {
    n, size, costs, emin, emax, ground,
    expectation, probabilities, gradient, ratio, groundProbability
  };
}

/* -------------------------------------------------------------- optimizers --
   Four, from a common start, all dimension-independent so the comparison stays
   fair at any p. Each returns the same trace shape, so the chart does not need
   to know which produced it.                                                  */

const OPTIMIZER_LIST = ['gradient', 'adam', 'spsa', 'nelder-mead'];

export const OPTIMIZERS = {
  gradient: {
    id: 'gradient', label: 'Gradient descent',
    note: 'the plain one: step downhill, fixed step size'
  },
  adam: {
    id: 'adam', label: 'Adam',
    note: 'per-parameter step sizes from running gradient statistics'
  },
  spsa: {
    id: 'spsa', label: 'SPSA',
    note: 'gradient-free; two evaluations per step whatever the dimension, and noisy by design'
  },
  'nelder-mead': {
    id: 'nelder-mead', label: 'Nelder–Mead',
    note: 'gradient-free simplex search, the stand-in for a COBYLA-style method'
  }
};

export function optimizerIds() { return OPTIMIZER_LIST.slice(); }

/**
 * An objective the optimizers can drive. Two exist:
 *   simObjective      the statevector simulator; works at any depth
 *   analyticObjective the closed form; p=1 only, but thousands of times faster
 * They agree to floating-point noise, so which one runs is a speed decision and
 * never a correctness one.
 */
export function simObjective(sim) {
  return {
    evaluate: (x) => sim.expectation(x),
    gradient: (x) => sim.gradient(x),
    gradientCost: (x) => x.length * 2
  };
}

export function analyticObjective(model) {
  const a = analyticP1(model);
  return {
    evaluate: (x) => a.F(x[0], x[1]),
    gradient: (x) => Float64Array.from(a.grad(x[0], x[1])),
    gradientCost: () => 2
  };
}

/**
 * @param {object} objective  from simObjective() or analyticObjective()
 * @param {object} opts {method, p, init, iterations, seed, stepSize}
 * @returns {{method, trace:number[], best:number, bestParams:Float64Array,
 *            evaluations:number, params:Float64Array}}
 *   `trace[i]` is the BEST value seen up to iteration i. Best-so-far rather than
 *   current, so a noisy method (SPSA) is not flattered or punished by where its
 *   last jitter happened to land.
 */
export function optimize(objective, opts) {
  const method = opts.method || 'gradient';
  const p = opts.p || 1;
  const iterations = opts.iterations || 60;
  const rng = makeRng(opts.seed === undefined ? 7 : opts.seed);
  const params = Float64Array.from(opts.init || linearRamp(p));   // caller supplies a scaled start

  let evaluations = 0;
  const evaluate = (x) => { evaluations++; return objective.evaluate(x); };

  let best = evaluate(params);
  let bestParams = Float64Array.from(params);
  const trace = [best];

  const record = (value, at) => {
    if (value < best) { best = value; bestParams = Float64Array.from(at); }
    trace.push(best);
  };

  if (method === 'gradient' || method === 'adam') {
    const lr = opts.stepSize || (method === 'adam' ? 0.08 : 0.02);
    const m = new Float64Array(params.length), v = new Float64Array(params.length);
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    for (let step = 1; step <= iterations; step++) {
      const g = objective.gradient(params);
      evaluations += objective.gradientCost(params);
      for (let i = 0; i < params.length; i++) {
        if (method === 'adam') {
          m[i] = b1 * m[i] + (1 - b1) * g[i];
          v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
          const mh = m[i] / (1 - Math.pow(b1, step));
          const vh = v[i] / (1 - Math.pow(b2, step));
          params[i] -= lr * mh / (Math.sqrt(vh) + eps);
        } else {
          params[i] -= lr * g[i];
        }
      }
      record(evaluate(params), params);
    }
  } else if (method === 'spsa') {
    /* Spall's standard gain sequences. Two evaluations per step regardless of
       how many parameters there are, which is the whole point of the method. */
    const a = opts.stepSize || 0.25, c = 0.1, A = iterations * 0.1, alpha = 0.602, gamma = 0.101;
    const delta = new Float64Array(params.length);
    const plus = new Float64Array(params.length), minus = new Float64Array(params.length);
    for (let step = 1; step <= iterations; step++) {
      const ak = a / Math.pow(step + A, alpha);
      const ck = c / Math.pow(step, gamma);
      for (let i = 0; i < params.length; i++) {
        delta[i] = rng() < 0.5 ? -1 : 1;           // Rademacher
        plus[i] = params[i] + ck * delta[i];
        minus[i] = params[i] - ck * delta[i];
      }
      const fp = evaluate(plus), fm = evaluate(minus);
      const scale = (fp - fm) / (2 * ck);
      for (let i = 0; i < params.length; i++) params[i] -= ak * scale / delta[i];
      record(evaluate(params), params);
    }
  } else if (method === 'nelder-mead') {
    const d = params.length;
    /* a simplex around the common start, sized so it explores at the scale the
       parameters actually live on */
    const simplex = [Float64Array.from(params)];
    for (let i = 0; i < d; i++) {
      const point = Float64Array.from(params);
      point[i] += 0.35;
      simplex.push(point);
    }
    let values = simplex.map(evaluate);
    for (let step = 0; step < iterations; step++) {
      const order = values.map((v, i) => i).sort((x, y) => values[x] - values[y]);
      const sorted = order.map((i) => simplex[i]);
      const sortedValues = order.map((i) => values[i]);

      const centroid = new Float64Array(d);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) centroid[j] += sorted[i][j] / d;
      }
      const worst = sorted[d];
      const reflect = new Float64Array(d);
      for (let j = 0; j < d; j++) reflect[j] = centroid[j] + (centroid[j] - worst[j]);
      const fr = evaluate(reflect);

      if (fr < sortedValues[0]) {
        const expand = new Float64Array(d);
        for (let j = 0; j < d; j++) expand[j] = centroid[j] + 2 * (centroid[j] - worst[j]);
        const fe = evaluate(expand);
        sorted[d] = fe < fr ? expand : reflect;
        sortedValues[d] = Math.min(fe, fr);
      } else if (fr < sortedValues[d - 1]) {
        sorted[d] = reflect; sortedValues[d] = fr;
      } else {
        const contract = new Float64Array(d);
        for (let j = 0; j < d; j++) contract[j] = centroid[j] + 0.5 * (worst[j] - centroid[j]);
        const fc = evaluate(contract);
        if (fc < sortedValues[d]) { sorted[d] = contract; sortedValues[d] = fc; }
        else {
          for (let i = 1; i <= d; i++) {
            for (let j = 0; j < d; j++) sorted[i][j] = sorted[0][j] + 0.5 * (sorted[i][j] - sorted[0][j]);
            sortedValues[i] = evaluate(sorted[i]);
          }
        }
      }
      for (let i = 0; i <= d; i++) { simplex[i] = sorted[i]; values[i] = sortedValues[i]; }
      const bestIndex = values.indexOf(Math.min(...values));
      record(values[bestIndex], simplex[bestIndex]);
    }
  } else {
    throw new RangeError('Unknown optimizer "' + method + '".');
  }

  return { method, trace, best, bestParams, params, evaluations };
}

/**
 * The size of this instance's Ising coefficients.
 *
 * This matters more than it looks. gamma enters the circuit as exp(-i*gamma*C),
 * so what the phase separator actually does depends on gamma TIMES the energy
 * scale. A knapsack whose coefficients run to 80 and a graph problem whose
 * coefficients are 0.5 need gammas two orders of magnitude apart to be doing the
 * same thing. A fixed starting gamma is therefore not a neutral choice. It is a
 * good one for some instances and meaningless for others.
 */
export function coefficientScale(model) {
  const I = quboToIsing(model);
  const mags = [];
  for (const v of I.h) if (v !== 0) mags.push(Math.abs(v));
  for (const t of I.J) if (t.value !== 0) mags.push(Math.abs(t.value));
  if (!mags.length) return { rms: 1, max: 1, count: 0 };
  const rms = Math.sqrt(mags.reduce((a, b) => a + b * b, 0) / mags.length);
  return { rms: rms || 1, max: Math.max(...mags), count: mags.length };
}

/**
 * The linear-ramp start: gamma rises across the layers while beta falls, in
 * imitation of an annealing schedule. beta is a rotation angle and needs no
 * scaling; gamma is divided by the coefficient scale above, so the same start
 * means the same thing on every instance.
 */
export function linearRamp(p, gammaScale = 1, scale = 0.7) {
  const out = new Float64Array(2 * p);
  for (let k = 0; k < p; k++) {
    out[k] = (scale / gammaScale) * (k + 1) / p;     // gamma, rising
    out[p + k] = scale * (p - k) / p;                // beta, falling
  }
  return out;
}

/** The ramp for a specific model, with the scaling already applied. */
export function rampFor(model, p) {
  return linearRamp(p, coefficientScale(model).rms);
}

/**
 * A random start. gamma is drawn from one turn of the dominant phase term
 * rather than from [0, 2pi): on an instance with large coefficients the
 * landscape repeats many times inside [0, 2pi), so drawing from the whole range
 * would just be drawing noise.
 */
export function randomStart(p, seed, gammaScale = 1) {
  const rng = makeRng(seed);
  const out = new Float64Array(2 * p);
  for (let k = 0; k < p; k++) {
    out[k] = rng() * 2 * Math.PI / gammaScale;
    out[p + k] = rng() * Math.PI;
  }
  return out;
}

export function randomStartFor(model, p, seed) {
  return randomStart(p, seed, coefficientScale(model).rms);
}

/* ------------------------------------------------- the closed-form p=1 cost --
   A 64x64 landscape by simulation costs 4096 * (n+2) * 2^n operations, which is
   30 seconds at 16 qubits and hours at 20. At p=1 it does not have to be done
   that way: <C> has a closed form in gamma and beta.

   Writing the cost in the Ising form C = sum_a h_a Z_a + sum_{a<b} J_ab Z_a Z_b
   + offset, and pushing the mixer through (U_B^dag Z U_B = cos(2b) Z + sin(2b) Y),
   every expectation over the uniform state factorises:

     <Z_a>     = sin(2b) * sin(2g h_a) * prod_{c != a} cos(2g J_ac)

     <Z_a Z_b> = (1/2) sin(4b) * sin(2g J_ab)
                   * [ cos(2g h_b) prod_{c != a,b} cos(2g J_bc)
                     + cos(2g h_a) prod_{c != a,b} cos(2g J_ac) ]
               + (1/2) sin^2(2b)
                   * [ cos(2g(h_a - h_b)) prod_{c != a,b} cos(2g(J_ac - J_bc))
                     - cos(2g(h_a + h_b)) prod_{c != a,b} cos(2g(J_ac + J_bc)) ]

   Every gamma-dependent part collapses into three numbers, after which beta is
   free:

     F(g, b) = offset + sin(2b)*A1(g) + (1/2)sin(4b)*A2(g) + (1/2)sin^2(2b)*A3(g)

   so a whole landscape costs O(gammaSteps * n^3 + gammaSteps * betaSteps).

   This is an OPTIMISATION, not a second opinion: analytic_check.mjs pins it
   against the statevector simulator on random instances at random points, and
   the two agree to floating-point noise. If they ever stop agreeing, this is the
   half that is wrong.
                                                                              */

/**
 * @returns {{n, offset, coefficients(gamma):{A1,A2,A3}, F(gamma,beta):number,
 *            grad(gamma,beta):[number,number]}}
 */
export function analyticP1(model) {
  const I = quboToIsing(model);
  const n = I.n;
  const h = I.h;

  /* dense symmetric J, so the products below are simple loops */
  const J = [];
  for (let i = 0; i < n; i++) J.push(new Float64Array(n));
  for (const t of I.J) { J[t.i][t.j] = t.value; J[t.j][t.i] = t.value; }

  /* only pairs that actually couple contribute to the sums */
  const pairs = I.J.filter((t) => t.value !== 0).map((t) => [t.i, t.j]);

  function coefficients(g) {
    const twoG = 2 * g;

    /* <Z_a>, without the sin(2b) that multiplies all of them */
    let A1 = 0;
    for (let a = 0; a < n; a++) {
      if (h[a] === 0) continue;
      let prod = Math.sin(twoG * h[a]);
      for (let c = 0; c < n; c++) if (c !== a) prod *= Math.cos(twoG * J[a][c]);
      A1 += h[a] * prod;
    }

    let A2 = 0, A3 = 0;
    for (const [a, b] of pairs) {
      let Pa = 1, Pb = 1, Pminus = 1, Pplus = 1;
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        Pa *= Math.cos(twoG * J[a][c]);
        Pb *= Math.cos(twoG * J[b][c]);
        Pminus *= Math.cos(twoG * (J[a][c] - J[b][c]));
        Pplus *= Math.cos(twoG * (J[a][c] + J[b][c]));
      }
      const sJ = Math.sin(twoG * J[a][b]);
      const term1 = sJ * (Math.cos(twoG * h[b]) * Pb + Math.cos(twoG * h[a]) * Pa);
      const term2 = Math.cos(twoG * (h[a] - h[b])) * Pminus - Math.cos(twoG * (h[a] + h[b])) * Pplus;
      A2 += J[a][b] * term1;
      A3 += J[a][b] * term2;
    }
    return { A1, A2, A3 };
  }

  function combine(c, beta) {
    const s2 = Math.sin(2 * beta);
    return I.offset + s2 * c.A1 + 0.5 * Math.sin(4 * beta) * c.A2 + 0.5 * s2 * s2 * c.A3;
  }

  function F(gamma, beta) { return combine(coefficients(gamma), beta); }

  /* beta is analytic, gamma is a central difference on a function that is now
     cheap enough for that to cost nothing */
  function grad(gamma, beta, hh = 1e-6) {
    const c = coefficients(gamma);
    const s2 = Math.sin(2 * beta), c2 = Math.cos(2 * beta);
    const dBeta = 2 * c2 * c.A1 + 2 * Math.cos(4 * beta) * c.A2 + 2 * s2 * c2 * c.A3;
    const dGamma = (combine(coefficients(gamma + hh), beta) - combine(coefficients(gamma - hh), beta)) / (2 * hh);
    return [dGamma, dBeta];
  }

  return { n, offset: I.offset, coefficients, combine, F, grad, pairCount: pairs.length };
}

/* --------------------------------------------------------- the p=1 landscape --
   p=1 is the only depth at which a cost landscape is a SURFACE: two parameters,
   two axes, nothing projected away. At p>1 there is no honest 2D picture of it,
   so the tool does not draw one. That rule is enforced by this function only
   accepting p=1 at all.                                                       */

/**
 * How much of the gamma axis to show, and how finely.
 *
 * The fastest term in the landscape turns once every pi/maxCoeff in gamma. Over
 * the full [0, 2pi) an instance with large coefficients oscillates dozens of
 * times, and a 96-wide grid across it would not be a coarse picture; it would
 * be an ALIASED one, showing structure that is not there. So: sample at least
 * SAMPLES_PER_OSCILLATION per turn, and if the whole range cannot be resolved
 * within MAX_GAMMA_STEPS, show a window of it and say so.
 */
const SAMPLES_PER_OSCILLATION = 10;
const MAX_GAMMA_STEPS = 480;

export function gammaView(model, requested) {
  const { max } = coefficientScale(model);
  const full = 2 * Math.PI;
  const oscillations = Math.max(1, (full * max) / Math.PI);
  const wanted = Math.ceil(oscillations * SAMPLES_PER_OSCILLATION);

  if (wanted <= MAX_GAMMA_STEPS) {
    return { gammaMax: full, gammaSteps: Math.max(requested || 96, wanted), windowed: false, oscillations };
  }
  /* shrink the window until MAX_GAMMA_STEPS resolves it */
  const gammaMax = (MAX_GAMMA_STEPS / SAMPLES_PER_OSCILLATION) * Math.PI / max;
  return { gammaMax, gammaSteps: MAX_GAMMA_STEPS, windowed: true, oscillations };
}

export function landscapeP1(model, opts) {
  const view = gammaView(model, opts && opts.gammaSteps);
  const gammaSteps = view.gammaSteps;
  const betaSteps = (opts && opts.betaSteps) || 96;
  const gammaMax = view.gammaMax, betaMax = Math.PI;
  const a = analyticP1(model);

  const F = new Float64Array(gammaSteps * betaSteps);
  let best = Infinity, bestAt = null, worst = -Infinity;

  for (let gi = 0; gi < gammaSteps; gi++) {
    const gamma = (gi / (gammaSteps - 1)) * gammaMax;
    /* the expensive part happens once per gamma; beta is then free */
    const c = a.coefficients(gamma);
    for (let bi = 0; bi < betaSteps; bi++) {
      const beta = (bi / (betaSteps - 1)) * betaMax;
      const f = a.combine(c, beta);
      F[bi * gammaSteps + gi] = f;
      if (f < best) { best = f; bestAt = { gamma, beta, gi, bi }; }
      if (f > worst) worst = f;
    }
  }
  return {
    F, gammaSteps, betaSteps, gammaMax, betaMax, best, worst, bestAt,
    windowed: view.windowed, oscillations: view.oscillations
  };
}

/**
 * |grad F| over the same p=1 grid: the flatness diagnostic.
 *
 * This is a LOW-GRADIENT map, and that is all it is called. Demonstrating a
 * barren plateau would mean showing gradient variance shrinking as the system
 * grows, which this tool does not do; saying so would be a claim it has not
 * earned.
 */
export function gradientMapP1(model, opts) {
  const view = gammaView(model, opts && opts.gammaSteps);
  const gammaSteps = view.gammaSteps;
  const betaSteps = (opts && opts.betaSteps) || 96;
  const gammaMax = view.gammaMax, betaMax = Math.PI;
  const a = analyticP1(model);

  const G = new Float64Array(gammaSteps * betaSteps);
  let peak = 0, flattest = Infinity;
  let sum = 0, sumSq = 0;

  const step = 1e-6;
  for (let gi = 0; gi < gammaSteps; gi++) {
    const gamma = (gi / (gammaSteps - 1)) * gammaMax;
    /* three coefficient sets per gamma column, then every beta is arithmetic */
    const c = a.coefficients(gamma);
    const cUp = a.coefficients(gamma + step);
    const cDown = a.coefficients(gamma - step);
    for (let bi = 0; bi < betaSteps; bi++) {
      const beta = (bi / (betaSteps - 1)) * betaMax;
      const s2 = Math.sin(2 * beta), c2 = Math.cos(2 * beta);
      const dBeta = 2 * c2 * c.A1 + 2 * Math.cos(4 * beta) * c.A2 + 2 * s2 * c2 * c.A3;
      const dGamma = (a.combine(cUp, beta) - a.combine(cDown, beta)) / (2 * step);
      const mag = Math.hypot(dGamma, dBeta);
      G[bi * gammaSteps + gi] = mag;
      if (mag > peak) peak = mag;
      if (mag < flattest) flattest = mag;
      sum += mag; sumSq += mag * mag;
    }
  }
  const count = gammaSteps * betaSteps;
  const mean = sum / count;
  return {
    G, gammaSteps, betaSteps, gammaMax, betaMax, peak, flattest, windowed: view.windowed,
    mean, variance: Math.max(0, sumSq / count - mean * mean),
    /* what share of the landscape is essentially flat relative to its own peak */
    flatFraction: peak > 0 ? G.reduce((acc, v) => acc + (v < 0.01 * peak ? 1 : 0), 0) / count : 1
  };
}

/* ---------------------------------------------------------------- symmetry --
   The landscape repeats, and saying how is more useful than drawing more of it. */

export function symmetryNote(sim) {
  const notes = ['β repeats with period π, because the mixer is a rotation.'];

  /* If every energy gap is a whole multiple of some g, then exp(-i*gamma*C)
     repeats in gamma with period 2*pi/g. The offset is a global phase and drops
     out, so only the GAPS matter. */
  const base = sim.costs[0];
  let allIntegerGaps = true;
  let g = 0;
  for (let z = 1; z < sim.size && allIntegerGaps; z++) {
    const d = Math.abs(sim.costs[z] - base);
    if (Math.abs(d - Math.round(d)) > 1e-9) { allIntegerGaps = false; break; }
    g = gcd(g, Math.round(d));
  }
  if (allIntegerGaps && g > 0) {
    const period = 2 * Math.PI / g;
    notes.push('Every energy gap is a multiple of ' + g +
      ', so γ repeats with period 2π/' + g + (g === 1 ? '' : ' ≈ ' + period.toFixed(3)) + '.');
  } else if (allIntegerGaps) {
    notes.push('Every assignment has the same energy, so the landscape is flat.');
  } else {
    notes.push('The energies are not all whole numbers, so γ has no short period; the sweep shows [0, 2π].');
  }
  return { notes, gammaPeriodDivisor: allIntegerGaps ? g : null };
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

/* ------------------------------------------------------- solution quality -- */

/**
 * What the circuit would actually hand you: the distribution over bitstrings,
 * binned by energy, plus the probability of landing on a true optimum.
 */
export function distribution(sim, params, opts) {
  const bins = (opts && opts.bins) || 24;
  const probs = sim.probabilities(params);
  const span = sim.emax - sim.emin;
  const counts = new Float64Array(bins);

  for (let z = 0; z < sim.size; z++) {
    const t = span <= 0 ? 0 : (sim.costs[z] - sim.emin) / span;
    const bin = Math.min(bins - 1, Math.floor(t * bins));
    counts[bin] += probs[z];
  }

  /* the single most likely bitstring, which is what one shot would most often give */
  let topZ = 0;
  for (let z = 1; z < sim.size; z++) if (probs[z] > probs[topZ]) topZ = z;

  return {
    counts, bins, emin: sim.emin, emax: sim.emax,
    groundProbability: sim.groundProbability(probs),
    /* a uniform guess is the thing to beat */
    uniformGroundProbability: sim.ground.length / sim.size,
    expectation: sim.expectation(params),
    topZ, topProbability: probs[topZ]
  };
}

/* ------------------------------------------------------- approximation ratio */

/**
 * Best achievable ratio at each depth p, each from the same linear-ramp start
 * with the same optimizer, so the curve says something about p and not about
 * luck. Uses the brute-forced ground energy, which is only available under the
 * cap, as is everything in this file.
 */
export function ratioVsP(sim, model, opts) {
  const maxP = (opts && opts.maxP) || 3;
  const iterations = (opts && opts.iterations) || 40;
  const method = (opts && opts.method) || 'adam';
  const out = [];
  for (let p = 1; p <= maxP; p++) {
    /* p=1 is free through the closed form; deeper circuits have to be simulated */
    const objective = p === 1 ? analyticObjective(model) : simObjective(sim);
    const run = optimize(objective, { method, p, init: rampFor(model, p), iterations, seed: 7 });
    const probs = sim.probabilities(run.bestParams);
    out.push({
      p,
      energy: run.best,
      ratio: sim.ratio(run.best),
      groundProbability: sim.groundProbability(probs),
      params: Array.from(run.bestParams)
    });
  }
  return out;
}

/* ------------------------------------------------------ parameter sensitivity
   The Hessian at the optimum, as eigenvalues plus 1D slices. Explicitly NOT a
   surface: at p>1 there is no 2D surface to draw, and drawing one anyway is the
   thing this tool refuses to do.                                              */

export function sensitivity(objective, params, opts) {
  const h = (opts && opts.h) || 1e-3;
  const d = params.length;
  const H = [];
  const x = Float64Array.from(params);
  const evaluate = (v) => objective.evaluate(v);
  const f0 = evaluate(x);

  for (let i = 0; i < d; i++) {
    H.push(new Array(d).fill(0));
  }
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      let value;
      if (i === j) {
        const keep = x[i];
        x[i] = keep + h; const up = evaluate(x);
        x[i] = keep - h; const down = evaluate(x);
        x[i] = keep;
        value = (up - 2 * f0 + down) / (h * h);
      } else {
        const ki = x[i], kj = x[j];
        x[i] = ki + h; x[j] = kj + h; const pp = evaluate(x);
        x[i] = ki + h; x[j] = kj - h; const pm = evaluate(x);
        x[i] = ki - h; x[j] = kj + h; const mp = evaluate(x);
        x[i] = ki - h; x[j] = kj - h; const mm = evaluate(x);
        x[i] = ki; x[j] = kj;
        value = (pp - pm - mp + mm) / (4 * h * h);
      }
      H[i][j] = value; H[j][i] = value;
    }
  }

  const eigenvalues = symmetricEigenvalues(H).sort((a, b) => b - a);

  /* 1D cuts through the optimum, one per parameter */
  const slices = [];
  const steps = (opts && opts.sliceSteps) || 41;
  const reach = (opts && opts.sliceReach) || 0.9;
  for (let i = 0; i < d; i++) {
    const keep = params[i];
    const xs = [], ys = [];
    for (let s = 0; s < steps; s++) {
      const offset = (s / (steps - 1) - 0.5) * 2 * reach;
      x[i] = keep + offset;
      xs.push(keep + offset);
      ys.push(evaluate(x));
    }
    x[i] = keep;
    const p = d >> 1;
    slices.push({
      index: i,
      label: (i < p ? 'γ' : 'β') + (p > 1 ? (i % p) + 1 : ''),
      centre: keep, xs, ys
    });
  }

  const largest = eigenvalues.length ? Math.abs(eigenvalues[0]) : 0;
  const smallest = eigenvalues.length ? Math.abs(eigenvalues[eigenvalues.length - 1]) : 0;
  return {
    hessian: H, eigenvalues, slices,
    /* how much more sharply the cost turns along its stiffest direction than its
       softest; a big number means one direction matters far more than another */
    anisotropy: smallest > 1e-12 ? largest / smallest : Infinity,
    negativeDirections: eigenvalues.filter((v) => v < -1e-9).length
  };
}

/** Jacobi rotations. The matrices here are 2p x 2p with p small, so this is ample. */
function symmetricEigenvalues(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return a.map((row, i) => row[i]);
}

/* ------------------------------------------------ energy-scale separation ---
   Lucas's hardness signal: when the coefficients span many orders of magnitude,
   the small ones are swamped and a device (or an optimizer) struggles to resolve
   them. Cheap to compute from h and J, and it works at ANY size (it never
   touches the statevector), so this one is not capped.                        */

export function energyScale(model) {
  const I = quboToIsing(model);
  const magnitudes = [];
  for (const v of I.h) if (v !== 0) magnitudes.push(Math.abs(v));
  for (const t of I.J) if (t.value !== 0) magnitudes.push(Math.abs(t.value));

  if (!magnitudes.length) {
    return { level: 'ok', ratio: 1, smallest: 0, largest: 0, terms: 0,
      message: 'No non-zero coefficients, so there is nothing to separate.' };
  }
  const largest = Math.max(...magnitudes);
  const smallest = Math.min(...magnitudes);
  const ratio = smallest > 0 ? largest / smallest : Infinity;

  let level = 'ok';
  if (ratio >= 1000) level = 'error';
  else if (ratio >= 100) level = 'warn';

  return {
    level, ratio, smallest, largest, terms: magnitudes.length,
    message: level === 'ok'
      ? 'Coefficients span a factor of ' + formatRatio(ratio) + ', a comfortable range.'
      : 'The largest coefficient is ' + formatRatio(ratio) + ' times the smallest. ' +
        'Terms that far apart are hard to resolve together: on real hardware the small ones ' +
        'disappear into the noise, and an optimizer sees a landscape dominated by the large ones. ' +
        'A smaller penalty λ, or rescaling the objective, usually narrows it.'
  };
}

function formatRatio(r) {
  if (!Number.isFinite(r)) return 'infinitely many';
  if (r >= 1000) return Math.round(r / 100) / 10 + '×10³';
  return String(Math.round(r * 10) / 10);
}
