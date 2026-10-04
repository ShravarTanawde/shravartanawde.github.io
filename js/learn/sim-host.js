/* ============================================================
   sim-host.js — the contract every interactive obeys.

   A simulation is an ES module at js/learn/sims/<id>.js with a default export:

       export default {
         mount(container, ctx) { ... },
         unmount() { ... }
       }

   mount() builds its own DOM inside `container` and starts whatever it needs.
   unmount() must undo all of it: remove listeners, cancel animation frames,
   drop references. It is called every time a panel closes, and a panel can be
   opened and closed all afternoon.

   `ctx` carries { id, reduceMotion, signal } — `signal` aborts when the panel
   closes, so `addEventListener(..., { signal })` and `fetch(url, { signal })`
   clean themselves up for free.

   The module is loaded on first use and cached by the browser. A sim that fails
   to load never takes the node with it: the prose still renders and the mount
   point says, plainly, that the interactive is unavailable.
   ============================================================ */

let active = null;      // { id, mod, container, controller }

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * @param {string} id        node id; also the module filename
 * @param {Element} container where the sim builds itself
 */
export async function mountSim(id, container) {
  unmountSim();

  const controller = new AbortController();
  let mod;
  try {
    mod = (await import('./sims/' + id + '.js?v=2')).default;
  } catch (e) {
    failed(container, e);
    return null;
  }
  if (!mod || typeof mod.mount !== 'function') {
    failed(container, new Error('module has no mount()'));
    return null;
  }

  active = { id: id, mod: mod, container: container, controller: controller };
  try {
    mod.mount(container, {
      id: id,
      reduceMotion: window.matchMedia(REDUCED).matches,
      signal: controller.signal
    });
  } catch (e) {
    active = null;
    failed(container, e);
    return null;
  }
  return mod;
}

export function unmountSim() {
  if (!active) return;
  const it = active;
  active = null;
  try {
    it.controller.abort();
    if (typeof it.mod.unmount === 'function') it.mod.unmount();
  } catch (e) {
    console.warn('learn: sim ' + it.id + ' failed to unmount cleanly', e);
  }
  it.container.textContent = '';
}

export function activeSim() {
  return active ? active.id : null;
}

/* A missing or broken interactive is a missing interactive, not a broken page.
   Say what is not there and stop; the prose above it still does its job. */
function failed(container, err) {
  console.warn('learn: interactive failed to load', err);
  container.textContent = '';
  const note = document.createElement('p');
  note.className = 'sim-unavailable';
  note.textContent = 'The interactive for this topic could not be loaded. The explanation above is unaffected.';
  container.appendChild(note);
}
