/* ============================================================================
   pipeline.js — step orchestration.

   Four steps, one model. This module owns:
     * which step is on screen,
     * which steps are reachable for the current model,
     * the cap banner and the size readout that sit above all of them.

   It owns no mathematics. Steps register themselves with `registerStep()` and
   are handed the model when they become current, so a step's own module never
   has to know the rail exists.

   The cap rule (CLAUDE.md constraint 5) is applied in exactly one place here —
   `reachable()` — and nowhere else:
     Step 1 Formulate  always
     Step 2 Ising      needs a model; cheap at any size, so never capped
     Step 3 Analyze    needs a model AND <= QUBIT_CAP qubits
     Step 4 Code       needs a model; NEVER capped — it is the over-limit offering

   A step also stays locked until its own module registers an implementation, so
   a half-built step is a visibly closed door rather than an empty room.
   ============================================================================ */

import { capLevel } from '../core/qubo.js?v=1';
import { verify } from '../core/verify.js?v=1';
import {
  makeSimulator, analyticObjective, optimize, optimizerIds, OPTIMIZERS,
  rampFor, randomStartFor, landscapeP1, gradientMapP1, symmetryNote, distribution,
  ratioVsP, sensitivity, energyScale
} from '../core/analysis.js?v=1';
import {
  viewOptimizers, viewRatio, viewDistribution, viewLandscape,
  viewInitialization, viewSensitivity, viewFlatness, viewScale
} from './charts.js?v=1';
import { generate, PENNYLANE_VERSION } from '../core/codegen.js?v=1';
import * as save from '../core/save.js?v=1';
import { attachTooltips } from '../core/tooltips.js?v=1';
import { withinCap } from '../core/qubo.js?v=1';
import { renderSizeReadout, renderBoundaryNotice, renderLedger, renderMatrix, renderVerdict, renderIsing, renderCodegen } from './render.js?v=1';
import { initForm } from './input-form.js?v=1';
import { initGraph } from './input-graph.js?v=1';
import { PROBLEM_LIST } from '../core/problems.js?v=1';
import { el, clear, bitsToStringFor } from './render.js?v=1';

export const STEPS = [
  { id: 1, key: 'formulate', title: 'Formulate', sub: 'problem → QUBO' },
  { id: 2, key: 'ising', title: 'Ising form', sub: 'QUBO → H' },
  { id: 3, key: 'analyze', title: 'Analyze', sub: 'landscape · optimizers' },
  { id: 4, key: 'code', title: 'PennyLane code', sub: 'take it away' }
];

const state = {
  model: null,
  problem: null,
  analysis: null,          // what Step 3 found, for Step 4 to embed
  step: 1,
  handlers: new Map(),      // id -> {panel, onEnter}
  nodes: null
};

/** The current model, or null before Step 1 has produced one. */
export function getModel() { return state.model; }

/** The template currently selected in Step 1. */
export function getProblem() { return state.problem; }

/** Why a step is (not) reachable. Returns null when it is. */
function blockedReason(id) {
  const h = state.handlers.get(id);
  if (!h || !h.implemented) return 'This step lands in a later build.';
  if (id === 1) return null;
  if (!state.model) return 'Build a QUBO in Step 1 first.';
  if (id === 3 && capLevel(state.model.meta.qubitCount) === 'over') {
    return state.model.meta.qubitCount + ' qubits is above the ' +
      'in-browser limit — simulation and landscape analysis are off. Step 4 still works.';
  }
  return null;
}

/**
 * A step module calls this once at load.
 * @param {number} id
 * @param {HTMLElement} panel the section this step shows
 * @param {(model:object)=>void} [onEnter] called each time the step becomes current
 * @param {{implemented?:boolean}} [opts] implemented:false leaves the step locked
 */
export function registerStep(id, panel, onEnter, opts) {
  state.handlers.set(id, {
    panel: panel,
    onEnter: onEnter || null,
    implemented: !opts || opts.implemented !== false
  });
}

/* ----------------------------------------------------------------- scrolling
   Changing step changes the whole page under you. Landing part-way down the new
   panel — wherever the last one happened to leave the scroll position — makes it
   feel like nothing happened, so every step change puts you at the top of the
   step you asked for.

   `.wb-panel` carries scroll-margin-top, so the sticky top bar never covers the
   heading we just scrolled to.                                               */

/** Whether to animate. Honours the same preference the rest of the site does. */
function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}

/** Put the top of `panel` at the top of the viewport. */
function scrollToPanel(panel) {
  if (!panel || typeof panel.scrollIntoView !== 'function') return;
  try {
    panel.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch (e) {
    panel.scrollIntoView(true);                 // older signature
  }
}

/** The panel currently on screen. */
function currentPanel() {
  const h = state.handlers.get(state.step);
  return h ? h.panel : null;
}

/* ------------------------------------------------------- the step-end nav --
   One row at the foot of every panel: back to the previous step, on to the
   next. The rail at the top does the same job for someone who knows where they
   are going; this is for someone who has just finished reading a step and wants
   the obvious thing to do next to be in front of them.                       */

function stepLabel(id) {
  const step = STEPS.find((s) => s.id === id);
  return step ? step.title : 'Step ' + id;
}

function buildStepNav(id) {
  const panel = document.getElementById('panel-' + id);
  if (!panel) return null;
  const body = panel.querySelector('.wb-panel-body') || panel;

  const nav = el('div', { class: 'wb-stepnav', 'aria-label': 'Move between steps' });
  const prevId = id - 1, nextId = id + 1;

  if (STEPS.some((s) => s.id === prevId)) {
    const prev = el('button', { class: 'wb-btn', type: 'button', 'data-nav': 'prev' },
      ['← ' + stepLabel(prevId)]);
    prev.setAttribute('aria-label', 'Previous step: ' + stepLabel(prevId));
    prev.addEventListener('click', () => goTo(prevId));
    nav.appendChild(prev);
  } else {
    nav.appendChild(el('span', { class: 'wb-stepnav-gap', 'aria-hidden': 'true' }));
  }

  if (STEPS.some((s) => s.id === nextId)) {
    const next = el('button', { class: 'wb-btn primary', type: 'button', 'data-nav': 'next' },
      [stepLabel(nextId) + ' →']);
    next.setAttribute('aria-label', 'Next step: ' + stepLabel(nextId));
    next.addEventListener('click', () => goTo(nextId));
    nav.appendChild(next);
  } else {
    /* the last step has nowhere onward, so it offers the way back to the start */
    const restart = el('button', { class: 'wb-btn', type: 'button', 'data-nav': 'restart' },
      ['↑ Back to Step 1']);
    restart.setAttribute('aria-label', 'Back to step 1: ' + stepLabel(1));
    restart.addEventListener('click', () => goTo(1));
    nav.appendChild(restart);
  }

  body.appendChild(nav);
  return nav;
}

/** Keep each nav's buttons in step with what is actually reachable. */
function refreshStepNavs() {
  for (const [id, h] of state.handlers) {
    const nav = h.panel.querySelector('.wb-stepnav');
    if (!nav) continue;
    for (const btn of nav.querySelectorAll('button[data-nav]')) {
      const target = btn.dataset.nav === 'prev' ? id - 1 : (btn.dataset.nav === 'next' ? id + 1 : 1);
      const why = blockedReason(target);
      btn.disabled = !!why;
      if (why) btn.title = why; else btn.removeAttribute('title');
    }
  }
}

/* --------------------------------------------------- the corner control ----
   A step can be several screens long. This sits out of the way until you have
   scrolled past the top of one, and takes you back to the start of the step you
   are in — not the top of the document, which would be the rail you have
   already used.                                                              */

function buildTopButton() {
  const btn = el('button', {
    class: 'wb-totop', type: 'button', id: 'wbToTop', hidden: true,
    title: 'Back to the start of this step'
  }, [
    el('span', { 'aria-hidden': 'true', text: '↑' }),
    el('span', { class: 'wb-totop-text', text: 'Top of this step' })
  ]);
  btn.setAttribute('aria-label', 'Scroll to the start of this step');
  btn.addEventListener('click', () => {
    const panel = currentPanel();
    scrollToPanel(panel);
    /* Move the keyboard there too, or a keyboard user is returned visually and
       left behind in the tab order. */
    if (panel && panel.focus) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true }); }
  });
  document.body.appendChild(btn);

  if (typeof window === 'undefined' || !window.addEventListener) return btn;

  let queued = false;
  const update = () => {
    queued = false;
    const panel = currentPanel();
    if (!panel || typeof panel.getBoundingClientRect !== 'function') return;
    /* show it once the step's heading has gone off the top of the screen */
    btn.hidden = panel.getBoundingClientRect().top > -80;
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
    else setTimeout(update, 50);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  state.refreshTopButton = update;
  return btn;
}

/** Show a step. Silently refuses if it is blocked (the rail already says why). */
export function goTo(id) {
  if (blockedReason(id)) return false;
  state.step = id;
  for (const [sid, h] of state.handlers) h.panel.hidden = sid !== id;
  refreshRail();
  const h = state.handlers.get(id);
  if (h && h.onEnter) h.onEnter(state.model);
  if (h) {
    /* Focus first WITHOUT moving the page, then scroll deliberately — so the
       keyboard and the viewport end up in the same place, and the scroll is ours
       rather than whatever focus() decides to do. Every route into a step comes
       through here: the rail, the step-end nav, and a loaded save code. */
    h.panel.setAttribute('tabindex', '-1');
    h.panel.focus({ preventScroll: true });
    scrollToPanel(h.panel);
  }
  if (state.refreshTopButton) state.refreshTopButton();
  return true;
}

/**
 * Step 1 calls this whenever it has built (or loaded) a model. Everything
 * downstream — the readout, the banner, which steps unlock — falls out of it.
 */
export function setModel(model) {
  state.model = model;
  state.analysis = null;             // a new model invalidates Step 3's findings
  const n = model ? model.meta.qubitCount : 0;
  if (state.nodes) {
    state.nodes.size.hidden = !model;
    if (model) renderSizeReadout(state.nodes.size, model);
    renderBoundaryNotice(state.nodes.notice, n);
    if (!model) state.step = 1;
  }
  refreshRail();
  return model;
}

function refreshRail() {
  if (!state.nodes) return;
  for (const btn of state.nodes.rail.querySelectorAll('.wb-step')) {
    const id = Number(btn.dataset.step);
    const why = blockedReason(id);
    btn.disabled = !!why;
    if (why) btn.title = why; else btn.removeAttribute('title');
    if (id === state.step) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
    btn.dataset.state = id < state.step && !why ? 'done' : '';
  }
  refreshStepNavs();
}

/* ------------------------------------------------------------------ step 1 --
   The form produces a model; everything else on the page is a view of it. The
   verdict is computed here rather than inside the form, so the form never has a
   say in whether its own output is correct.                                  */

/* 'set' is the same rows-table widget as 'form', with different columns — the
   two names distinguish a list of things from a thing with extra fields, not two
   implementations. */
const INPUT_MODES = { form: initForm, set: initForm, graph: initGraph };

function wireStep1() {
  const host = document.getElementById('wbForm');
  const picker = document.getElementById('wbProblems');
  if (!host || !picker) return;

  const out = {
    results: document.getElementById('wbResults'),
    matrix: document.getElementById('wbMatrix'),
    ledger: document.getElementById('wbLedger'),
    verdict: document.getElementById('wbVerdict'),
    constraint: document.getElementById('wbConstraint'),
  };

  function onBuild(model) {
    setModel(model);
    renderMatrix(out.matrix, model);
    renderLedger(out.ledger, model);
    renderVerdict(out.verdict, verify(model), model);
    out.results.hidden = false;
    out.results.setAttribute('tabindex', '-1');
    out.results.focus({ preventScroll: false });
    attachTooltips(out.results);
  }

  /** Swap the whole of Step 1 over to another template. */
  function selectProblem(problem) {
    state.problem = problem;
    for (const chip of picker.querySelectorAll('.wb-chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.problem === problem.id));
    }
    /* The previous model described a different problem, so everything
       downstream is stale: drop it rather than leave a matrix on screen that no
       longer matches the form above it. */
    setModel(null);
    out.results.hidden = true;
    clear(out.matrix); clear(out.ledger); clear(out.verdict);

    if (out.constraint) {
      clear(out.constraint);
      out.constraint.appendChild(el('b', { text: problem.title + ' — ' }));
      out.constraint.appendChild(document.createTextNode(
        problem.constraintText + '. Penalty: ' + problem.boundText + '.'));
    }

    const mount = INPUT_MODES[problem.inputMode] || initForm;
    mount(host, problem, onBuild);
  }

  registerStep(1, document.getElementById('panel-1'));

  for (const p of PROBLEM_LIST) {
    const chip = el('button', {
      class: 'wb-chip', type: 'button', 'aria-pressed': 'false', 'data-problem': p.id
    }, [el('b', { text: p.title }), el('span', { text: p.tagline })]);
    chip.addEventListener('click', () => selectProblem(p));
    picker.appendChild(chip);
  }

  selectProblem(PROBLEM_LIST[0]);
}

/* ------------------------------------------------------------------ step 2 --
   A bridge, not a feature: it redraws itself from whatever model is current, and
   holds no state of its own.                                                  */

function wireStep2() {
  const host = document.getElementById('wbIsing');
  if (!host) return;
  registerStep(2, document.getElementById('panel-2'), (model) => {
    if (!model) return;
    renderIsing(host, model);
    attachTooltips(host);
  });
}

/* ------------------------------------------------------------------ step 3 --
   Eight features, computed in the priority order they are presented in, each
   rendered the moment it is ready.

   The work is broken up and yielded between features rather than run in one
   block. At p=1 everything routes through the closed form and the whole set is
   near-instant even at the cap; the one genuinely expensive piece — the
   ratio-vs-p curve past p=1 — is offered rather than assumed above
   DEEP_P_LIMIT qubits. Yielding costs nothing and means the page never locks up
   on the instance that turns out to be the slow one.                          */

/** Hand the browser a frame back, so a long analysis never freezes the tab. */
function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

const OPT_ITERATIONS = 60;

function buildAnalysisSteps(model, ctx) {
  const { sim, objective } = ctx;
  const groundEnergy = sim.emin;
  const ramp = rampFor(model, 1);

  /* The landscape is the cheapest thing here and the most informative, so it is
     computed FIRST even though it is presented fourth: section 1 needs to know
     what the best p=1 parameters actually are before it can say whether an
     optimizer found them. */
  ctx.landscape = landscapeP1(model, { betaSteps: 96 });

  return [
    ['optimizers', () => {
      const runs = optimizerIds().map((id) => {
        const run = optimize(objective, {
          method: id, p: 1, init: ramp, iterations: OPT_ITERATIONS, seed: 7
        });
        return { ...run, label: OPTIMIZERS[id].label, note: OPTIMIZERS[id].note };
      });
      /* the best parameters ANY of them found, which is what the later sections
         report against */
      const winner = runs.reduce((a, b) => (b.best < a.best ? b : a));
      ctx.bestParams = winner.best <= ctx.landscape.best
        ? winner.bestParams
        : Float64Array.from([ctx.landscape.bestAt.gamma, ctx.landscape.bestAt.beta]);
      return viewOptimizers({ runs, groundEnergy, gridBest: ctx.landscape.best });
    }],

    ['ratio', () => {
      const points = ratioVsP(sim, model, { maxP: 1, iterations: OPT_ITERATIONS });
      ctx.ratioPoints = points;
      return viewRatio({
        points,
        qubitCount: sim.n,
        deeperAvailable: true
      });
    }],

    ['distribution', () => {
      const d = distribution(sim, ctx.bestParams, { bins: 24 });
      return viewDistribution({ ...d, topBits: bitsToStringFor(d.topZ, sim.n) });
    }],

    ['landscape', () => viewLandscape({ ...ctx.landscape, symmetry: symmetryNote(sim) })],

    ['initialization', () => {
      const starts = [
        { label: 'linear ramp', init: ramp },
        { label: 'random seed 1', init: randomStartFor(model, 1, 1) },
        { label: 'random seed 2', init: randomStartFor(model, 1, 2) },
        { label: 'random seed 3', init: randomStartFor(model, 1, 3) }
      ];
      const runs = starts.map((s) => ({
        label: s.label,
        ...optimize(objective, { method: 'adam', p: 1, init: s.init, iterations: OPT_ITERATIONS, seed: 7 })
      }));
      return viewInitialization({ runs, groundEnergy });
    }],

    ['sensitivity', () => viewSensitivity(sensitivity(objective, ctx.bestParams))],

    ['flatness', () => viewFlatness(gradientMapP1(model, { betaSteps: 96 }))],

    ['scale', () => viewScale(energyScale(model))]
  ];
}

async function runAnalysis(model, host, status) {
  clear(host);
  const sim = makeSimulator(model);
  const ctx = { sim, objective: analyticObjective(model), bestParams: rampFor(model, 1) };
  const steps = buildAnalysisSteps(model, ctx);

  for (let i = 0; i < steps.length; i++) {
    const [id, run] = steps[i];
    if (status) status.textContent = 'Working — ' + (i + 1) + ' of ' + steps.length + '…';
    await yieldToBrowser();
    const node = run();
    node.setAttribute('data-feature', id);
    host.appendChild(node);
    attachTooltips(node);
  }
  if (status) status.textContent = '';

  /* Publish what was found, so Step 4 embeds the parameters the visitor just
     watched being chosen rather than finding its own. */
  state.analysis = {
    model,
    params: Array.from(ctx.bestParams),
    expectation: sim.expectation(ctx.bestParams),
    optimum: sim.emin, worst: sim.emax
  };

  /* The deep-p curve is the only piece that is not free. It replaces its own
     section in place when asked for. */
  const button = host.querySelector('#wbDeeperP');
  if (button) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Working…';
      await yieldToBrowser();
      const points = ratioVsP(sim, model, { maxP: 3, iterations: 40 });
      const replacement = viewRatio({ points, qubitCount: sim.n, deeperAvailable: false });
      replacement.setAttribute('data-feature', 'ratio');
      const old = host.querySelector('[data-feature="ratio"]');
      if (old) old.parentNode.replaceChild(replacement, old);
    });
  }
}

function wireStep3() {
  const host = document.getElementById('wbAnalysis');
  if (!host) return;
  const status = document.getElementById('wbAnalysisStatus');
  const gate = document.getElementById('wbAnalysisGate');
  let shownFor = null;

  registerStep(3, document.getElementById('panel-3'), (model) => {
    if (!model) return;
    /* Every analysis here is gated behind the cap — that gate is in
       blockedReason(), so reaching this point already means we are under it. */
    if (gate) gate.hidden = true;
    if (shownFor === model) return;          // don't recompute on a revisit
    shownFor = model;
    runAnalysis(model, host, status);
  });
}

/* ------------------------------------------------------------------ step 4 --
   Never capped. Everything else in the tool may switch off with size; this must
   not, because above the cap it is the entire offering.                       */

/**
 * The parameters to write into the emitted program. Step 3 supplies them when it
 * has run; otherwise they are found here (cheap — p=1 has a closed form), and
 * above the cap there is nothing to find, so the ramp is emitted as a start.
 */
function codegenContext(model) {
  if (state.analysis && state.analysis.model === model) return state.analysis;
  if (!withinCap(model)) {
    return { model, params: Array.from(rampFor(model, 1)), expectation: undefined };
  }
  const sim = makeSimulator(model);
  const run = optimize(analyticObjective(model), {
    method: 'adam', p: 1, init: rampFor(model, 1), iterations: OPT_ITERATIONS, seed: 7
  });
  const params = Array.from(run.bestParams);
  return {
    model, params,
    expectation: sim.expectation(Float64Array.from(params)),
    optimum: sim.emin, worst: sim.emax
  };
}

function wireStep4() {
  const host = document.getElementById('wbCodegen');
  if (!host) return;
  let extras = { lambdaSweep: false, optimizerBakeOff: false, initComparison: false };

  function draw(model) {
    const ctx = codegenContext(model);
    const result = generate(model, {
      params: ctx.params, expectation: ctx.expectation,
      optimum: ctx.optimum, worst: ctx.worst, extras
    });
    renderCodegen(host, { ...result, version: PENNYLANE_VERSION }, { expectation: ctx.expectation, extras });
    attachTooltips(host);

    for (const box of host.querySelectorAll('input[data-extra]')) {
      box.addEventListener('change', () => {
        extras = { ...extras, [box.dataset.extra]: !!box.checked };
        draw(model);
      });
    }

    const copy = host.querySelector('#wbCopy');
    const note = host.querySelector('#wbCopyNote');
    if (copy) {
      copy.addEventListener('click', async () => {
        /* Clipboard only — nothing is uploaded, and there is no fallback that
           would send the code anywhere. */
        try {
          await navigator.clipboard.writeText(result.code);
          if (note) note.textContent = 'Copied — paste it into a fresh notebook.';
        } catch (e) {
          if (note) note.textContent = 'Could not reach the clipboard; select the code below instead.';
          const pre = host.querySelector('#wbCode');
          if (pre && pre.focus) pre.focus();
        }
      });
    }
  }

  registerStep(4, document.getElementById('panel-4'), (model) => { if (model) draw(model); });
}

/* --------------------------------------------------------- save and resume --
   A save code is the only persistence the tool has. It carries the whole model,
   so pasting one back restores the instance AND everything downstream of it —
   which is what makes it a checkpoint rather than a bookmark: the step rail
   opens up again exactly as far as the instance allows, and you can drop
   straight into the middle of the pipeline.                                  */

function wireSaveLoad() {
  const saveBtn = document.getElementById('wbSave');
  const loadBtn = document.getElementById('wbLoad');
  const field = document.getElementById('wbSaveCode');
  const note = document.getElementById('wbSaveNote');
  if (!saveBtn || !loadBtn || !field) return;

  const say = (text, level) => {
    if (!note) return;
    note.textContent = text;
    note.dataset.level = level || 'ok';
  };

  saveBtn.addEventListener('click', async () => {
    const model = state.model;
    if (!model) { say('Build something first — there is nothing to save yet.', 'warn'); return; }
    try {
      const code = await save.encode(model);
      field.value = code;
      field.focus();
      if (field.select) field.select();
      say('Saved. Copy this code; pasting it back restores the whole instance.', 'ok');
    } catch (err) {
      say('Could not make a save code: ' + err.message, 'warn');
    }
  });

  loadBtn.addEventListener('click', async () => {
    const text = field.value;
    if (!text || !text.trim()) { say('Paste a save code into the box first.', 'warn'); return; }
    try {
      const model = await save.decode(text);
      applyLoadedModel(model);
    } catch (err) {
      /* SaveCodeError messages are written for the reader; anything else is a
         bug and should not be dressed up as user error. */
      say(err && err.name === 'SaveCodeError' ? err.message : 'That code could not be read.', 'warn');
    }
  });
}

/**
 * Restore a model that arrived as a save code rather than from the form. The
 * input panel is left alone: it still shows whatever was last typed, and saying
 * so is more honest than silently rewriting it to something the user did not
 * enter.
 */
function applyLoadedModel(model) {
  const note = document.getElementById('wbSaveNote');
  const results = document.getElementById('wbResults');

  setModel(model);
  renderMatrix(document.getElementById('wbMatrix'), model);
  renderLedger(document.getElementById('wbLedger'), model);
  renderVerdict(document.getElementById('wbVerdict'), verify(model), model);
  if (results) results.hidden = false;
  attachTooltips(document);

  if (note) {
    const problem = PROBLEM_LIST.find((p) => p.id === model.problemType);
    note.dataset.level = 'ok';
    note.textContent = 'Loaded a ' + (problem ? problem.title.toLowerCase() : model.problemType) +
      ' instance, ' + model.meta.qubitCount + ' qubits. Every step it is big enough for is open — ' +
      'the form above still shows what you last typed, not this.';
  }
  refreshRail();
}

/** Wire the rail that is already in the page's markup. */
export function init() {
  const rail = document.getElementById('wbRail');
  if (!rail) return;
  state.nodes = {
    rail: rail,
    size: document.getElementById('wbSize'),
    notice: document.getElementById('wbNotice')
  };
  rail.addEventListener('click', (e) => {
    const btn = e.target.closest('.wb-step');
    if (btn && !btn.disabled) goTo(Number(btn.dataset.step));
  });
  wireStep1();
  wireStep2();
  wireStep3();
  wireStep4();
  wireSaveLoad();
  /* after every step has registered, so the navs know what exists */
  for (const step of STEPS) buildStepNav(step.id);
  buildTopButton();
  attachTooltips(document);
  refreshRail();
}
