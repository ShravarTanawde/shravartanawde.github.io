# Learn Graph — Node & Edge Specification

Source of truth for the Simulations/Learn page graph. Human-auditable here;
the build step should emit `data/learn-graph.json` from these tables.

**Status:** node list locked, edges first-pass, content unwritten.

---

## 1. Schema

Each node:

| field | meaning |
|---|---|
| `id` | stable slug. Never renumber. Filenames and anchors derive from this. |
| `title` | display label on the node |
| `ring` | layout band, 0 = centre. Layout hint only, not a hard ordering. |
| `cluster` | which branch it belongs to; drives colour |
| `prereq` | ids this node depends on. Rendered as **solid** edges. |
| `related` | ids that are thematically linked but not required. Rendered as **dashed** edges. |
| `sim` | planned interactive tier: `core` / `good` / `prose` |
| `folds` | subtopics absorbed into this node, kept so nothing is lost |

Edge rules:

- Only two edge types ever. Solid = prerequisite, dashed = related. No third weight.
- `prereq` is a DAG — no cycles. Verify at build time.
- `related` edges are undirected; declare each one **once only**, on the lower-ring node.
- Nothing is gated. Edges inform layout and suggested order; every node is directly reachable.

`sim` tiers:

- `core` — the node does not work without the interactive; build it first
- `good` — interactive adds real value, build in second pass
- `prose` — text + doodle is sufficient, no interactive planned

---

## 2. Clusters

| cluster | colour role | node count |
|---|---|---|
| `foundations` | neutral / centre | 5 |
| `quantum-core` | primary | 9 |
| `gates` | primary | 4 |
| `entanglement` | accent A | 7 |
| `platforms` | muted | 5 |
| `noise` | accent B | 3 |
| `algorithms` | accent C | 9 |
| `variational` | accent C light | 4 |
| `optimization` | accent D | 7 |
| `communication` | accent E | 8 |
| `cryptography` | accent F | 9 |
| `qec` | accent G | 6 |

Total: **76 nodes**.

---

## 3. Nodes

### 3.1 foundations

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `complex-amplitudes-bloch` | Complex amplitudes & the Bloch sphere | 0 | — | — | core |
| `dirac-notation` | Dirac notation & inner products | 0 | — | — | good |
| `matrices-unitaries` | Matrices, unitaries & eigenvectors | 0 | `dirac-notation` | — | good |
| `tensor-products` | Tensor products & multi-qubit spaces | 0 | `dirac-notation`, `matrices-unitaries` | — | good |
| `classical-probability-entropy` | Classical probability & Shannon entropy | 0 | — | — | good |

Folds:
- `matrices-unitaries` — Hermitian operators, spectral decomposition, why eigenvalues are the measurable things
- `classical-probability-entropy` — conditional entropy, mutual information

---

### 3.2 quantum-core

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `stern-gerlach` | Stern–Gerlach & the discovery of spin | 1 | `complex-amplitudes-bloch` | `measurement-born-rule` | core |
| `superposition-parallelism` | Superposition & quantum parallelism | 1 | `dirac-notation`, `complex-amplitudes-bloch` | — | core |
| `interference-mach-zehnder` | Interference & the Mach–Zehnder interferometer | 1 | `superposition-parallelism` | — | core |
| `measurement-born-rule` | Measurement, the Born rule & basis choice | 1 | `superposition-parallelism`, `matrices-unitaries` | — | core |
| `density-matrices` | Mixed states, density matrices & partial trace | 2 | `measurement-born-rule`, `tensor-products` | — | good |
| `no-cloning` | No-cloning theorem | 2 | `superposition-parallelism`, `matrices-unitaries` | — | prose |
| `quantum-entropies` | Quantum entropies: von Neumann, Rényi, min-entropy | 2 | `classical-probability-entropy`, `density-matrices` | — | good |
| `hamming-distance-weight` | Hamming distance & weight | 1 | `classical-probability-entropy` | — | good |
| `purity-swap-test` | Purity & the SWAP test | 3 | `density-matrices`, `two-qubit-gates` | `entanglement-measures` | core |

Folds:
- `superposition-parallelism` — why parallelism alone is not speedup
- `measurement-born-rule` — complementarity, conjugate bases, projective measurement
- `density-matrices` — partial trace, reduced states
- `quantum-entropies` — min-entropy feeds `qrng`; Rényi feeds privacy amplification in `qkd-overview`
- `purity-swap-test` — Tr(ρ²), purity testing

---

### 3.3 gates

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `single-qubit-gates` | Single-qubit gates & rotations | 1 | `matrices-unitaries`, `complex-amplitudes-bloch` | — | core |
| `two-qubit-gates` | Two-qubit gates & entangling operations | 2 | `single-qubit-gates`, `tensor-products` | — | core |
| `circuits-universality` | Circuits: composition, universality, reversibility | 3 | `two-qubit-gates` | — | core |
| `phase-kickback` | Phase kickback | 3 | `two-qubit-gates`, `single-qubit-gates` | — | core |

Folds:
- `single-qubit-gates` — Pauli, Hadamard, phase, parameterized rotations
- `circuits-universality` — gate sets, reversibility, embedding classical logic
- `phase-kickback` — the shared mechanism behind every oracle algorithm; referenced by `deutsch`, `grover`, `qpe`

---

### 3.4 entanglement

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `entangled-states-bell-basis` | Entangled states & the Bell basis | 3 | `two-qubit-gates`, `tensor-products` | — | core |
| `epr-paradox` | EPR paradox & hidden variables | 4 | `entangled-states-bell-basis` | `stern-gerlach` | prose |
| `chsh-nonlocality` | CHSH & nonlocality | 5 | `epr-paradox`, `measurement-born-rule` | — | core |
| `multipartite-nonlocality` | Multipartite nonlocality: GHZ, Mermin, Svetlichny | 6 | `chsh-nonlocality` | `cluster-graph-states` | good |
| `entanglement-measures` | Entanglement measures | 4 | `entangled-states-bell-basis`, `density-matrices`, `quantum-entropies` | — | good |
| `entanglement-detection` | Entanglement detection: witnesses & PPT | 5 | `entanglement-measures`, `density-matrices` | — | core |
| `monogamy-distributed-entanglement` | Monogamy & distributed entanglement | 6 | `entanglement-measures` | `qkd-overview` | good |

Folds:
- `entangled-states-bell-basis` — Bell measurement, product vs entangled
- `epr-paradox` — local realism, elements of reality
- `chsh-nonlocality` — Tsirelson bound
- `multipartite-nonlocality` — GHZ argument, MABK, Svetlichny. **SASA is NOT here** — it is stabilizer-derived and cluster-state-specific, see `cluster-graph-states`
- `entanglement-measures` — Werner states, fidelity, concurrence, entanglement of formation
- `entanglement-detection` — Peres–Horodecki / PPT, Horodecki criterion, entanglement witnesses

⚠️ This is the heaviest and most technical cluster. `multipartite-nonlocality`,
`entanglement-detection` and `cluster-graph-states` are the three nodes most likely
to drift past the intro-level contract while being written. Keep watch.

---

### 3.5 platforms

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `polarization-photonic-encoding` | Polarization & photonic encoding | 2 | `complex-amplitudes-bloch`, `measurement-born-rule` | — | core |
| `photodetection-detectors` | Photodetection & detectors | 2 | `measurement-born-rule` | `polarization-photonic-encoding` | good |
| `interaction-free-measurement` | Interaction-free measurement: the Elitzur–Vaidman bomb tester | 2 | `interference-mach-zehnder`, `measurement-born-rule` | — | core |
| `squeezed-light` | Squeezed light basics | 2 | `complex-amplitudes-bloch`, `measurement-born-rule` | — | good |
| `quantum-sensing-metrology` | Quantum sensing & metrology | 3 | `squeezed-light`, `interference-mach-zehnder` | — | good |

Folds:
- `quantum-sensing-metrology` — standard quantum limit vs Heisenberg limit
- `polarization-photonic-encoding` — feeds `bb84`; absorbs the polarization-optics intuition that would otherwise need its own node

⚠️ `squeezed-light` was cut once for low confidence, then restored. Keep it at
"what squeezing is + the uncertainty tradeoff picture" and let the bio-imaging
project on the Projects page carry anything deeper.

---

### 3.6 noise

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `decoherence-t1-t2` | Decoherence, T1 and T2 | 3 | `density-matrices` | — | core |
| `quantum-channels-kraus` | Quantum channels: Kraus operators & noise models | 4 | `decoherence-t1-t2`, `density-matrices` | — | core |
| `enaqt` | ENAQT — environment-assisted transport | 5 | `quantum-channels-kraus`, `decoherence-t1-t2` | — | core |

Folds:
- `quantum-channels-kraus` — depolarizing, dephasing, amplitude damping; fidelity & distance measures

⚠️ Lindblad was cut. `enaqt` therefore needs a simpler dephasing-rate transport
model rather than a full master equation. **Decide the model before writing the node.**
This is the highest-differentiation node on the map — nobody else's portfolio has it.

---

### 3.7 algorithms

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `oracles-query-complexity` | Oracles & query complexity | 4 | `circuits-universality` | — | good |
| `deutsch` | Deutsch's algorithm | 5 | `oracles-query-complexity`, `phase-kickback` | — | core |
| `deutsch-jozsa` | Deutsch–Jozsa | 6 | `deutsch` | — | core |
| `bernstein-vazirani` | Bernstein–Vazirani | 6 | `deutsch-jozsa` | — | core |
| `simons-algorithm` | Simon's algorithm | 7 | `bernstein-vazirani` | `shors-algorithm` | good |
| `qft` | Quantum Fourier Transform | 4 | `circuits-universality`, `complex-amplitudes-bloch` | — | core |
| `qpe` | Quantum phase estimation | 5 | `qft`, `phase-kickback` | — | core |
| `grover` | Grover search | 5 | `oracles-query-complexity`, `phase-kickback` | — | core |
| `hhl` | HHL linear solver | 6 | `qpe`, `matrices-unitaries` | `vqls` | good |

Folds:
- `grover` — amplitude amplification, the geometric rotation picture
- `simons-algorithm` — period finding as the bridge to Shor

---

### 3.8 variational

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `ansatz-design` | Ansatz design | 4 | `circuits-universality`, `single-qubit-gates` | — | core |
| `vqe` | The variational principle & VQE | 5 | `ansatz-design`, `measurement-born-rule` | — | core |
| `vqls` | VQLS — variational linear solver | 6 | `vqe` | — | good |
| `qaoa` | QAOA | 6 | `vqe`, `ansatz-design`, `qubo-ising-mapping` | `adiabatic-annealing` | core |

Folds:
- `ansatz-design` — expressibility, entangling layers, hardware-efficient vs problem-inspired

⚠️ Do **not** use the phrase "barren plateau" in `ansatz-design` unless the
interactive actually demonstrates system-size scaling. Otherwise describe the
flat-landscape symptom without the label.

---

### 3.9 optimization

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `combinatorial-optimization-primer` | Combinatorial optimization primer | 0 | — | — | core |
| `ising-spin-glasses` | Ising model & spin glasses | 2 | `combinatorial-optimization-primer` | — | core |
| `qubo-ising-mapping` | QUBO formulation & the Ising mapping | 3 | `ising-spin-glasses`, `combinatorial-optimization-primer` | — | core |
| `penalty-methods` | Encoding constraints: penalty methods | 4 | `qubo-ising-mapping` | — | core |
| `problem-library` | Problem library: Max-Cut, knapsack, TSP | 5 | `penalty-methods`, `qubo-ising-mapping` | — | core |
| `adiabatic-annealing` | Adiabatic theorem & quantum annealing | 5 | `ising-spin-glasses`, `qubo-ising-mapping` | — | good |
| `optimization-in-practice` | Optimization in practice | 8 | `qaoa`, `adiabatic-annealing`, `problem-library` | — | prose |

Folds:
- `penalty-methods` — Lucas 2014 closed-form bounds
- `problem-library` — the standard NP-hard mappings

Note: `combinatorial-optimization-primer` is a classical root. It sits at ring 0
as a **second entry point** to the graph, not under the quantum foundations.

---

### 3.10 communication

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `superdense-coding` | Superdense coding | 4 | `entangled-states-bell-basis`, `two-qubit-gates` | `quantum-teleportation` | core |
| `quantum-teleportation` | Quantum teleportation | 4 | `entangled-states-bell-basis`, `measurement-born-rule`, `no-cloning` | — | core |
| `gate-teleportation` | Gate teleportation | 5 | `quantum-teleportation` | `stabilizer-formalism` | good |
| `entanglement-generation-heralding` | Entanglement generation & heralding | 4 | `entangled-states-bell-basis`, `photodetection-detectors` | — | good |
| `entanglement-swapping` | Entanglement swapping | 5 | `quantum-teleportation`, `entanglement-generation-heralding` | — | core |
| `entanglement-purification` | Entanglement purification | 6 | `entanglement-measures`, `quantum-channels-kraus` | `entanglement-swapping` | core |
| `repeaters-network-architecture` | Repeaters & network architecture | 7 | `entanglement-swapping`, `entanglement-purification` | — | core |
| `networks-in-practice` | Networks in practice | 8 | `repeaters-network-architecture` | — | prose |

Note: the quantum-internet material was cut. `repeaters-network-architecture`
stops at architecture and does not make forward-looking internet claims.

---

### 3.11 cryptography

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `classical-key-exchange-rsa` | Classical key exchange & RSA | 0 | — | — | core |
| `shors-algorithm` | Shor's algorithm | 7 | `qpe`, `qft`, `classical-key-exchange-rsa` | — | core |
| `qrng` | QRNG | 3 | `measurement-born-rule`, `quantum-entropies` | — | core |
| `qkd-overview` | QKD overview | 4 | `no-cloning`, `classical-key-exchange-rsa`, `measurement-born-rule` | — | prose |
| `bb84` | BB84 | 5 | `qkd-overview`, `polarization-photonic-encoding`, `no-cloning` | — | core |
| `e91` | E91 | 6 | `qkd-overview`, `chsh-nonlocality`, `entangled-states-bell-basis` | — | core |
| `eavesdropping-intercept-resend` | Eavesdropping & intercept–resend | 6 | `bb84` | — | core |
| `di-mdi-qkd` | DI-QKD & MDI-QKD | 7 | `e91`, `chsh-nonlocality`, `entanglement-detection` | — | good |
| `qkd-in-practice` | QKD in practice | 8 | `bb84`, `e91`, `di-mdi-qkd` | — | prose |

Folds:
- `bb84` — B92 as a two-state variant
- `e91` — BBM92 as the entanglement-based variant without the Bell test
- `qkd-overview` — sifting, reconciliation, privacy amplification, QBER

⚠️ Finite-key analysis was cut. `qkd-overview` and `qkd-in-practice` must
therefore state assumptions explicitly (asymptotic key rates, trusted devices)
rather than implying unconditional security. One sentence each is enough.

---

### 3.12 qec

| id | title | ring | prereq | related | sim |
|---|---|---|---|---|---|
| `classical-error-correction` | Classical error correction primer | 2 | `hamming-distance-weight` | — | core |
| `bit-flip-phase-flip-codes` | Bit-flip & phase-flip codes | 4 | `classical-error-correction`, `two-qubit-gates`, `quantum-channels-kraus` | — | core |
| `shor-9-qubit-code` | Shor's 9-qubit code | 5 | `bit-flip-phase-flip-codes` | — | core |
| `stabilizer-formalism` | Stabilizer formalism | 6 | `shor-9-qubit-code`, `two-qubit-gates` | — | core |
| `cluster-graph-states` | Cluster & graph states | 7 | `stabilizer-formalism`, `entangled-states-bell-basis` | — | good |
| `qec-applications-outlook` | Applications & outlook | 8 | `stabilizer-formalism` | — | prose |

Folds:
- `classical-error-correction` — repetition codes, parity checks, uses `hamming-distance-weight`
- `cluster-graph-states` — SASA inequality (Scarani, Acín, Schenck, Aspelmeyer, *PRA* **71**, 042325, 2005): stabilizer-derived, maximally violated by the 4-qubit cluster state, not violated by 4-qubit GHZ, and outside the Mermin/MABK family (one party uses a single measurement setting)

⚠️ Syndrome measurement, surface codes and thresholds were all cut. That leaves
`stabilizer-formalism` describing a formalism with no operation attached.
**Open decision:** either let it carry one minimal syndrome example, or end the
teaching branch at `shor-9-qubit-code` and let the QEC *tool* own everything above.

⚠️ `qec-applications-outlook` is marked optional — the thinnest of the four
"in practice" nodes. Cut if it stays thin.

---

## 4. Cross-cluster edges

These are the edges that keep the graph from being separate limbs off a core.
Listed here for review; each is already declared once in the tables above.

| from | to | type | why it matters |
|---|---|---|---|
| `no-cloning` → `qkd-overview` | prereq | The load-bearing reason QKD works at all |
| `chsh-nonlocality` → `e91` | prereq | Bell test as the security primitive |
| `entanglement-detection` → `di-mdi-qkd` | prereq | Device-independence rests on detection |
| `quantum-teleportation` → `entanglement-swapping` | prereq | Swapping is teleportation of half a pair |
| `quantum-channels-kraus` → `entanglement-purification` | prereq | Purification needs a noise model |
| `qpe` → `hhl` | prereq | Eigenvalue extraction is the whole algorithm |
| `qpe` → `shors-algorithm` | prereq | Fixes the Shor-without-QPE gap |
| `qubo-ising-mapping` → `qaoa` | prereq | The cost Hamiltonian comes from here |
| `stabilizer-formalism` → `cluster-graph-states` | prereq | Stabilizers define the state |
| `cluster-graph-states` ⇢ `multipartite-nonlocality` | related | SASA; **the only bridge between the QEC and entanglement branches** |
| `hhl` ⇢ `vqls` | related | Fault-tolerant vs variational route to the same problem |
| `qaoa` ⇢ `adiabatic-annealing` | related | QAOA as a trotterized adiabatic path |
| `gate-teleportation` ⇢ `stabilizer-formalism` | related | Where teleportation meets fault tolerance |
| `superdense-coding` ⇢ `quantum-teleportation` | related | Dual protocols; one classical→quantum, one reverse |
| `purity-swap-test` ⇢ `entanglement-measures` | related | Same machinery, different question |
| `simons-algorithm` ⇢ `shors-algorithm` | related | Period finding precursor |
| `monogamy-distributed-entanglement` ⇢ `qkd-overview` | related | Why an eavesdropper cannot share the correlation |
| `stern-gerlach` ⇢ `measurement-born-rule` | related | Historical route into the same idea |
| `photodetection-detectors` ⇢ `polarization-photonic-encoding` | related | Paired for the BB84 implementation picture |
| `epr-paradox` ⇢ `stern-gerlach` | related | Spin-½ is the standard EPR setting |

---

## 5. Tool handoffs

Tools and Learn are **separate deliverables**. Neither reduces the other. These
are one-way links out, rendered differently from graph edges — not as nodes.

| node | links to |
|---|---|
| `qaoa` | QUBO/QAOA Workbench |
| `penalty-methods` | QUBO/QAOA Workbench (constraint encoding step) |
| `problem-library` | QUBO/QAOA Workbench (problem presets) |
| `stabilizer-formalism` | QEC tool |
| `shor-9-qubit-code` | QEC tool |

---

## 6. Entry points

Three roots, deliberately. The graph has more than one way in.

1. `complex-amplitudes-bloch` / `dirac-notation` — the quantum-maths entry
2. `combinatorial-optimization-primer` — the classical-optimization entry
3. `classical-key-exchange-rsa` — the security entry

`classical-probability-entropy` and `hamming-distance-weight` are shared
classical supports feeding several branches.

---

## 7. Build notes

- **Layout must be deterministic.** No force-directed physics — the graph should
  settle identically on every load.

  > **Superseded during implementation.** The graph is a layered, top-to-bottom
  > diagram, not a radial one, and the level of a node is *computed* from the
  > prerequisite DAG rather than taken from `ring`. `ring` is left in the tables
  > above exactly as written, but nothing renders from it: it is not a valid
  > layering (`interference-mach-zehnder` shares ring 1 with its own
  > prerequisite `superposition-parallelism`, and `quantum-entropies` shares
  > ring 2 with `density-matrices`). Reconciling the two is a content decision
  > and is still open.
- **SVG with real DOM nodes**, not canvas. At 76 nodes there is no performance
  argument for canvas, and DOM gives keyboard focus and screen-reader labels for
  free. Canvas would regress against the existing accessibility panel.
- **Mobile fallback** is a grouped list by cluster, not a pinch-zoom graph.
- **Progress** in localStorage lights up visited nodes. It gates nothing.
- **Contract line** near the graph, visible before any node is opened:
  topics worked with, explained at an introductory level. This is what makes a
  modest QAOA node read as a choice rather than a mismatch.
- Validate at build: no `prereq` cycles, every id referenced exists, every
  `related` edge declared exactly once.

---

## 8. Open decisions

1. `stabilizer-formalism` — minimal syndrome example, or end the branch at
   `shor-9-qubit-code`?
2. `enaqt` — which simplified transport model, now that Lindblad is out?
3. MBQC / one-way computing — ride along on `cluster-graph-states`, or stay out?
   Currently out; the node title accommodates it either way.
4. `qec-applications-outlook` — keep or cut?
5. Interactive runtime: JS by default, precomputed JSON for parameter sweeps.
   Pyodide only if a node genuinely needs users writing Python — note that
   PennyLane and Qiskit do not run under it.
6. Doodle style — pilot three before committing. 76 drawings is the real
   bottleneck, not the prose.

---

## 9. Counts

| tier | count |
|---|---|
| `sim: core` | 44 |
| `sim: good` | 22 |
| `sim: prose` | 10 |

44 core interactives is a large commitment. Expect to demote some to `good` or
`prose` on contact with the actual build. The four "in practice" nodes and
`qkd-overview` are already prose-only by design.

> **Build note, added during implementation:** the tiers as actually written in
> the §3 tables come out at **core 47 / good 22 / prose 7**, not 44 / 22 / 10.
> The tables are the locked source of truth and were transcribed unchanged, so
> this table is the stale one. Left as written rather than silently corrected —
> it is a content decision which way it gets reconciled.
