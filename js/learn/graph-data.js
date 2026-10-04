/* ============================================================
   graph-data.js — the only place node metadata exists.

   Transcribed from LEARN_GRAPH_SPEC.md §2–§5. Titles, rings, clusters and
   edges are copied verbatim from those tables; nothing here is derived,
   improved or re-ordered except as noted below.

   Two deliberate additions to the spec's schema:

   - `label` — the short form drawn on the graph. Full titles ("Interaction-free
     measurement: the Elitzur–Vaidman bomb tester") cannot be shown at 76 nodes
     without collisions, and the build instructions say to shorten the label in
     the data rather than hide it on hover. `title` stays exact and is what the
     panel, the list fallback and the accessible name use.
   - `TOOL_LINKS[...].href === null` — the QEC tool is not built yet. A handoff
     with no href renders as a plain note instead of a dead link.
   - `levelOverride` — optional, per node. The layered layout computes a level
     from the prerequisite graph; an override may only push a node DOWN, to a
     harder level, never up. None are set: the author sets them after reading
     `node tools/validate-graph.mjs --levels`.

   `ring` is kept exactly as the spec has it, but the layout no longer uses it:
   it is not a valid layering (interference-mach-zehnder shares ring 1 with its
   own prerequisite). Levels are computed. The two are reconciled later.

   NODES is ordered cluster-then-ring, because DOM order is tab order and that
   is the sequence a reader should meet the topics in. `folds` from the spec are
   authoring notes for the prose, not render data, so they are not carried here.
   ============================================================ */

/* Order is fixed and defines angular placement. Never sort at runtime.
   `sectorWeight` is the share of the circle a cluster gets. foundations is 0:
   it lives at the origin (spec §6, entry point one) and takes no sector. */
export const CLUSTERS = [
  { id: 'foundations',   label: 'Foundations',        sectorWeight: 0 },
  { id: 'quantum-core',  label: 'Quantum core',       sectorWeight: 9 },
  { id: 'gates',         label: 'Gates & circuits',   sectorWeight: 4 },
  { id: 'entanglement',  label: 'Entanglement',       sectorWeight: 7 },
  { id: 'communication', label: 'Communication',      sectorWeight: 8 },
  { id: 'cryptography',  label: 'Cryptography',       sectorWeight: 9 },
  { id: 'platforms',     label: 'Platforms & optics', sectorWeight: 5 },
  { id: 'noise',         label: 'Noise',              sectorWeight: 3 },
  { id: 'qec',           label: 'Error correction',   sectorWeight: 6 },
  { id: 'algorithms',    label: 'Algorithms',         sectorWeight: 9 },
  { id: 'variational',   label: 'Variational',        sectorWeight: 4 },
  { id: 'optimization',  label: 'Optimization',       sectorWeight: 7 }
];

export const NODES = [
  /* ---------------- foundations (spec §3.1) ---------------- */
  { id: 'complex-amplitudes-bloch', title: 'Complex amplitudes & the Bloch sphere', label: 'Amplitudes & Bloch',
    cluster: 'foundations', ring: 0, prereq: [], related: [], sim: 'core' },
  { id: 'dirac-notation', title: 'Dirac notation & inner products', label: 'Dirac notation',
    cluster: 'foundations', ring: 0, prereq: [], related: [], sim: 'good' },
  { id: 'matrices-unitaries', title: 'Matrices, unitaries & eigenvectors', label: 'Matrices & unitaries',
    cluster: 'foundations', ring: 0, prereq: ['dirac-notation'], related: [], sim: 'good' },
  { id: 'tensor-products', title: 'Tensor products & multi-qubit spaces', label: 'Tensor products',
    cluster: 'foundations', ring: 0, prereq: ['dirac-notation', 'matrices-unitaries'], related: [], sim: 'good' },
  { id: 'classical-probability-entropy', title: 'Classical probability & Shannon entropy', label: 'Probability & entropy',
    cluster: 'foundations', ring: 0, prereq: [], related: [], sim: 'good' },

  /* ---------------- quantum-core (spec §3.2) ---------------- */
  { id: 'stern-gerlach', title: 'Stern–Gerlach & the discovery of spin', label: 'Stern–Gerlach',
    cluster: 'quantum-core', ring: 1, prereq: ['complex-amplitudes-bloch'], related: ['measurement-born-rule'], sim: 'core' },
  { id: 'superposition-parallelism', title: 'Superposition & quantum parallelism', label: 'Superposition',
    cluster: 'quantum-core', ring: 1, prereq: ['dirac-notation', 'complex-amplitudes-bloch'], related: [], sim: 'core' },
  { id: 'interference-mach-zehnder', title: 'Interference & the Mach–Zehnder interferometer', label: 'Interference',
    cluster: 'quantum-core', ring: 1, prereq: ['superposition-parallelism'], related: [], sim: 'core' },
  { id: 'measurement-born-rule', title: 'Measurement, the Born rule & basis choice', label: 'Measurement',
    cluster: 'quantum-core', ring: 1, prereq: ['superposition-parallelism', 'matrices-unitaries'], related: [], sim: 'core' },
  { id: 'hamming-distance-weight', title: 'Hamming distance & weight', label: 'Hamming distance',
    cluster: 'quantum-core', ring: 1, prereq: ['classical-probability-entropy'], related: [], sim: 'good' },
  { id: 'density-matrices', title: 'Mixed states, density matrices & partial trace', label: 'Density matrices',
    cluster: 'quantum-core', ring: 2, prereq: ['measurement-born-rule', 'tensor-products'], related: [], sim: 'good' },
  { id: 'no-cloning', title: 'No-cloning theorem', label: 'No-cloning',
    cluster: 'quantum-core', ring: 2, prereq: ['superposition-parallelism', 'matrices-unitaries'], related: [], sim: 'prose' },
  { id: 'quantum-entropies', title: 'Quantum entropies: von Neumann, Rényi, min-entropy', label: 'Quantum entropies',
    cluster: 'quantum-core', ring: 2, prereq: ['classical-probability-entropy', 'density-matrices'], related: [], sim: 'good' },
  { id: 'purity-swap-test', title: 'Purity & the SWAP test', label: 'Purity & SWAP test',
    cluster: 'quantum-core', ring: 3, prereq: ['density-matrices', 'two-qubit-gates'], related: ['entanglement-measures'], sim: 'core' },

  /* ---------------- gates (spec §3.3) ---------------- */
  { id: 'single-qubit-gates', title: 'Single-qubit gates & rotations', label: 'Single-qubit gates',
    cluster: 'gates', ring: 1, prereq: ['matrices-unitaries', 'complex-amplitudes-bloch'], related: [], sim: 'core' },
  { id: 'two-qubit-gates', title: 'Two-qubit gates & entangling operations', label: 'Two-qubit gates',
    cluster: 'gates', ring: 2, prereq: ['single-qubit-gates', 'tensor-products'], related: [], sim: 'core' },
  { id: 'circuits-universality', title: 'Circuits: composition, universality, reversibility', label: 'Circuits',
    cluster: 'gates', ring: 3, prereq: ['two-qubit-gates'], related: [], sim: 'core' },
  { id: 'phase-kickback', title: 'Phase kickback', label: 'Phase kickback',
    cluster: 'gates', ring: 3, prereq: ['two-qubit-gates', 'single-qubit-gates'], related: [], sim: 'core' },

  /* ---------------- entanglement (spec §3.4) ---------------- */
  { id: 'entangled-states-bell-basis', title: 'Entangled states & the Bell basis', label: 'Bell basis',
    cluster: 'entanglement', ring: 3, prereq: ['two-qubit-gates', 'tensor-products'], related: [], sim: 'core' },
  { id: 'epr-paradox', title: 'EPR paradox & hidden variables', label: 'EPR paradox',
    cluster: 'entanglement', ring: 4, prereq: ['entangled-states-bell-basis'], related: ['stern-gerlach'], sim: 'prose' },
  { id: 'entanglement-measures', title: 'Entanglement measures', label: 'Entanglement measures',
    cluster: 'entanglement', ring: 4, prereq: ['entangled-states-bell-basis', 'density-matrices', 'quantum-entropies'], related: [], sim: 'good' },
  { id: 'chsh-nonlocality', title: 'CHSH & nonlocality', label: 'CHSH & nonlocality',
    cluster: 'entanglement', ring: 5, prereq: ['epr-paradox', 'measurement-born-rule'], related: [], sim: 'core' },
  { id: 'entanglement-detection', title: 'Entanglement detection: witnesses & PPT', label: 'Witnesses & PPT',
    cluster: 'entanglement', ring: 5, prereq: ['entanglement-measures', 'density-matrices'], related: [], sim: 'core' },
  { id: 'multipartite-nonlocality', title: 'Multipartite nonlocality: GHZ, Mermin, Svetlichny', label: 'GHZ & Mermin',
    cluster: 'entanglement', ring: 6, prereq: ['chsh-nonlocality'], related: ['cluster-graph-states'], sim: 'good' },
  { id: 'monogamy-distributed-entanglement', title: 'Monogamy & distributed entanglement', label: 'Monogamy',
    cluster: 'entanglement', ring: 6, prereq: ['entanglement-measures'], related: ['qkd-overview'], sim: 'good' },

  /* ---------------- communication (spec §3.10) ---------------- */
  { id: 'superdense-coding', title: 'Superdense coding', label: 'Superdense coding',
    cluster: 'communication', ring: 4, prereq: ['entangled-states-bell-basis', 'two-qubit-gates'], related: ['quantum-teleportation'], sim: 'core' },
  { id: 'quantum-teleportation', title: 'Quantum teleportation', label: 'Teleportation',
    cluster: 'communication', ring: 4, prereq: ['entangled-states-bell-basis', 'measurement-born-rule', 'no-cloning'], related: [], sim: 'core' },
  { id: 'entanglement-generation-heralding', title: 'Entanglement generation & heralding', label: 'Heralded pairs',
    cluster: 'communication', ring: 4, prereq: ['entangled-states-bell-basis', 'photodetection-detectors'], related: [], sim: 'good' },
  { id: 'gate-teleportation', title: 'Gate teleportation', label: 'Gate teleportation',
    cluster: 'communication', ring: 5, prereq: ['quantum-teleportation'], related: ['stabilizer-formalism'], sim: 'good' },
  { id: 'entanglement-swapping', title: 'Entanglement swapping', label: 'Swapping',
    cluster: 'communication', ring: 5, prereq: ['quantum-teleportation', 'entanglement-generation-heralding'], related: [], sim: 'core' },
  { id: 'entanglement-purification', title: 'Entanglement purification', label: 'Purification',
    cluster: 'communication', ring: 6, prereq: ['entanglement-measures', 'quantum-channels-kraus'], related: ['entanglement-swapping'], sim: 'core' },
  { id: 'repeaters-network-architecture', title: 'Repeaters & network architecture', label: 'Repeaters',
    cluster: 'communication', ring: 7, prereq: ['entanglement-swapping', 'entanglement-purification'], related: [], sim: 'core' },
  { id: 'networks-in-practice', title: 'Networks in practice', label: 'Networks in practice',
    cluster: 'communication', ring: 8, prereq: ['repeaters-network-architecture'], related: [], sim: 'prose' },

  /* ---------------- cryptography (spec §3.11) ---------------- */
  { id: 'classical-key-exchange-rsa', title: 'Classical key exchange & RSA', label: 'RSA & key exchange',
    cluster: 'cryptography', ring: 0, prereq: [], related: [], sim: 'core' },
  { id: 'qrng', title: 'QRNG', label: 'QRNG',
    cluster: 'cryptography', ring: 3, prereq: ['measurement-born-rule', 'quantum-entropies'], related: [], sim: 'core' },
  { id: 'qkd-overview', title: 'QKD overview', label: 'QKD overview',
    cluster: 'cryptography', ring: 4, prereq: ['no-cloning', 'classical-key-exchange-rsa', 'measurement-born-rule'], related: [], sim: 'prose' },
  { id: 'bb84', title: 'BB84', label: 'BB84',
    cluster: 'cryptography', ring: 5, prereq: ['qkd-overview', 'polarization-photonic-encoding', 'no-cloning'], related: [], sim: 'core' },
  { id: 'e91', title: 'E91', label: 'E91',
    cluster: 'cryptography', ring: 6, prereq: ['qkd-overview', 'chsh-nonlocality', 'entangled-states-bell-basis'], related: [], sim: 'core' },
  { id: 'eavesdropping-intercept-resend', title: 'Eavesdropping & intercept–resend', label: 'Eavesdropping',
    cluster: 'cryptography', ring: 6, prereq: ['bb84'], related: [], sim: 'core' },
  { id: 'shors-algorithm', title: "Shor's algorithm", label: "Shor's algorithm",
    cluster: 'cryptography', ring: 7, prereq: ['qpe', 'qft', 'classical-key-exchange-rsa'], related: [], sim: 'core' },
  { id: 'di-mdi-qkd', title: 'DI-QKD & MDI-QKD', label: 'DI & MDI QKD',
    cluster: 'cryptography', ring: 7, prereq: ['e91', 'chsh-nonlocality', 'entanglement-detection'], related: [], sim: 'good' },
  { id: 'qkd-in-practice', title: 'QKD in practice', label: 'QKD in practice',
    cluster: 'cryptography', ring: 8, prereq: ['bb84', 'e91', 'di-mdi-qkd'], related: [], sim: 'prose' },

  /* ---------------- platforms (spec §3.5) ---------------- */
  { id: 'polarization-photonic-encoding', title: 'Polarization & photonic encoding', label: 'Polarization',
    cluster: 'platforms', ring: 2, prereq: ['complex-amplitudes-bloch', 'measurement-born-rule'], related: [], sim: 'core' },
  { id: 'photodetection-detectors', title: 'Photodetection & detectors', label: 'Photodetection',
    cluster: 'platforms', ring: 2, prereq: ['measurement-born-rule'], related: ['polarization-photonic-encoding'], sim: 'good' },
  { id: 'interaction-free-measurement', title: 'Interaction-free measurement: the Elitzur–Vaidman bomb tester', label: 'Bomb tester',
    cluster: 'platforms', ring: 2, prereq: ['interference-mach-zehnder', 'measurement-born-rule'], related: [], sim: 'core' },
  { id: 'squeezed-light', title: 'Squeezed light basics', label: 'Squeezed light',
    cluster: 'platforms', ring: 2, prereq: ['complex-amplitudes-bloch', 'measurement-born-rule'], related: [], sim: 'good' },
  { id: 'quantum-sensing-metrology', title: 'Quantum sensing & metrology', label: 'Sensing & metrology',
    cluster: 'platforms', ring: 3, prereq: ['squeezed-light', 'interference-mach-zehnder'], related: [], sim: 'good' },

  /* ---------------- noise (spec §3.6) ---------------- */
  { id: 'decoherence-t1-t2', title: 'Decoherence, T1 and T2', label: 'Decoherence, T1/T2',
    cluster: 'noise', ring: 3, prereq: ['density-matrices'], related: [], sim: 'core' },
  { id: 'quantum-channels-kraus', title: 'Quantum channels: Kraus operators & noise models', label: 'Quantum channels',
    cluster: 'noise', ring: 4, prereq: ['decoherence-t1-t2', 'density-matrices'], related: [], sim: 'core' },
  { id: 'enaqt', title: 'ENAQT — environment-assisted transport', label: 'ENAQT',
    cluster: 'noise', ring: 5, prereq: ['quantum-channels-kraus', 'decoherence-t1-t2'], related: [], sim: 'core' },

  /* ---------------- qec (spec §3.12) ---------------- */
  { id: 'classical-error-correction', title: 'Classical error correction primer', label: 'Classical ECC',
    cluster: 'qec', ring: 2, prereq: ['hamming-distance-weight'], related: [], sim: 'core' },
  { id: 'bit-flip-phase-flip-codes', title: 'Bit-flip & phase-flip codes', label: 'Bit & phase flip',
    cluster: 'qec', ring: 4, prereq: ['classical-error-correction', 'two-qubit-gates', 'quantum-channels-kraus'], related: [], sim: 'core' },
  { id: 'shor-9-qubit-code', title: "Shor's 9-qubit code", label: 'Shor 9-qubit code',
    cluster: 'qec', ring: 5, prereq: ['bit-flip-phase-flip-codes'], related: [], sim: 'core' },
  { id: 'stabilizer-formalism', title: 'Stabilizer formalism', label: 'Stabilizers',
    cluster: 'qec', ring: 6, prereq: ['shor-9-qubit-code', 'two-qubit-gates'], related: [], sim: 'core' },
  { id: 'cluster-graph-states', title: 'Cluster & graph states', label: 'Cluster states',
    cluster: 'qec', ring: 7, prereq: ['stabilizer-formalism', 'entangled-states-bell-basis'], related: [], sim: 'good' },
  { id: 'qec-applications-outlook', title: 'Applications & outlook', label: 'QEC outlook',
    cluster: 'qec', ring: 8, prereq: ['stabilizer-formalism'], related: [], sim: 'prose' },

  /* ---------------- algorithms (spec §3.7) ---------------- */
  { id: 'oracles-query-complexity', title: 'Oracles & query complexity', label: 'Oracles & queries',
    cluster: 'algorithms', ring: 4, prereq: ['circuits-universality'], related: [], sim: 'good' },
  { id: 'qft', title: 'Quantum Fourier Transform', label: 'QFT',
    cluster: 'algorithms', ring: 4, prereq: ['circuits-universality', 'complex-amplitudes-bloch'], related: [], sim: 'core' },
  { id: 'deutsch', title: "Deutsch's algorithm", label: 'Deutsch',
    cluster: 'algorithms', ring: 5, prereq: ['oracles-query-complexity', 'phase-kickback'], related: [], sim: 'core' },
  { id: 'qpe', title: 'Quantum phase estimation', label: 'Phase estimation',
    cluster: 'algorithms', ring: 5, prereq: ['qft', 'phase-kickback'], related: [], sim: 'core' },
  { id: 'grover', title: 'Grover search', label: 'Grover search',
    cluster: 'algorithms', ring: 5, prereq: ['oracles-query-complexity', 'phase-kickback'], related: [], sim: 'core' },
  { id: 'deutsch-jozsa', title: 'Deutsch–Jozsa', label: 'Deutsch–Jozsa',
    cluster: 'algorithms', ring: 6, prereq: ['deutsch'], related: [], sim: 'core' },
  { id: 'bernstein-vazirani', title: 'Bernstein–Vazirani', label: 'Bernstein–Vazirani',
    cluster: 'algorithms', ring: 6, prereq: ['deutsch-jozsa'], related: [], sim: 'core' },
  { id: 'hhl', title: 'HHL linear solver', label: 'HHL solver',
    cluster: 'algorithms', ring: 6, prereq: ['qpe', 'matrices-unitaries'], related: ['vqls'], sim: 'good' },
  { id: 'simons-algorithm', title: "Simon's algorithm", label: "Simon's algorithm",
    cluster: 'algorithms', ring: 7, prereq: ['bernstein-vazirani'], related: ['shors-algorithm'], sim: 'good' },

  /* ---------------- variational (spec §3.8) ---------------- */
  { id: 'ansatz-design', title: 'Ansatz design', label: 'Ansatz design',
    cluster: 'variational', ring: 4, prereq: ['circuits-universality', 'single-qubit-gates'], related: [], sim: 'core' },
  { id: 'vqe', title: 'The variational principle & VQE', label: 'VQE',
    cluster: 'variational', ring: 5, prereq: ['ansatz-design', 'measurement-born-rule'], related: [], sim: 'core' },
  { id: 'vqls', title: 'VQLS — variational linear solver', label: 'VQLS',
    cluster: 'variational', ring: 6, prereq: ['vqe'], related: [], sim: 'good' },
  { id: 'qaoa', title: 'QAOA', label: 'QAOA',
    cluster: 'variational', ring: 6, prereq: ['vqe', 'ansatz-design', 'qubo-ising-mapping'], related: ['adiabatic-annealing'], sim: 'core' },

  /* ---------------- optimization (spec §3.9) ---------------- */
  { id: 'combinatorial-optimization-primer', title: 'Combinatorial optimization primer', label: 'Optimization primer',
    cluster: 'optimization', ring: 0, prereq: [], related: [], sim: 'core' },
  { id: 'ising-spin-glasses', title: 'Ising model & spin glasses', label: 'Ising & spin glasses',
    cluster: 'optimization', ring: 2, prereq: ['combinatorial-optimization-primer'], related: [], sim: 'core' },
  { id: 'qubo-ising-mapping', title: 'QUBO formulation & the Ising mapping', label: 'QUBO & Ising mapping',
    cluster: 'optimization', ring: 3, prereq: ['ising-spin-glasses', 'combinatorial-optimization-primer'], related: [], sim: 'core' },
  { id: 'penalty-methods', title: 'Encoding constraints: penalty methods', label: 'Penalty methods',
    cluster: 'optimization', ring: 4, prereq: ['qubo-ising-mapping'], related: [], sim: 'core' },
  { id: 'problem-library', title: 'Problem library: Max-Cut, knapsack, TSP', label: 'Problem library',
    cluster: 'optimization', ring: 5, prereq: ['penalty-methods', 'qubo-ising-mapping'], related: [], sim: 'core' },
  { id: 'adiabatic-annealing', title: 'Adiabatic theorem & quantum annealing', label: 'Quantum annealing',
    cluster: 'optimization', ring: 5, prereq: ['ising-spin-glasses', 'qubo-ising-mapping'], related: [], sim: 'good' },
  { id: 'optimization-in-practice', title: 'Optimization in practice', label: 'Optimization practice',
    cluster: 'optimization', ring: 8, prereq: ['qaoa', 'adiabatic-annealing', 'problem-library'], related: [], sim: 'prose' }
];

/* One-way links out of the graph, not nodes (spec §5). `href` is relative to
   learn.html. A null href means the tool does not exist yet; the panel says so
   rather than shipping a link that 404s. */
export const TOOL_LINKS = {
  'qaoa':                { label: 'QUBO / QAOA Workbench', href: 'tools/qubo-workbench/' },
  'penalty-methods':     { label: 'QUBO / QAOA Workbench — constraint encoding', href: 'tools/qubo-workbench/' },
  'problem-library':     { label: 'QUBO / QAOA Workbench — problem presets', href: 'tools/qubo-workbench/' },
  'stabilizer-formalism': { label: 'QEC tool', href: null },
  'shor-9-qubit-code':   { label: 'QEC tool', href: null }
};

/* ---- derived, at module load. There is no second edge list to maintain. ---- */

export const NODE_BY_ID = new Map(NODES.map(function (n) { return [n.id, n]; }));

export const CLUSTER_BY_ID = new Map(CLUSTERS.map(function (c) { return [c.id, c]; }));

/** Every edge, in one array. `type` is 'prereq' or 'related' — there is no third. */
export const EDGES = (function () {
  const out = [];
  for (const n of NODES) {
    for (const p of n.prereq) out.push({ from: p, to: n.id, type: 'prereq' });
    for (const r of n.related) out.push({ from: n.id, to: r, type: 'related' });
  }
  return out;
})();

/** id -> Set of ids joined by any edge, in either direction. */
export const NEIGHBOURS = (function () {
  const m = new Map(NODES.map(function (n) { return [n.id, new Set()]; }));
  for (const e of EDGES) {
    if (m.has(e.from)) m.get(e.from).add(e.to);
    if (m.has(e.to)) m.get(e.to).add(e.from);
  }
  return m;
})();

/** The graph label, falling back to the full title when no short form is set. */
export function labelOf(node) {
  return node.label || node.title;
}
