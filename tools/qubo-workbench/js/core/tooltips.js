/* ============================================================================
   tooltips.js — inline hover/focus definitions.

   One data map, and markup opts in with a single attribute:

       <span data-def="penalty">penalty λ</span>

   Every definition is reachable by KEYBOARD as well as by pointer: the term
   becomes a real <button>, so Tab reaches it, Enter and Space open it, Escape
   closes it. A definition that only exists on hover is a definition half the
   readers cannot get to.

   Nothing here is fetched. The map below is the whole vocabulary.
   ============================================================================ */

export const DEFINITIONS = {
  qubo: {
    term: 'QUBO',
    text: 'Quadratic Unconstrained Binary Optimization. One matrix over 0/1 variables whose ' +
      'minimum is the answer to your problem. "Unconstrained" is a promise about the FORM, not ' +
      'the problem: constraints are still there, folded in as penalties.'
  },
  ising: {
    term: 'Ising',
    text: 'The same energy written over spins s = ±1 instead of bits y = 0/1, via s = 2y − 1. ' +
      'It is a change of variables, not a different problem — but it is the form a quantum device ' +
      'or simulator actually takes.'
  },
  penalty: {
    term: 'penalty λ',
    text: 'The weight on a constraint term. Large enough, and breaking the constraint can never ' +
      'pay for itself, so the lowest-energy assignment is guaranteed to be a legal one. Each ' +
      'problem here has a published closed-form bound for how large "large enough" is.'
  },
  bound: {
    term: 'safe bound',
    text: 'The value of λ above which the formulation is provably correct, from Lucas (2014). ' +
      'It is sufficient, not tight: a smaller λ often still works on a particular instance, but ' +
      'only by luck of that instance\'s numbers.'
  },
  slack: {
    term: 'slack variable',
    text: 'An extra variable that turns an inequality into an equality. "Weight at most 5" ' +
      'becomes "weight plus slack equals exactly 5", which is something a quadratic form can ' +
      'express. The slack bits are why a knapsack needs more qubits than it has items.'
  },
  ancilla: {
    term: 'ancilla qubit',
    text: 'A qubit that is not part of the answer — it exists to make the encoding work. Slack ' +
      'bits are ancillas. They cost exactly as much to simulate as the ones you care about, ' +
      'which is why the ledger counts them separately.'
  },
  onehot: {
    term: 'one-hot',
    text: 'A group of variables where exactly one must be on. "This vertex takes exactly one ' +
      'colour" is one-hot across the colours. It is enforced by the penalty A·(1 − Σ y)², which ' +
      'is zero when exactly one is on and positive otherwise.'
  },
  offset: {
    term: 'constant offset',
    text: 'A number added to every energy. It changes nothing about WHICH assignment is lowest, ' +
      'so it is easy to drop — and dropping it silently shifts every value the tool and the ' +
      'generated code print, by the same amount, until they disagree.'
  },
  costHamiltonian: {
    term: 'cost Hamiltonian',
    text: 'The operator whose lowest-energy state is your answer. In QAOA it is applied as a ' +
      'phase: states with lower cost pick up a different phase from states with higher cost.'
  },
  mixerHamiltonian: {
    term: 'mixer Hamiltonian',
    text: 'The other half of a QAOA layer — a rotation on every qubit that moves amplitude ' +
      'between bitstrings. Without it the phases would never turn into probabilities.'
  },
  qaoa: {
    term: 'QAOA',
    text: 'Quantum Approximate Optimization Algorithm. Alternate the cost and mixer Hamiltonians ' +
      'p times, tune the 2p angles classically, and measure. It returns a distribution over ' +
      'answers, not an answer.'
  },
  depth: {
    term: 'depth p',
    text: 'How many cost-then-mixer layers the circuit has. More layers means more parameters ' +
      'and, usually, better results — and no honest two-dimensional picture of the landscape, ' +
      'because there are more than two parameters to picture.'
  },
  approximationRatio: {
    term: 'approximation ratio',
    text: 'How far along the road from the worst assignment to the best the circuit lands, on ' +
      'average. 1.0 is the ground state every time; 0.0 is the worst. Both ends come from the ' +
      'exhaustive search, which is why the number exists only below the qubit cap.'
  },
  groundState: {
    term: 'ground state',
    text: 'The lowest-energy assignment — the actual answer to the problem, once the ' +
      'formulation is right. Found here by checking all 2ⁿ of them, which is exactly why there ' +
      'is a cap.'
  },
  flatRegion: {
    term: 'flat region',
    text: 'Part of the landscape where the gradient is nearly zero, so an optimizer starting ' +
      'there has almost nothing to follow. This tool maps flatness for one instance at one size; ' +
      'it does not measure how flatness scales with qubit count, so it does not make claims ' +
      'about that.'
  },
  energyScale: {
    term: 'energy-scale separation',
    text: 'How far apart the largest and smallest coefficients are. When they span orders of ' +
      'magnitude the small ones are swamped: on hardware they vanish into noise, and an ' +
      'optimizer only ever sees the large ones. A signal that an instance will be hard.'
  },
  statevector: {
    term: 'statevector',
    text: 'The full description of an n-qubit state: 2ⁿ complex numbers, 16 bytes each. Twenty ' +
      'qubits is 16 MB; thirty is 16 GB. That doubling is the whole reason for the cap.'
  },
  bruteForce: {
    term: 'brute force',
    text: 'Evaluating the energy of every one of the 2ⁿ assignments and keeping the lowest. ' +
      'Slow but certain — it is what lets the tool say "this formulation recovers the true ' +
      'optimum" rather than "nothing looks wrong".'
  }
};

const OPEN_CLASS = 'wb-def-open';

/**
 * Upgrades every [data-def] in `root` into a keyboard-reachable definition.
 * Safe to call repeatedly; already-upgraded terms are skipped.
 */
export function attachTooltips(root) {
  const scope = root || document;
  for (const node of scope.querySelectorAll('[data-def]')) {
    if (node.dataset.defReady === 'true') continue;
    const entry = DEFINITIONS[node.dataset.def];
    if (!entry) continue;                       // an unknown key stays plain text
    upgrade(node, entry);
  }
}

function upgrade(node, entry) {
  node.dataset.defReady = 'true';
  node.classList.add('wb-def');
  /* A real button, so it is in the tab order and announces itself. */
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-expanded', 'false');
  node.setAttribute('aria-label', entry.term + ' — definition');

  const bubble = document.createElement('span');
  bubble.className = 'wb-def-bubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  const strong = document.createElement('b');
  strong.textContent = entry.term;
  bubble.appendChild(strong);
  bubble.appendChild(document.createTextNode(' ' + entry.text));
  node.appendChild(bubble);

  const open = () => {
    closeAll();
    bubble.hidden = false;
    node.classList.add(OPEN_CLASS);
    node.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    bubble.hidden = true;
    node.classList.remove(OPEN_CLASS);
    node.setAttribute('aria-expanded', 'false');
  };

  node.addEventListener('mouseenter', open);
  node.addEventListener('mouseleave', close);
  node.addEventListener('focus', open);
  node.addEventListener('blur', close);
  node.addEventListener('click', (e) => {
    e.preventDefault();
    if (bubble.hidden) open(); else close();
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (bubble.hidden) open(); else close();
    } else if (e.key === 'Escape' && !bubble.hidden) {
      e.preventDefault();
      close();
    }
  });
}

function closeAll() {
  for (const open of document.querySelectorAll('.' + OPEN_CLASS)) {
    open.classList.remove(OPEN_CLASS);
    open.setAttribute('aria-expanded', 'false');
    const bubble = open.querySelector('.wb-def-bubble');
    if (bubble) bubble.hidden = true;
  }
}

/** The terms this build defines — used by the tests to keep the map honest. */
export function definedTerms() { return Object.keys(DEFINITIONS); }
