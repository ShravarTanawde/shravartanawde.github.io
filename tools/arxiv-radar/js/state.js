/* ============================================================================
   state.js: what the visitor has chosen, and where it is remembered.

   Rules:
     * The URL holds the view (range, filter, facets, search, open topic), so
       any view can be linked: ?range=1Y&filter=primary&topic=t017.
     * Browser storage holds personal conveniences only (last range and
       filter, hidden and pinned topics, the machine-learning toggle, the table
       layout), under the one key qp-radar. Every access is wrapped: in a
       private window or with storage blocked, the page still works and simply
       forgets.
     * A value from the URL or storage that this page does not recognise is
       dropped, not trusted.
   ============================================================================ */

export const RANGES = ['1W', '1M', '3M', '6M', '1Y', '5Y'];
export const FILTERS = ['all', 'primary', 'cross'];
export const LAYOUTS = ['grouped', 'flat'];
export const SORT_KEYS = ['name', 'share', 'delta', 'z', 'trend', 'n'];
export const DEFAULT_RANGE = '1Y';
const KEY = 'qp-radar';

export const state = {
  range: DEFAULT_RANGE,
  filter: 'all',
  facets: new Set(),
  q: '',
  topic: null,
  layout: 'grouped',
  sort: { key: 'share', dir: 'desc' },
  hidden: new Set(),
  pinned: new Set(),
  hideML: false,
  expanded: new Set(),
  showHidden: false,
};

function readStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      range: state.range, filter: state.filter, layout: state.layout, hideML: state.hideML,
      hidden: [...state.hidden], pinned: [...state.pinned],
    }));
  } catch (e) { /* storage blocked: the page keeps working, it just forgets */ }
}

/* Topic ids, facets and so on are checked against the data, which only exists
   after loading, so restore() takes the valid sets as arguments. */
export function restore(valid) {
  const s = readStore();
  if (RANGES.includes(s.range)) state.range = s.range;
  if (FILTERS.includes(s.filter)) state.filter = s.filter;
  if (LAYOUTS.includes(s.layout)) state.layout = s.layout;
  state.hideML = s.hideML === true;
  state.hidden = new Set((s.hidden || []).filter((id) => valid.topics.has(id)));
  state.pinned = new Set((s.pinned || []).filter((id) => valid.topics.has(id)));

  const p = new URLSearchParams(location.search);
  if (RANGES.includes(p.get('range'))) state.range = p.get('range');
  if (FILTERS.includes(p.get('filter'))) state.filter = p.get('filter');
  const facets = (p.get('facet') || '').split(',').filter((f) => valid.facets.has(f));
  state.facets = new Set(facets);
  state.q = (p.get('q') || '').slice(0, 80);
  const t = p.get('topic');
  state.topic = t && (valid.topics.has(t) || valid.broad.has(t)) ? t : null;
}

export function writeURL() {
  const p = new URLSearchParams();
  if (state.range !== DEFAULT_RANGE) p.set('range', state.range);
  if (state.filter !== 'all') p.set('filter', state.filter);
  if (state.facets.size) p.set('facet', [...state.facets].join(','));
  if (state.q) p.set('q', state.q);
  if (state.topic) p.set('topic', state.topic);
  const qs = p.toString();
  try { history.replaceState(null, '', qs ? '?' + qs : location.pathname); } catch (e) { /* file:// or sandboxed */ }
}
