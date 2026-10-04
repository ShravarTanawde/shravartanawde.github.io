/* ============================================================================
   render.js: every DOM write and every number format on the page.

   Rules:
     * Every number shown is computed from the data files. Nothing here types
       a figure in by hand.
     * Up and down carry an arrow glyph and a signed value as well as colour;
       "no clear change" and "too few papers" are said in words.
     * Percentages are shown to one decimal place, or two below 1%, because
       most fine topics hold well under 1% of papers and "0.1%" would erase
       the difference between 0.06% and 0.14%.
     * Dates read as 27 Sep 2026. No "~" anywhere: numbers are rounded instead.
     * Every chart is followed by a sentence or a visually hidden table that
       carries its numbers.
   ============================================================================ */

import { bars, line, spark, strip } from './charts.js?v=1';
import { state } from './state.js?v=1';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const RANGE_LABEL = {
  '1W': 'Last week', '1M': 'Last 4 weeks', '3M': 'Last 13 weeks',
  '6M': 'Last 26 weeks', '1Y': 'Last 52 weeks', '5Y': 'Last 5 years',
};
export const FILTER_LABEL = { all: 'All papers', primary: 'Primary quant-ph', cross: 'Cross-listed' };
const PERIOD = { '1W': 'week', '1M': '4 weeks', '3M': '3 months', '6M': '6 months', '1Y': 'year' };
const GRAN_WORD = { day: 'day', week: 'week', month: 'month' };

/* ------------------------------------------------------------------ helpers */

export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function fill(id, children) {
  const node = document.getElementById(id);
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const fmtMonth = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const fmtDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
export const fmtInt = (n) => Number(n).toLocaleString('en-GB');

export function pct(frac) {
  const v = 100 * frac;
  if (v === 0) return '0%';
  return (Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1)) + '%';
}
const pctNum = (v) => (Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1));
const signed = (v, digits) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);

function tickFor(gran, label) {
  if (gran === 'month') return fmtMonth(label);
  return fmtDay(label);
}

/* ------------------------------------------------------------------ badges */

export function badge(row) {
  const tip = `Share of papers went from ${pctNum(100 * row.share_then)}% to ${pctNum(100 * row.share_now)}% `
    + `(${fmtInt(row.n_then)} → ${fmtInt(row.n_now)} papers, z = ${row.z.toFixed(1)}).`;
  let text, cls;
  if (row.signal === 'growing') { text = `▲ ${pctNum(Math.abs(row.delta_pts))} pts`; cls = 'rd-badge up'; }
  else if (row.signal === 'cooling') { text = `▼ ${pctNum(Math.abs(row.delta_pts))} pts`; cls = 'rd-badge down'; }
  else if (row.signal === 'steady') { text = 'no clear change'; cls = 'rd-badge flat'; }
  else { text = 'too few papers'; cls = 'rd-badge flat'; }
  return el('span', { class: cls, title: tip }, [text, el('span', { class: 'vh', text: '. ' + tip })]);
}

export function trendCell(tr) {
  if (!tr) return el('span', { class: 'rd-trend flat', text: 'too few papers' });
  const [g, lo, hi] = tr;
  const clear = lo > 0 || hi < 0;
  const arrow = !clear ? '' : g > 0 ? '▲ ' : '▼ ';
  const tip = `Share changing by ${signed(g, 1)}% a year over the last five years `
    + `(95% range ${signed(lo, 1)}% to ${signed(hi, 1)}%).`;
  return el('span', { class: 'rd-trend ' + (!clear ? 'flat' : g > 0 ? 'up' : 'down'), title: tip }, [
    el('span', { 'aria-hidden': 'true' }, [arrow + signed(g, 0) + '%/yr', el('small', { text: `${signed(lo, 0)} to ${signed(hi, 0)}` })]),
    el('span', { class: 'vh', text: tip }),
  ]);
}

/* ------------------------------------------------------------- view access */

export function makeIndex(radar) {
  const fine = new Map(radar.topics.map((t) => [t.id, t]));
  const broad = new Map(radar.broad.map((b) => [b.id, b]));
  return { fine, broad, get: (id) => fine.get(id) || broad.get(id) };
}

export function currentView(radar) {
  return radar.views[state.range][state.filter];
}

function rowsById(view) {
  const m = new Map();
  for (const r of view.topics) m.set(r.id, r);
  for (const r of view.broad) m.set(r.id, r);
  return m;
}

function shares(view, row) {
  return row.spark.map((c, i) => (view.volume.counts[i] ? c / view.volume.counts[i] : null));
}

function sparkFor(view, row, name) {
  const s = shares(view, row);
  const real = s.filter((v) => v !== null);
  const label = real.length
    ? `${name}: share per ${GRAN_WORD[view.window.granularity]}, from ${pct(real[0])} to ${pct(real[real.length - 1])}`
    : `${name}: no papers in this range`;
  return spark(s, { name: label });
}

/* Which fine topics the current controls let through. */
export function visible(radar, idx, { includeHidden = false } = {}) {
  const q = state.q.trim().toLowerCase();
  return radar.topics.filter((t) => {
    if (t.housekeeping) return false;
    if (!includeHidden && state.hidden.has(t.id)) return false;
    if (state.hideML && t.ml_adjacent) return false;
    if (state.facets.size && !state.facets.has(t.facet)) return false;
    if (q) {
      const hay = (t.name + ' ' + t.description + ' ' + t.terms.join(' ') + ' ' + idx.broad.get(t.parent).name).toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------- stat strip */

export function renderStats(radar) {
  const v = currentView(radar);
  const t = v.totals;
  const cmp = state.range === '5Y' ? 'vs first year of range' : `vs previous ${PERIOD[state.range]}`;
  const change = t.n_then ? (t.n_now - t.n_then) / t.n_then : 0;
  const changeText = (change > 0 ? '▲ ' : change < 0 ? '▼ ' : '') + Math.abs(100 * change).toFixed(1) + '%';
  const cell = (label, value, sub) => [el('dt', { text: label }), el('dd', null, [value, sub ? el('small', { text: sub }) : null])];
  fill('rdStats', [
    ...cell('Papers in range', fmtInt(t.n)),
    ...cell(cmp, el('span', { class: change > 0 ? 'up' : change < 0 ? 'down' : '' }, changeText),
      `${fmtInt(t.n_then)} → ${fmtInt(t.n_now)} papers`),
    ...cell('Primary quant-ph', pct(t.primary_share)),
    ...cell('Topics', fmtInt(radar.meta.model.n_topics), `in ${radar.meta.model.n_broad} broad topics`),
    ...cell('Data through', fmtDate(radar.meta.data_through)),
  ]);
}

/* ---------------------------------------------------------- biggest moves */

export function renderMoves(radar, idx, open) {
  const v = currentView(radar);
  const byId = rowsById(v);
  const ok = visible(radar, idx).map((t) => byId.get(t.id));
  const intro = state.range === '5Y'
    ? 'Topics whose share of papers changed most between the first and the last year of the range. A topic is only listed when the change is larger than chance would explain.'
    : `Topics whose share of papers changed most against the previous ${PERIOD[state.range]}. A topic is only listed when the change is larger than chance would explain.`;
  fill('rdMovesIntro', intro);
  const item = (row) => {
    const t = idx.fine.get(row.id);
    return el('li', null, el('button', { type: 'button', class: 'rd-move', 'data-topic': t.id, onclick: () => open(t.id) }, [
      el('span', { class: 'rd-move-name', text: t.name }),
      el('span', { class: 'rd-move-facet', text: t.facet }),
      el('span', { class: 'rd-move-share', text: `${pct(row.share_then)} → ${pct(row.share_now)}` }),
      badge(row),
      sparkFor(v, row, t.name),
    ]));
  };
  const list = (id, rows) => {
    if (!rows.length) return fill(id, el('li', { class: 'rd-empty', text: 'Nothing moved clearly enough to list.' }));
    fill(id, rows.map(item));
  };
  list('rdGrowing', ok.filter((r) => r.signal === 'growing').sort((a, b) => b.z - a.z).slice(0, 8));
  list('rdCooling', ok.filter((r) => r.signal === 'cooling').sort((a, b) => a.z - b.z).slice(0, 8));
}

/* ---------------------------------------------------------- not yet a topic */

export function renderEmerging(radar) {
  const weeks = radar.meta.emerging_weeks || [];
  fill('rdEmergingWhen', `Groups from the twelve weeks to ${fmtDate(radar.meta.data_through)}. They are the same under every range and filter.`);
  if (!radar.emerging.length) {
    fill('rdEmerging', el('p', { class: 'rd-empty', text: 'No groups have held together for three weeks yet.' }));
    return;
  }
  fill('rdEmerging', radar.emerging.map((g) => el('article', { class: 'rd-card' }, [
    el('h3', { class: 'rd-card-title', text: g.terms.join(' · ') }),
    el('p', { class: 'rd-card-meta', text: `${g.n} papers · seen in ${g.weeks_seen} of ${weeks.length || 12} weeks · first seen ${fmtDate(g.first_seen)}` }),
    strip(g.weekly, { name: `Papers per week over the last twelve weeks: ${g.weekly.join(', ')}` }),
    el('details', { class: 'rd-card-papers' }, [
      el('summary', { text: `Papers (${g.papers.length})` }),
      el('ul', null, g.papers.map(([id, title, date]) => el('li', null, [
        el('a', { href: `https://arxiv.org/abs/${id}`, rel: 'noopener', text: title }),
        el('span', { class: 'rd-date', text: ' ' + fmtDate(date) }),
      ]))),
    ]),
  ])));
}

/* ------------------------------------------------------------- the table */

const SORTERS = {
  name: (t) => t.meta.name.toLowerCase(),
  share: (t) => t.row.share_now,
  delta: (t) => t.row.delta_pts,
  z: (t) => t.row.z,
  trend: (t) => (t.meta.trend[state.filter] ? t.meta.trend[state.filter][0] : -Infinity),
  n: (t) => t.row.n,
};

function sortItems(items) {
  const key = SORTERS[state.sort.key];
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  return items.slice().sort((a, b) => {
    const x = key(a), y = key(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    return a.meta.id < b.meta.id ? -1 : 1;
  });
}

const COLUMNS = [
  { key: 'name', label: 'Topic', first: 'asc' },
  { key: null, label: 'Facet' },
  { key: 'share', label: 'Share', first: 'desc', num: true },
  { key: 'delta', label: 'Change', first: 'desc', num: true },
  { key: 'z', label: 'z', first: 'desc', num: true, title: 'Momentum: how many standard errors the change is from zero' },
  { key: 'trend', label: '5-year trend', first: 'desc', num: true },
  { key: null, label: 'Shape' },
  { key: 'n', label: 'Papers', first: 'desc', num: true },
  { key: null, label: 'Keep', vh: true },
];

export function renderTable(radar, idx, actions) {
  const v = currentView(radar);
  const byId = rowsById(v);
  const showing = visible(radar, idx, { includeHidden: false });
  const item = (meta) => ({ meta, row: byId.get(meta.id) });

  const head = el('tr', null, COLUMNS.map((c) => {
    if (!c.key) return el('th', { scope: 'col', class: c.vh ? 'rd-th-vh' : null }, c.vh ? el('span', { class: 'vh', text: c.label }) : c.label);
    const on = state.sort.key === c.key;
    return el('th', { scope: 'col', class: c.num ? 'num' : null, 'aria-sort': on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: 'rd-sort', title: c.title || null, onclick: () => actions.sort(c.key, c.first) },
        [c.label, el('span', { class: 'rd-sort-ico', 'aria-hidden': 'true', text: on ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '' })]));
  }));

  const fineRow = (it, { child = false } = {}) => {
    const t = it.meta, r = it.row;
    const pinned = state.pinned.has(t.id);
    return el('tr', { class: child ? 'rd-child' : null, 'data-topic': t.id }, [
      el('th', { scope: 'row', class: 'rd-name' }, [
        pinned ? el('span', { class: 'rd-pin', title: 'Pinned', text: '◆ ' }) : null,
        el('button', { type: 'button', class: 'rd-open', 'data-topic': t.id, onclick: () => actions.open(t.id) }, t.name),
      ]),
      el('td', { class: 'rd-facet', text: t.facet }),
      el('td', { class: 'num', text: pct(r.share_now) }),
      el('td', { class: 'num' }, badge(r)),
      el('td', { class: 'num', text: r.z.toFixed(1) }),
      el('td', { class: 'num' }, trendCell(t.trend[state.filter])),
      el('td', null, sparkFor(v, r, t.name)),
      el('td', { class: 'num', text: fmtInt(r.n) }),
      el('td', { class: 'rd-keep' }, [
        el('button', { type: 'button', class: 'rd-mini', 'aria-pressed': String(pinned), onclick: () => actions.pin(t.id), 'aria-label': `${pinned ? 'Unpin' : 'Pin'} ${t.name}` }, pinned ? 'Unpin' : 'Pin'),
        el('button', { type: 'button', class: 'rd-mini', onclick: () => actions.hide(t.id), 'aria-label': `Hide ${t.name}` }, 'Hide'),
      ]),
    ]);
  };

  const body = [];
  const pinnedItems = sortItems(showing.filter((t) => state.pinned.has(t.id)).map(item));
  if (pinnedItems.length) {
    body.push(el('tr', { class: 'rd-group' }, el('th', { scope: 'rowgroup', colspan: COLUMNS.length, text: 'Pinned' })));
    pinnedItems.forEach((it) => body.push(fineRow(it)));
  }
  const rest = showing.filter((t) => !state.pinned.has(t.id));

  if (state.layout === 'flat') {
    const items = sortItems(rest.map(item));
    if (state.sort.key === 'name') {
      for (const facet of radar.facets) {
        const inFacet = items.filter((it) => it.meta.facet === facet);
        if (!inFacet.length) continue;
        body.push(el('tr', { class: 'rd-group' }, el('th', { scope: 'rowgroup', colspan: COLUMNS.length, text: facet })));
        inFacet.forEach((it) => body.push(fineRow(it)));
      }
    } else {
      items.forEach((it) => body.push(fineRow(it)));
    }
  } else {
    const filtered = state.facets.size || state.q || state.hideML;
    const byParent = new Map();
    for (const t of rest) {
      if (!byParent.has(t.parent)) byParent.set(t.parent, []);
      byParent.get(t.parent).push(t);
    }
    const groups = sortItems(radar.broad.filter((b) => byParent.has(b.id)).map(item));
    for (const g of groups) {
      const b = g.meta, r = g.row;
      const kids = sortItems(byParent.get(b.id).map(item));
      const open = filtered || state.expanded.has(b.id);
      body.push(el('tr', { class: 'rd-broad', 'data-topic': b.id }, [
        el('th', { scope: 'row', class: 'rd-name' }, el('span', { class: 'rd-name-row' }, [
          el('button', {
            type: 'button', class: 'rd-expand', 'aria-expanded': String(open), disabled: filtered ? true : null,
            'aria-label': `${open ? 'Hide' : 'Show'} the ${kids.length} fine topics in ${b.name}`, onclick: () => actions.expand(b.id),
          }, el('span', { 'aria-hidden': 'true', text: open ? '▾' : '▸' })),
          el('button', { type: 'button', class: 'rd-open', 'data-topic': b.id, onclick: () => actions.open(b.id) }, b.name),
        ])),
        el('td', { class: 'rd-facet', text: `${kids.length} of ${b.children.length} fine topics` }),
        el('td', { class: 'num', text: pct(r.share_now) }),
        el('td', { class: 'num' }, badge(r)),
        el('td', { class: 'num', text: r.z.toFixed(1) }),
        el('td', { class: 'num' }, trendCell(b.trend[state.filter])),
        el('td', null, sparkFor(v, r, b.name)),
        el('td', { class: 'num', text: fmtInt(r.n) }),
        el('td'),
      ]));
      if (open) kids.forEach((it) => body.push(fineRow(it, { child: true })));
    }
  }
  if (!body.length) {
    body.push(el('tr', null, el('td', { colspan: COLUMNS.length, class: 'rd-empty', text: 'No topics match these filters.' })));
  }

  const table = el('table', { class: 'rd-table' }, [
    el('caption', { class: 'vh', text: `Topics, ${RANGE_LABEL[state.range].toLowerCase()}, ${FILTER_LABEL[state.filter].toLowerCase()}` }),
    el('thead', null, head),
    el('tbody', null, body),
  ]);
  fill('rdTableWrap', table);

  const nHidden = [...state.hidden].filter((id) => idx.fine.has(id)).length;
  fill('rdHiddenLine', nHidden
    ? [`${nHidden} hidden · `, el('button', { type: 'button', class: 'rd-link', onclick: actions.showAll, text: 'show all' })]
    : []);
}

/* ------------------------------------------------------- papers per bucket */

export function renderVolume(radar) {
  const v = currentView(radar);
  const gran = v.window.granularity;
  const word = GRAN_WORD[gran];
  document.getElementById('h-volume').textContent = `Papers per ${word}`;
  fill('rdVolumeIntro', gran === 'day' ? 'Fewer papers are submitted at weekends, so daily bars dip every seven days.' : []);
  const { labels, counts } = v.volume;
  const fade = new Set();
  if (v.volume.partial_first) fade.add(0);
  if (v.volume.partial_last) fade.add(counts.length - 1);
  const name = `Papers per ${word}, ${fmtDate(v.window.start)} to ${fmtDate(v.window.end)}`;
  const box = document.getElementById('rdVolume');
  const chart = bars(counts, { xLabel: (i) => tickFor(gran, labels[i]), fade, name, width: box.clientWidth - 22 || 720 });
  const label = (i) => (gran === 'month' ? fmtMonth(labels[i]) : gran === 'week' ? 'the week of ' + fmtDate(labels[i]) : fmtDate(labels[i]));
  const whole = counts.map((c, i) => [c, i]).filter(([, i]) => !fade.has(i));
  const hi = whole.reduce((a, b) => (b[0] > a[0] ? b : a), whole[0]);
  const lo = whole.reduce((a, b) => (b[0] < a[0] ? b : a), whole[0]);
  /* A table ignores a 1px width, so the hiding class goes on a wrapper. */
  const table = el('div', { class: 'vh' }, el('table', null, [
    el('caption', { text: name }),
    el('thead', null, el('tr', null, [el('th', { scope: 'col', text: word }), el('th', { scope: 'col', text: 'Papers' })])),
    el('tbody', null, counts.map((c, i) => el('tr', null, [el('th', { scope: 'row', text: label(i) }), el('td', { text: String(c) })]))),
  ]));
  fill('rdVolume', [chart, table]);
  let text = `${fmtInt(v.totals.n)} papers from ${fmtDate(v.window.start)} to ${fmtDate(v.window.end)}.`;
  if (hi) text += ` The busiest ${word} was ${label(hi[1])} with ${fmtInt(hi[0])} papers, and the quietest was ${label(lo[1])} with ${fmtInt(lo[0])}.`;
  if (fade.size) text += fade.size === 2 ? ' The first and last bars are partial months, drawn faded.' : ' The faded bar is a partial month.';
  fill('rdVolumeText', text);
}

/* ------------------------------------------------------------------ terms */

export function renderTerms(radar) {
  const v = currentView(radar);
  fill('rdTermsIntro', state.range === '5Y'
    ? 'Phrases whose share of abstracts changed most between the first and the last year of the range. A phrase that only rises because one of its words does is folded into that word.'
    : `Phrases whose share of abstracts changed most against the previous ${PERIOD[state.range]}. A phrase that only rises because one of its words does is folded into that word.`);
  const list = (id, entries) => {
    const shown = entries.filter((e) => e.length === 4);
    if (!shown.length) return fill(id, el('p', { class: 'rd-empty', text: 'Too few papers in this range to compare phrases.' }));
    const max = Math.max(...shown.map((e) => Math.abs(e[3])));
    fill(id, el('ol', { class: 'rd-hbars' }, shown.map(([term, early, late, l2]) => el('li', null, [
      el('span', { class: 'rd-hbar-label', text: term }),
      el('span', { class: 'rd-hbar-track', 'aria-hidden': 'true' },
        el('span', { class: 'rd-hbar ' + (l2 > 0 ? 'up' : 'down'), style: `width:${(100 * Math.abs(l2) / max).toFixed(1)}%` })),
      el('span', { class: 'rd-hbar-text', text: `${early.toFixed(1)}% → ${late.toFixed(1)}% of abstracts` }),
    ]))));
  };
  list('rdGaining', v.terms.gaining);
  list('rdLosing', v.terms.losing);
}

/* ------------------------------------------------------------- categories */

export function renderCategories(radar) {
  const v = currentView(radar);
  const block = (title, entries) => {
    const max = Math.max(1e-9, ...entries.map((e) => e[1]));
    return el('div', null, [
      el('h3', { class: 'rd-h3', text: title }),
      entries.length
        ? el('ol', { class: 'rd-hbars' }, entries.map(([cat, p]) => el('li', null, [
          el('span', { class: 'rd-hbar-label rd-mono', text: cat }),
          el('span', { class: 'rd-hbar-track', 'aria-hidden': 'true' },
            el('span', { class: 'rd-hbar neutral', style: `width:${(100 * p / max).toFixed(1)}%` })),
          el('span', { class: 'rd-hbar-text', text: `${p.toFixed(1)}% of papers` }),
        ])))
        : el('p', { class: 'rd-empty', text: 'No papers in this range.' }),
    ]);
  };
  const out = [block('Also listed in', v.categories.colisted)];
  if (state.filter === 'cross') out.push(block('Primarily filed under', v.categories.cross_sources));
  fill('rdCats', out);
}

/* --------------------------------------------------------------- footer */

export function renderFixed(radar) {
  const m = radar.meta;
  fill('rdFootData', `Data: arXiv quant-ph, primary and cross-listed, through ${fmtDate(m.data_through)}. `
    + `Topic model fitted ${fmtDate(m.model.fitted_on)}. Paper metadata from arXiv.org, used under CC0 through `
    + 'the arXiv API. This tool is not affiliated with or endorsed by arXiv.');
  fill('rdUnassigned', `${m.unassigned_last_week_pct.toFixed(1)}%`);
  fill('rdNFine', fmtInt(m.model.n_topics));
  fill('rdNBroad', fmtInt(m.model.n_broad));
}

/* ------------------------------------------------------------ topic panel */

function paperList(rows, { withDate = true } = {}) {
  return el('ul', { class: 'rd-papers' }, rows.map((r) => el('li', null, [
    el('a', { href: `https://arxiv.org/abs/${r[0]}`, rel: 'noopener', text: r[1] }),
    withDate ? el('span', { class: 'rd-date', text: ' ' + fmtDate(r[2]) }) : null,
  ])));
}

export function renderPanel(radar, idx, id, actions, details) {
  const v = currentView(radar);
  const byId = rowsById(v);
  const meta = idx.get(id);
  const row = byId.get(id);
  const isBroad = idx.broad.has(id);
  const gran = v.window.granularity;
  const s = shares(v, row);
  const real = s.filter((x) => x !== null);
  const chartName = `Share of papers per ${GRAN_WORD[gran]} in ${meta.name}, ${fmtDate(v.window.start)} to ${fmtDate(v.window.end)}`;
  const panelBox = document.getElementById('rdPanel');
  const chart = line(s, { xLabel: (i) => tickFor(gran, v.volume.labels[i]), name: chartName,
    width: (panelBox.clientWidth || 700) - 2 * parseFloat(getComputedStyle(panelBox).paddingLeft || 20) - 22 });
  const lo = real.length ? Math.min(...real) : 0, hi = real.length ? Math.max(...real) : 0;
  const chartText = row.n
    ? `${fmtInt(row.n)} papers in this range, ${pct(row.n / v.totals.n)} of all of them. `
      + `Per ${GRAN_WORD[gran]}, the share ranged from ${pct(lo)} to ${pct(hi)}.`
    : 'No papers from this topic in this range.';
  const shareLabel = state.range === '5Y' ? 'Share, first year → last year'
    : `Share, previous ${PERIOD[state.range]} → last ${PERIOD[state.range]}`;

  const section = (title, body) => el('section', { class: 'rd-panel-sec' }, [el('h3', { class: 'rd-h3', text: title }), body]);
  const papersSlot = (title) => {
    const slot = el('div', { class: 'rd-papers-slot' }, el('p', { class: 'rd-note', text: 'Loading papers…' }));
    return [section(title, slot), slot];
  };

  const parts = [
    el('div', { class: 'rd-panel-head' }, [
      el('div', null, [
        el('p', { class: 'rd-panel-kicker', text: isBroad ? `Broad topic · ${meta.children.length} fine topics` : `${meta.facet} · part of ${idx.broad.get(meta.parent).name}` }),
        el('h2', { id: 'rdPanelTitle', text: meta.name }),
      ]),
      el('button', { type: 'button', class: 'wb-btn rd-close', onclick: actions.close, text: 'Close' }),
    ]),
    el('p', { class: 'rd-panel-desc', text: meta.description }),
    !isBroad && meta.unstable ? el('p', { class: 'rd-note', text: 'This topic\'s boundary moved when the model was refitted with different random seeds, so its counts are less certain than most.' }) : null,
    el('dl', { class: 'rd-panel-nums' }, [
      el('dt', { text: shareLabel }), el('dd', { text: `${pct(row.share_then)} → ${pct(row.share_now)}` }),
      el('dt', { text: 'Change' }), el('dd', null, badge(row)),
      el('dt', { text: 'Papers in range' }), el('dd', { text: fmtInt(row.n) }),
      el('dt', { text: '5-year trend' }), el('dd', null, trendCell(meta.trend[state.filter])),
    ]),
    el('div', { class: 'rd-chart' }, chart),
    el('p', { class: 'rd-summary', text: chartText }),
  ];
  if (!isBroad) {
    const pinned = state.pinned.has(id), hidden = state.hidden.has(id);
    parts.push(el('div', { class: 'wb-actions' }, [
      el('button', { type: 'button', class: 'wb-btn', 'aria-pressed': String(pinned), onclick: () => actions.pin(id) }, pinned ? 'Unpin' : 'Pin'),
      el('button', { type: 'button', class: 'wb-btn', 'aria-pressed': String(hidden), onclick: () => actions.hide(id) }, hidden ? 'Show' : 'Hide'),
      el('span', { class: 'saved-note', text: 'Saved on this device' }),
    ]));
  }
  parts.push(section('Top terms', el('ul', { class: 'rd-terms' }, meta.terms.map((t) => el('li', { text: t })))));

  let typicalSlot = null, latestSlot;
  if (isBroad) {
    const kids = meta.children.map((c) => ({ t: idx.fine.get(c), r: byId.get(c) })).sort((a, b) => b.r.share_now - a.r.share_now);
    parts.push(section('Fine topics', el('ul', { class: 'rd-kids' }, kids.map(({ t, r }) => el('li', null, [
      el('button', { type: 'button', class: 'rd-link', onclick: () => actions.open(t.id), text: t.name }),
      el('span', { class: 'rd-kid-nums', text: ` ${pct(r.share_now)} · ` }), badge(r),
    ])))));
  } else {
    let sec;
    [sec, typicalSlot] = papersSlot('Typical papers');
    parts.push(sec);
  }
  let latestSec;
  [latestSec, latestSlot] = papersSlot('Latest in this range');
  parts.push(latestSec);
  if (!isBroad) {
    parts.push(section('Close neighbours', el('ul', { class: 'rd-kids' }, meta.neighbours.map((n) => {
      const t = idx.fine.get(n);
      return el('li', null, el('button', { type: 'button', class: 'rd-link', onclick: () => actions.open(n), text: t.name }));
    }))));
  }
  /* Lineage exists from the second model version on: how this topic relates to
     the previous fit's topics, judged by the papers both assigned. */
  const lin = !isBroad && meta.lineage;
  if (lin) {
    const names = lin.names.map((n) => `"${n}"`).join(' and ');
    const text = {
      continues: `Continues ${names} from ${lin.version}.`,
      split: `Split from ${names} in ${lin.version}.`,
      merged: `Merged from ${names} in ${lin.version}.`,
      new: `New in ${radar.meta.model.version}: no topic in ${lin.version} matches it closely.`,
    }[lin.kind];
    if (text) parts.push(section('History', el('p', { class: 'rd-note', text })));
  }
  const panel = document.getElementById('rdPanel');
  panel.replaceChildren(...parts.filter(Boolean));

  details.then((d) => {
    if (panel.dataset.topic !== id) return;
    const inRange = (r) => r[2] >= v.window.start && r[2] <= v.window.end
      && (state.filter === 'all' || (state.filter === 'primary') === (r[3] === 1));
    const ids = isBroad ? meta.children : [id];
    const latest = ids.flatMap((t) => d.topics[t].latest).filter(inRange)
      .sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0)).slice(0, 10);
    latestSlot.replaceChildren(latest.length ? paperList(latest)
      : el('p', { class: 'rd-empty', text: 'No papers from this topic in this range.' }));
    if (typicalSlot) typicalSlot.replaceChildren(paperList(d.topics[id].typical));
  }).catch(() => {
    const msg = 'The paper lists didn\'t load. Close and reopen the topic to try again.';
    latestSlot.replaceChildren(el('p', { class: 'rd-empty', text: msg }));
    if (typicalSlot) typicalSlot.replaceChildren(el('p', { class: 'rd-empty', text: msg }));
  });
}
