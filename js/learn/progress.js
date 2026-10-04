/* ============================================================
   progress.js — which topics have been opened.

   Cosmetic, and only cosmetic. It lights up nodes you have already read so a
   map you come back to in a month still shows where you were. It gates nothing,
   unlocks nothing, counts nothing and awards nothing.

   Every call is wrapped: in a private window localStorage can throw on read as
   well as on write. When it does, the graph runs exactly as before, minus the
   memory.
   ============================================================ */

const KEY = 'qp-learn-visited';
const FLAGS = 'qp-learn-flags';

let cache = null;

function load() {
  if (cache) return cache;
  cache = new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') cache.add(id);
    }
  } catch (e) {
    /* Storage unavailable or corrupt. An empty set is a perfectly good answer. */
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(cache)));
  } catch (e) {
    /* Nothing to do and nothing to say. */
  }
}

/** @returns {Set<string>} the live set — read it, do not mutate it. */
export function visited() {
  return load();
}

export function hasVisited(id) {
  return load().has(id);
}

/** @returns {boolean} true if this was the first time. */
export function markVisited(id) {
  const set = load();
  if (set.has(id)) return false;
  set.add(id);
  save();
  return true;
}

export function reset() {
  cache = new Set();
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* Same as above. The in-memory set is already cleared. */
  }
}

/* ---- view settings ----
   Not progress, but the same store and the same rule: if it cannot be written,
   the page still works and simply forgets. Only the related-links toggle uses
   this today. */

export function getFlag(name, fallback) {
  try {
    const raw = localStorage.getItem(FLAGS);
    if (!raw) return fallback;
    const o = JSON.parse(raw);
    return o && typeof o[name] === 'boolean' ? o[name] : fallback;
  } catch (e) {
    return fallback;
  }
}

export function setFlag(name, value) {
  try {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(FLAGS) || '{}') || {}; } catch (e) { o = {}; }
    o[name] = !!value;
    localStorage.setItem(FLAGS, JSON.stringify(o));
  } catch (e) {
    /* Nothing to do and nothing to say. */
  }
}

/** Whether the store is usable at all, so the UI can hide a reset that would lie. */
export function available() {
  try {
    const probe = KEY + '-probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch (e) {
    return false;
  }
}
