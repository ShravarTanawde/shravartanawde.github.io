/* ============================================================================
   codegen.js: the take-away artifact.

   Turns a model into a self-contained program the visitor can paste into a
   fresh notebook and run with ZERO edits. This is the one thing the tool
   produces that outlives the tab, and above the qubit cap it is the ONLY thing
   it produces, so it is never gated, never truncated, and never refers to
   "the data you entered".

   Framework is a parameter; only PennyLane is implemented. A second backend
   would add an entry to FRAMEWORKS and nothing else: everything above that line
   deals in the model, and everything below it in strings.

   Nothing here touches the network. The Colab link is a URL the user may choose
   to click; the tool never fetches it.

   THE CORRECTNESS CONTRACT
   ------------------------
   The emitted program prints a line marked CROSS-CHECK: the cost expectation at
   a fixed set of parameters that this tool found and wrote into the file. That
   number must equal the one the in-browser simulator shows for the same
   parameters, to floating-point tolerance. That equality is what "the codegen is
   correct" means, and validation/templates_check.py executes the emitted file
   against a real PennyLane release to confirm it.

   Note what is NOT claimed: the program also runs its own optimisation, and
   PennyLane's optimizer is not ours, so THAT number is not expected to match
   bit for bit. Pinning the comparison to a fixed-parameter evaluation is what
   makes the check exact rather than approximate.
   ============================================================================ */

import { quboToIsing, QUBIT_CAP, capLevel, bitsFromIndex } from './qubo.js?v=1';
import { problemFor } from './problems.js?v=1';

/* Bumped only when validation/templates_check.py has been run against the new
   release and the emitted templates still produce the right numbers. */
export const PENNYLANE_VERSION = '0.45.1';

/* The seed written into every emitted program, and used by the tool when it
   picks the parameters it embeds. One number, one place. */
export const EMITTED_SEED = 1234;

export const FRAMEWORKS = {
  pennylane: {
    id: 'pennylane',
    label: 'PennyLane',
    version: PENNYLANE_VERSION,
    filename: (model) => 'qaoa_' + model.problemType + '.py',
    emit: emitPennyLane
  }
};

/**
 * @param {object} model
 * @param {object} [opts] {framework, params, extras:{lambdaSweep,optimizerBakeOff,initComparison},
 *                         steps, seed}
 * @returns {{code:string, framework:string, filename:string, overCap:boolean,
 *            crossCheck:{params:number[], note:string}}}
 */
export function generate(model, opts) {
  const options = opts || {};
  const framework = FRAMEWORKS[options.framework || 'pennylane'];
  if (!framework) throw new RangeError('No code generator for "' + options.framework + '".');
  return framework.emit(model, options);
}

/* ------------------------------------------------------------- formatting -- */

/** Python literal for a float, round-tripping exactly. */
function py(x) {
  if (Number.isInteger(x)) return String(x);
  /* 17 significant digits is what guarantees a double survives the round trip */
  return Number(x).toPrecision(17).replace(/0+e/, 'e');
}

function pyList(values, perLine = 8, indent = '    ') {
  const parts = values.map(py);
  if (parts.length <= perLine) return '[' + parts.join(', ') + ']';
  const lines = [];
  for (let i = 0; i < parts.length; i += perLine) {
    lines.push(indent + '    ' + parts.slice(i, i + perLine).join(', ') + ',');
  }
  return '[\n' + lines.join('\n') + '\n' + indent + ']';
}

function pyStr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

function wrapComment(text, width = 76, prefix = '# ') {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width - prefix.length) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => prefix + l).join('\n');
}

/* --------------------------------------------------------------- PennyLane -- */

function emitPennyLane(model, options) {
  const n = model.meta.qubitCount;
  const overCap = n > QUBIT_CAP;
  const ising = quboToIsing(model);
  const problem = problemFor(model);
  const seed = options.seed === undefined ? EMITTED_SEED : options.seed;
  const steps = options.steps || 60;
  const extras = options.extras || {};

  /* The parameters the tool found, embedded so the emitted program can be
     compared against the browser exactly. Always present, even over the cap;
     there they are the starting point rather than an optimum. */
  const params = Array.from(options.params || [0.7, 0.7]);
  const p = params.length >> 1;

  const out = [];
  const w = (line) => out.push(line === undefined ? '' : line);

  /* ---- header ---- */
  w('# ' + '=' .repeat(74));
  w('# QAOA for: ' + problem.title);
  w('#');
  w(wrapComment(problem.constraintText
    ? 'Constraint: ' + problem.constraintText + '.'
    : 'An unconstrained objective.', 76, '# '));
  w('#');
  w(wrapComment('Generated by the QUBO / QAOA Workbench. Self-contained: it installs what ' +
    'it needs, defines this instance inline, seeds its own randomness, and prints a result. ' +
    'Paste it into a fresh notebook and run it. There is nothing to fill in.', 76, '# '));
  w('#');
  w('# ' + n + ' qubits  ·  ' + model.meta.decisionCount + ' decision, ' +
    model.meta.ancillaCount + ' ancilla  ·  penalty lambda = ' + py(model.penalty.lambda));
  if (model.penalty.source === 'lucas_bound') {
    w(wrapComment('The penalty comes from the closed-form bound for this problem (' +
      problem.boundText + '), so the formulation is sound by construction.', 76, '# '));
  } else {
    w(wrapComment('WARNING: the penalty was set by hand, not taken from the bound (' +
      problem.boundText + ' gives ' + py(model.penalty.bound) + '). If it is below the bound, ' +
      'the ground state is not guaranteed to respect the constraints.', 76, '# '));
  }

  if (overCap) {
    w('#');
    w('# ' + '-'.repeat(74));
    w(wrapComment('NOT EXECUTED BY THE TOOL. At ' + n + ' qubits this instance is above the ' +
      'workbench\'s in-browser limit, so the formulation below was built and checked ' +
      'structurally but never simulated. The numbers this program prints have not been ' +
      'compared against anything.', 76, '# '));
    w('#');
    w(wrapComment('The device below is a matrix-product-state simulator rather than a dense ' +
      'statevector one. A dense state of ' + n + ' qubits is ' +
      '16 x 2^' + n + ' bytes, which will exhaust the memory of a free Colab instance. MPS ' +
      'handles far more qubits when the circuit keeps entanglement low, at the cost of being ' +
      'approximate when it does not. Raise max_bond_dim if the results look wrong.', 76, '# '));
    w('# ' + '-'.repeat(74));
  }
  w('# ' + '='.repeat(74));
  w();
  w('# !pip install pennylane==' + PENNYLANE_VERSION);
  w('# (uncomment the line above on a fresh machine; Colab needs it)');
  w('!pip install -q pennylane==' + PENNYLANE_VERSION);
  w();
  w('import pennylane as qml');
  w('from pennylane import numpy as np');
  w();
  w('# Everything below is seeded. Re-running gives the same numbers every time;');
  w('# change SEED if you want a different random start.');
  w('SEED = ' + seed);
  w('np.random.seed(SEED)');
  w();

  /* ---- the instance ---- */
  w('# ' + '-'.repeat(74));
  w('# The instance, written out in full. Nothing here refers back to the tool.');
  w('# ' + '-'.repeat(74));
  w('N_QUBITS = ' + n);
  w();
  w('# QUBO:  E(y) = sum_k Q[k][k] y_k + sum_{k<l} Q[k][l] y_k y_l + OFFSET,  y in {0,1}');
  w('Q = [');
  for (let i = 0; i < n; i++) {
    w('    ' + pyList(model.Q[i], 12, '    ') + ',');
  }
  w(']');
  w('OFFSET = ' + py(model.offset));
  w();
  w('# What each qubit stands for.');
  w('LABELS = [');
  for (const v of model.variables) w('    ' + pyStr(v.label) + ',');
  w(']');
  w();

  /* ---- the Hamiltonian ---- */
  w('# ' + '-'.repeat(74));
  w('# Cost Hamiltonian.');
  w('#');
  w(wrapComment('The workbench stores the Ising form with x = 1 <-> s = +1. A PauliZ ' +
    'measurement is the other way round: Z has eigenvalue +1 on |0> and -1 on |1>, so ' +
    'z_i = 1 - 2 x_i = -s_i. Substituting flips the sign of every LOCAL field and leaves the ' +
    'couplings alone, because a ZZ term flips twice.', 76, '# '));
  w('#');
  w(wrapComment('This is easy to get wrong and hard to notice: the two conventions differ by ' +
    'X on every qubit, which commutes with the mixer and fixes the |+> start, so <C> comes out ' +
    'IDENTICAL either way. Only the measured bitstrings come back complemented. That is why the ' +
    'cross-check below tests a probability as well as an energy.', 76, '# '));
  w('#');
  w('#   E(z) = sum_i HZ_i z_i + sum_{i<j} J_ij z_i z_j + ISING_OFFSET');
  w('# ' + '-'.repeat(74));
  w('# HZ_i = -h_i : the sign flip described above, applied once, here.');
  w('H_FIELDS = ' + pyList(ising.h.map((v) => -v), 8, ''));
  w('J_COUPLINGS = [');
  for (const t of ising.J) if (t.value !== 0) w('    (' + t.i + ', ' + t.j + ', ' + py(t.value) + '),');
  w(']');
  w('ISING_OFFSET = ' + py(ising.offset));
  w();
  w('coeffs, ops = [], []');
  w('for i, h in enumerate(H_FIELDS):');
  w('    if h != 0.0:');
  w('        coeffs.append(h)');
  w('        ops.append(qml.PauliZ(i))');
  w('for i, j, jij in J_COUPLINGS:');
  w('    coeffs.append(jij)');
  w('    ops.append(qml.PauliZ(i) @ qml.PauliZ(j))');
  w('');
  w('# The identity term carries the offset, so every energy this program prints is');
  w('# on the same scale as the QUBO above. Dropping it would shift them all.');
  w('coeffs.append(ISING_OFFSET)');
  w('ops.append(qml.Identity(0))');
  w('');
  w('cost_h = qml.Hamiltonian(coeffs, ops)');
  w('mixer_h = qml.Hamiltonian([1.0] * N_QUBITS, [qml.PauliX(i) for i in range(N_QUBITS)])');
  w();

  /* ---- the device ---- */
  w('# ' + '-'.repeat(74));
  if (overCap) {
    w('# Matrix-product-state device: see the note at the top about why.');
    w('# ' + '-'.repeat(74));
    w('try:');
    w('    dev = qml.device("lightning.tensor", method="mps", wires=N_QUBITS, max_bond_dim=64)');
    w('except Exception as exc:');
    w('    raise SystemExit(');
    w('        "This instance has " + str(N_QUBITS) + " qubits. A dense statevector would need "');
    w('        "16 * 2**" + str(N_QUBITS) + " bytes, so it needs an MPS/tensor device:\\n"');
    w('        "    !pip install pennylane-lightning[tensor]\\n"');
    w('        "Original error: " + str(exc)');
    w('    )');
  } else {
    w('# ' + n + ' qubits fits a dense statevector comfortably.');
    w('# ' + '-'.repeat(74));
    w('dev = qml.device("default.qubit", wires=N_QUBITS)');
  }
  w();

  /* ---- the circuit ---- */
  w('P_LAYERS = ' + p);
  w();
  w('def qaoa_layer(gamma, beta):');
  w('    qml.templates.ApproxTimeEvolution(cost_h, gamma, 1)');
  w('    qml.templates.ApproxTimeEvolution(mixer_h, beta, 1)');
  w();
  w('@qml.qnode(dev)');
  w('def cost_function(params):');
  w('    for i in range(N_QUBITS):');
  w('        qml.Hadamard(wires=i)                      # |+>^n');
  w('    for layer in range(P_LAYERS):');
  w('        qaoa_layer(params[0][layer], params[1][layer])');
  w('    return qml.expval(cost_h)');
  w();

  /* ---- the cross-check ---- */
  w('# ' + '-'.repeat(74));
  w('# CROSS-CHECK');
  w(wrapComment('These are the parameters the workbench found, written in verbatim. ' +
    (overCap
      ? 'Because this instance was never simulated in the browser, they are a starting ' +
        'point rather than a verified optimum, since there is nothing to compare against.'
      : 'The value printed on the next line is the number the workbench showed for the same ' +
        'parameters. If these two disagree by more than floating-point noise, the generated ' +
        'code and the tool have drifted apart and the tool is wrong.'), 76, '# '));
  w('# ' + '-'.repeat(74));
  w('FIXED_PARAMS = np.array([');
  w('    ' + pyList(params.slice(0, p), 8, '    ') + ',   # gamma');
  w('    ' + pyList(params.slice(p), 8, '    ') + ',   # beta');
  w('], requires_grad=False)');
  w();
  if (!overCap) {
    w('WORKBENCH_VALUE = ' + py(options.expectation === undefined ? 0 : options.expectation));
    w('here = float(cost_function(FIXED_PARAMS))');
    w('print("cross-check  <C> at the workbench parameters :", here)');
    w('print("cross-check  the workbench reported          :", WORKBENCH_VALUE)');
    w('print("cross-check  difference                      :", abs(here - WORKBENCH_VALUE))');
    if (options.probeIndex !== undefined) {
      w('');
      w('# An energy alone cannot catch a flipped bit convention, so check a');
      w('# probability too: this is the chance of one specific bitstring.');
      w('PROBE_INDEX = ' + options.probeIndex + '        # bitstring ' + (options.probeBits || ''));
      w('PROBE_WORKBENCH = ' + py(options.probeProbability === undefined ? 0 : options.probeProbability));
    }
  } else {
    w('print("<C> at the workbench starting parameters :", float(cost_function(FIXED_PARAMS)))');
    w('print("(not cross-checked: this size was never run in the browser)")');
  }
  w('print()');
  w();

  /* ---- the optimisation ---- */
  w('# ' + '-'.repeat(74));
  w('# One seeded optimisation run.');
  w(wrapComment('This uses PennyLane\'s own optimizer, which is not the workbench\'s, so the ' +
    'number it lands on is its own. Only the cross-check above is expected to match.', 76, '# '));
  w('# ' + '-'.repeat(74));
  w('params = np.array(FIXED_PARAMS, requires_grad=True)');
  w('opt = qml.AdamOptimizer(stepsize=0.08)');
  w();
  w('for step in range(' + steps + '):');
  w('    params, prev = opt.step_and_cost(cost_function, params)');
  w('    if step % 10 == 0 or step == ' + (steps - 1) + ':');
  w('        print(f"step {step:3d}   <C> = {float(prev): .6f}")');
  w();
  w('final = float(cost_function(params))');
  w('print()');
  w('print("final <C>        :", final)');
  w('print("final parameters :", np.round(np.array(params), 6).tolist())');
  w();

  /* ---- the answer ---- */
  if (!overCap && options.optimum !== undefined) {
    w('# ' + '-'.repeat(74));
    w('# Approximation ratio, measured from the worst assignment to the best. The two');
    w('# extremes come from the workbench\'s exhaustive search of this instance.');
    w('# ' + '-'.repeat(74));
    w('BEST_ENERGY  = ' + py(options.optimum));
    w('WORST_ENERGY = ' + py(options.worst === undefined ? options.optimum : options.worst));
    w('ratio = (WORST_ENERGY - final) / (WORST_ENERGY - BEST_ENERGY)');
    w('print("approximation ratio :", round(ratio, 6), "  (1.0 = the ground state)")');
    w();
  }
  w('# The output distribution, used for the probe above and the result below.');
  w('@qml.qnode(dev)');
  w('def probabilities(params):');
  w('    for i in range(N_QUBITS):');
  w('        qml.Hadamard(wires=i)');
  w('    for layer in range(P_LAYERS):');
  w('        qaoa_layer(params[0][layer], params[1][layer])');
  w('    return qml.probs(wires=range(N_QUBITS))');
  w();
  if (!overCap && options.probeIndex !== undefined) {
    w('probe = float(probabilities(FIXED_PARAMS)[PROBE_INDEX])');
    w('print("cross-check  P(probe bitstring) here          :", probe)');
    w('print("cross-check  the workbench reported          :", PROBE_WORKBENCH)');
    w('print("cross-check  difference                      :", abs(probe - PROBE_WORKBENCH))');
    w('print()');
    w();
  }
  w('probs = probabilities(params)');
  w('top = int(np.argmax(probs))');
  w('bits = format(top, "0" + str(N_QUBITS) + "b")   # qubit 0 is the leftmost bit');
  w('print()');
  w('print("most likely bitstring :", bits, f"(p = {float(probs[top]):.4f})")');
  w('for k, bit in enumerate(bits):');
  w('    if bit == "1":');
  w('        print("   on:", LABELS[k])');

  /* ---- opt-in extras ---- */
  if (extras.lambdaSweep) out.push(...extraLambdaSweep(model, problem));
  if (extras.optimizerBakeOff) out.push(...extraBakeOff(steps));
  if (extras.initComparison) out.push(...extraInits(p, steps));

  return {
    code: out.join('\n') + '\n',
    framework: FRAMEWORKS.pennylane.id,
    filename: FRAMEWORKS.pennylane.filename(model),
    overCap: overCap,
    capLevel: capLevel(n),
    seed: seed,
    params: params,
    colabUrl: 'https://colab.research.google.com/#create=true'
  };
}

/* ---------------------------------------------------------------- extras --
   Off by default. The point of the default artifact is that it is small enough
   to have been checked end to end; each of these makes it longer and slower, so
   they are chosen rather than assumed.                                       */

function extraLambdaSweep(model, problem) {
  const out = [];
  const w = (l) => out.push(l === undefined ? '' : l);
  w();
  w('# ' + '='.repeat(74));
  w('# EXTRA: penalty sweep');
  w(wrapComment('Rebuilds the QUBO at several penalties and reports the best assignment ' +
    'each one gives. The bound for this problem is ' + problem.boundText + ' = ' +
    py(model.penalty.bound) + '; below it, nothing guarantees the ground state is feasible.', 76, '# '));
  w('# ' + '='.repeat(74));
  w('import itertools');
  w();
  w('BOUND = ' + py(model.penalty.bound));
  w('def energy_of(bits, lam_scale):');
  w('    """Q was built at lambda = ' + py(model.penalty.lambda) + '; rescale the penalty part."""');
  w('    e = OFFSET * lam_scale');
  w('    for i in range(N_QUBITS):');
  w('        if bits[i]:');
  w('            e += Q[i][i] * lam_scale');
  w('            for j in range(i + 1, N_QUBITS):');
  w('                if bits[j]:');
  w('                    e += Q[i][j] * lam_scale');
  w('    return e');
  w();
  w('if N_QUBITS <= 20:');
  w('    for lam_scale in [0.25, 0.5, 1.0, 2.0]:');
  w('        best, best_bits = None, None');
  w('        for bits in itertools.product([0, 1], repeat=N_QUBITS):');
  w('            e = energy_of(bits, lam_scale)');
  w('            if best is None or e < best:');
  w('                best, best_bits = e, bits');
  w('        flag = "" if lam_scale * ' + py(model.penalty.lambda) + ' > BOUND else "   <-- below the safe bound"');
  w('        print(f"lambda x{lam_scale:<5} ground energy {best: .4f}   {\'\'.join(map(str, best_bits))}{flag}")');
  w('else:');
  w('    print("penalty sweep skipped: too many qubits to enumerate")');
  return out;
}

function extraBakeOff(steps) {
  const out = [];
  const w = (l) => out.push(l === undefined ? '' : l);
  w();
  w('# ' + '='.repeat(74));
  w('# EXTRA: optimizer bake-off, all from the same seeded start');
  w('# ' + '='.repeat(74));
  w('for name, make in [');
  w('    ("Gradient descent", lambda: qml.GradientDescentOptimizer(stepsize=0.02)),');
  w('    ("Adam           ", lambda: qml.AdamOptimizer(stepsize=0.08)),');
  w('    ("SPSA           ", lambda: qml.SPSAOptimizer(maxiter=' + steps + ')),');
  w(']:');
  w('    np.random.seed(SEED)');
  w('    x = np.array(FIXED_PARAMS, requires_grad=True)');
  w('    o = make()');
  w('    for _ in range(' + steps + '):');
  w('        x = o.step(cost_function, x)');
  w('    print(name, " final <C> =", float(cost_function(x)))');
  return out;
}

function extraInits(p, steps) {
  const out = [];
  const w = (l) => out.push(l === undefined ? '' : l);
  w();
  w('# ' + '='.repeat(74));
  w('# EXTRA: does the starting point matter?');
  w('# ' + '='.repeat(74));
  w('np.random.seed(SEED)');
  w('starts = {"workbench start": np.array(FIXED_PARAMS, requires_grad=True)}');
  w('for k in range(3):');
  w('    starts[f"random {k}"] = np.array(');
  w('        [np.random.uniform(0, 2 * np.pi, ' + p + '), np.random.uniform(0, np.pi, ' + p + ')],');
  w('        requires_grad=True)');
  w();
  w('for name, x in starts.items():');
  w('    o = qml.AdamOptimizer(stepsize=0.08)');
  w('    for _ in range(' + steps + '):');
  w('        x = o.step(cost_function, x)');
  w('    print(f"{name:<16} final <C> = {float(cost_function(x)): .6f}")');
  return out;
}
