/* ============================================================================
   input-form.js: the form-type input mode, plus the controls every mode shares.

   Two exports:

     createFooter()  the penalty field, the live qubit preview, the error
                     callout and the Build button. Every input mode ends in one
                     of these, so the rules below hold everywhere rather than
                     three times over.
     initForm()      the form mode itself: a table of rows (from input-set.js)
                     plus any scalar fields the template declares. Knapsack and
                     number partitioning both use it; they differ only in their
                     columns.

   The two rules the footer exists to keep:

     * The penalty field is AUTO until the user types in it. Auto means "the
       closed-form bound for the numbers currently on screen", so editing an
       input moves it. Once overridden it stops moving and says so: a
       deliberate choice is never silently overwritten, and a stale bound is
       never silently left sitting in the box.

     * Nothing is rounded on the user's behalf. A weight of 1.5 is refused with
       an explanation, not quietly turned into 2.
   ============================================================================ */

import { el, clear } from './render.js?v=1';
import { createRowsTable } from './input-set.js?v=1';

/* A number as typed. '' and nonsense both become null, so the template decides
   what to say about them rather than Number('') quietly becoming 0. */
export function num(s) {
  const v = String(s == null ? '' : s).trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------- the footer -- */

/**
 * @param {object} problem  a registry entry from problems.js
 * @param {() => object} readBody  the mode-specific half of the spec
 * @param {(model:object) => void} onBuild
 */
export function createFooter(problem, readBody, onBuild) {
  let override = null;                       // null = auto
  /* Where the mode's own inputs live, so a build error can point at the field it
     names. Filled in by attach(), below. */
  const state = { bodyNode: null, fieldNodes: null };

  const lambdaId = 'wbLambda';
  const lambda = el('input', {
    class: 'wb-input', id: lambdaId, type: 'number', step: 'any', min: '0', 'data-auto': 'true'
  });
  const backToAuto = el('button', { class: 'wb-link', type: 'button', text: 'back to auto', hidden: true });
  const lambdaNote = el('p', { class: 'wb-field-note' });
  const preview = el('p', { class: 'wb-field-note wb-preview' });
  const error = el('div', { class: 'wb-callout', hidden: true, role: 'alert' });
  const buildBtn = el('button', { class: 'wb-btn primary', type: 'button', text: 'Build the QUBO' });

  const node = el('div', null, [
    el('div', { class: 'wb-fields' }, [
      el('div', { class: 'wb-field' }, [
        el('label', { for: lambdaId }, ['penalty λ ', backToAuto]),
        lambda,
        lambdaNote
      ])
    ]),
    preview,
    error,
    el('div', { class: 'wb-actions' }, [buildBtn])
  ]);

  const readSpec = () => Object.assign({}, readBody(), { lambda: override });
  const strict = problem.boundStrict !== false;

  function refresh() {
    const spec = readSpec();

    let bound = null;
    try { bound = problem.bound(spec); } catch (e) { bound = null; }
    const auto = bound === null ? null : Math.ceil(bound) + 1;

    if (override === null) {
      lambda.value = auto === null ? '' : String(auto);
      lambda.dataset.auto = 'true';
    } else {
      lambda.dataset.auto = 'false';
    }
    backToAuto.hidden = override === null;

    const effective = override === null ? auto : override;
    const safe = bound === null || effective === null ? null
      : (strict ? effective > bound : effective >= bound);

    clear(lambdaNote);
    if (bound === null || auto === null) {
      lambdaNote.appendChild(document.createTextNode('Fill this in and the safe value appears here.'));
    } else if (override === null) {
      /* Both halves matter: the RULE says why the number is safe, the VALUE
         says what the rule works out to for the numbers on screen. */
      lambdaNote.appendChild(document.createTextNode(
        bound > 0
          ? 'Auto: ' + problem.boundText + ' = ' + bound + ', so λ = ' + auto + '.'
          : 'Auto: ' + problem.boundText + '. λ = ' + auto + ' is a convenient scale.'));
    } else if (safe) {
      lambdaNote.appendChild(document.createTextNode(
        'Set by hand. ' + (strict ? 'Above' : 'At or above') + ' the safe bound of ' + bound + '. Fine.'));
    } else {
      lambdaNote.appendChild(el('b', { text: 'Below the safe bound of ' + bound + '.' }));
      lambdaNote.appendChild(document.createTextNode(
        ' The build will go ahead so you can see what happens, but the result is not guaranteed to mean anything.'));
    }
    lambdaNote.dataset.level = safe === false ? 'warn' : 'ok';

    clear(preview);
    let qubits = null;
    try { qubits = problem.qubits(spec); } catch (e) { qubits = null; }
    if (qubits) {
      preview.appendChild(document.createTextNode(
        problem.previewText ? problem.previewText(spec, qubits) : qubits + ' qubits.'));
    }
  }

  function clearErrors() {
    error.hidden = true;
    clear(error);
    for (const bad of node.querySelectorAll('[aria-invalid]')) bad.removeAttribute('aria-invalid');
    if (state.bodyNode) for (const bad of state.bodyNode.querySelectorAll('[aria-invalid]')) bad.removeAttribute('aria-invalid');
  }

  /** Points at the field the error names, when it names one. */
  function showError(err) {
    clearErrors();
    error.hidden = false;
    error.setAttribute('data-level', 'stop');
    error.appendChild(el('span', { class: 'ico', 'aria-hidden': 'true', text: '!' }));
    error.appendChild(el('p', { class: 'title', text: 'Cannot build this yet' }));
    error.appendChild(el('p', { text: err.message }));

    const field = err.field || '';
    let target = null;
    if (field === 'lambda') target = lambda;
    else if (state.fieldNodes && state.fieldNodes[field]) target = state.fieldNodes[field];
    else if (/^[a-z]+:(\d+)$/.test(field)) {
      const [, key, idx] = /^([a-z]+):(\d+)$/.exec(field);
      const scope = state.bodyNode || node;
      target = scope.querySelector('input[data-row="' + idx + '"][data-key="' + key + '"]');
    } else if (state.bodyNode) {
      target = state.bodyNode.querySelector('textarea') || state.bodyNode.querySelector('input');
    }
    if (target) { target.setAttribute('aria-invalid', 'true'); target.focus(); }
  }

  function build() {
    clearErrors();
    try {
      const model = problem.build(readSpec());
      if (onBuild) onBuild(model);
      return model;
    } catch (err) {
      if (err && err.name === 'BuildError') { showError(err); return null; }
      throw err;
    }
  }

  lambda.addEventListener('input', () => {
    /* Emptying the box is how you ask for auto back. */
    override = lambda.value.trim() === '' ? null : num(lambda.value);
    refresh();
  });
  backToAuto.addEventListener('click', () => { override = null; refresh(); lambda.focus(); });
  buildBtn.addEventListener('click', build);

  return {
    node, build, refresh, showError, clearErrors, readSpec,
    /* the mode tells the footer where its own inputs live, so an error can point
       at the offending one */
    attach(bodyNode, fieldNodes) { state.bodyNode = bodyNode; state.fieldNodes = fieldNodes || null; }
  };
}

/**
 * The scalar inputs a template declares in `input.fields`: knapsack's capacity,
 * colouring's colour count, clique's K. Shared, because a graph problem can need
 * one just as much as a form problem can.
 *
 * @param {Array<{key,label,type,step,min,note}>} fields
 * @param {object} values   mutated in place as the user types
 * @param {() => void} onChange
 * @returns {{node:HTMLElement, nodes:object}}
 */
export function createFields(fields, values, onChange) {
  const nodes = {};
  const blocks = (fields || []).map((f) => {
    const id = 'wbField-' + f.key;
    const input = el('input', {
      class: 'wb-input', id: id, type: f.type || 'number',
      step: f.step || null, min: f.min || null, value: values[f.key] ?? ''
    });
    input.addEventListener('input', () => { values[f.key] = input.value; onChange(); });
    nodes[f.key] = input;
    return el('div', { class: 'wb-field' }, [
      el('label', { for: id, text: f.label }),
      input,
      f.note ? el('p', { class: 'wb-field-note', text: f.note }) : null
    ]);
  });
  return {
    node: blocks.length ? el('div', { class: 'wb-fields' }, blocks) : el('div', { hidden: true }),
    nodes
  };
}

/** Enter anywhere inside builds, the way a form should behave. */
export function buildOnEnter(container, build) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tag = e.target.tagName;
    if (tag !== 'INPUT') return;             // a textarea keeps its newlines
    e.preventDefault();
    build();
  });
}

/* --------------------------------------------------------------- form mode */

/**
 * A table of rows plus any scalar fields the template declares, both described
 * by `problem.input`.
 */
export function initForm(host, problem, onBuild) {
  const schema = problem.input;
  const defaults = problem.defaults();
  const rows = schema.toRows(defaults);
  const fieldValues = {};
  for (const f of (schema.fields || [])) fieldValues[f.key] = String(defaults[f.key] ?? '');

  clear(host);

  const footer = createFooter(problem, () => schema.toSpec(rows, fieldValues), onBuild);

  const table = createRowsTable({
    columns: schema.rows.columns,
    rows: rows,
    addLabel: schema.rows.addLabel,
    rowNoun: schema.rows.noun,
    onChange: footer.refresh
  });

  const fields = createFields(schema.fields, fieldValues, footer.refresh);

  const body = el('div', null, [table.node, fields.node]);
  const fieldNodes = fields.nodes;

  const form = el('div', { class: 'wb-form' }, [body, footer.node]);
  footer.attach(body, fieldNodes);
  host.appendChild(form);
  buildOnEnter(form, footer.build);
  footer.refresh();

  return { build: footer.build, readSpec: footer.readSpec };
}
