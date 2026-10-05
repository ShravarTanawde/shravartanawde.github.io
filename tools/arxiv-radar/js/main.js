/* ============================================================================
   main.js: entry point. Loads the data, builds the controls, wires events.

   Rules:
     * One render() redraws every section from state; controls only change
       state and call it. There is no second copy of what is selected.
     * Segmented controls are native radio inputs, so arrow keys, focus and
       screen readers behave the way they do everywhere else.
     * The topic panel is a <dialog>: Escape closes it, and focus goes back to
       whatever opened it.
   ============================================================================ */

import { loadDetails, loadRadar, SchemaError } from './data.js?v=2';
import {
  el, FILTER_LABEL, makeIndex, RANGE_LABEL, renderCategories, renderEmerging, renderFixed,
  renderMoves, renderPanel, renderStats, renderTable, renderVolume,
} from './render.js?v=2';
import { FILTERS, RANGES, restore, save, state, writeURL } from './state.js?v=1';

const status = document.getElementById('rdStatus');
const panel = document.getElementById('rdPanel');
let radar, idx, opener = null;

function segmented(id, name, options, current, onChange) {
  const box = document.getElementById(id);
  for (const [value, text, aria] of options) {
    const input = el('input', { type: 'radio', name, value, 'aria-label': aria || null });
    input.checked = value === current;
    input.addEventListener('change', () => { if (input.checked) onChange(value); });
    box.appendChild(el('label', null, [input, el('span', { text })]));
  }
}

function render() {
  renderStats(radar);
  renderMoves(radar, idx, open);
  renderEmerging(radar);
  renderTable(radar, idx, actions);
  renderVolume(radar);
  renderCategories(radar);
  if (panel.open && state.topic) draw(state.topic);
  writeURL();
}

function draw(id) {
  panel.dataset.topic = id;
  renderPanel(radar, idx, id, actions, loadDetails());
}

function open(id) {
  if (!panel.open) opener = document.activeElement;
  state.topic = id;
  /* Shown first, then drawn: the chart sizes itself to the open dialog. */
  if (!panel.open) panel.showModal();
  draw(id);
  panel.scrollTop = 0;
  const title = document.getElementById('rdPanelTitle');
  if (title) { title.setAttribute('tabindex', '-1'); title.focus(); }
  writeURL();
}

function close() { panel.close(); }

panel.addEventListener('close', () => {
  state.topic = null;
  writeURL();
  /* The row that opened the panel may have been redrawn while it was open;
     fall back to the fresh copy of the same button. */
  const id = panel.dataset.topic;
  const target = opener && document.body.contains(opener)
    ? opener : document.querySelector(`.rd-open[data-topic="${id}"], .rd-move[data-topic="${id}"]`);
  if (target) target.focus();
});
panel.addEventListener('click', (e) => { if (e.target === panel) close(); });

const actions = {
  open, close,
  sort(key, first) {
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first };
    renderTable(radar, idx, actions);
    const btn = [...document.querySelectorAll('.rd-sort')].find((b) => b.closest('th').getAttribute('aria-sort') !== 'none');
    if (btn) btn.focus();
  },
  expand(id) {
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    renderTable(radar, idx, actions);
    const btn = document.querySelector(`tr[data-topic="${id}"] .rd-expand`);
    if (btn) btn.focus();
  },
  pin(id) {
    if (state.pinned.has(id)) state.pinned.delete(id); else state.pinned.add(id);
    save();
    render();
  },
  hide(id) {
    if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
    save();
    render();
    if (!panel.open) document.getElementById('h-topics').scrollIntoView({ block: 'nearest' });
  },
  showAll() {
    state.hidden.clear();
    save();
    render();
  },
};

function controls() {
  segmented('rdRange', 'range', RANGES.map((r) => [r, r, RANGE_LABEL[r]]), state.range, (v) => {
    state.range = v; save(); render();
  });
  segmented('rdFilter', 'filter', FILTERS.map((f) => [f, FILTER_LABEL[f]]), state.filter, (v) => {
    state.filter = v; save(); render();
  });
  segmented('rdLayout', 'layout', [['grouped', 'By broad topic'], ['flat', 'All fine topics']], state.layout, (v) => {
    state.layout = v; save(); renderTable(radar, idx, actions);
  });
  for (const r of RANGES) {
    const input = document.querySelector(`#rdRange input[value="${r}"]`);
    input.parentElement.title = RANGE_LABEL[r];
  }

  const chips = document.getElementById('rdFacets');
  const chip = (facet, text) => {
    const b = el('button', { type: 'button', class: 'rd-chip', 'aria-pressed': String(facet ? state.facets.has(facet) : !state.facets.size), text });
    b.addEventListener('click', () => {
      if (!facet) state.facets.clear();
      else if (state.facets.has(facet)) state.facets.delete(facet);
      else state.facets.add(facet);
      for (const c of chips.querySelectorAll('.rd-chip')) {
        const f = c.dataset.facet;
        c.setAttribute('aria-pressed', String(f ? state.facets.has(f) : !state.facets.size));
      }
      render();
    });
    if (facet) b.dataset.facet = facet;
    return b;
  };
  chips.append(chip(null, 'All facets'), ...radar.facets.filter((f) => radar.topics.some((t) => t.facet === f && !t.housekeeping)).map((f) => chip(f, f)));

  const search = document.getElementById('rdSearch');
  search.value = state.q;
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = search.value; render(); }, 150);
  });

  const ml = document.getElementById('rdHideML');
  ml.checked = state.hideML;
  ml.addEventListener('change', () => { state.hideML = ml.checked; save(); render(); });
}

/* Charts are drawn at their container's width, so a resize redraws them. */
let resizeTimer = null;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (!radar || window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderVolume(radar);
    if (panel.open && state.topic) draw(state.topic);
  }, 200);
});

async function main() {
  try {
    radar = await loadRadar();
  } catch (e) {
    status.textContent = e instanceof SchemaError
      ? 'This page and its data file are out of step. Reload to pick up the newer version.'
      : 'The data file didn\'t load, and the page has nothing to show without it. Reloading usually fixes this; if it doesn\'t, the weekly update may be halfway through publishing.';
    status.classList.add('rd-error');
    return;
  }
  idx = makeIndex(radar);
  restore({ topics: idx.fine, broad: idx.broad, facets: new Set(radar.facets) });
  controls();
  renderFixed(radar);
  status.hidden = true;
  document.getElementById('rdApp').hidden = false;
  render();
  if (state.topic) open(state.topic);
}

main();
