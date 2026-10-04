/* ============================================================================
   charts.js: inline-SVG drawing primitives for the radar. No library.

   Rules, the same as the workbench's charts:
     * Colour is never the only cue. A partial bar is faded AND labelled in the
       text summary; up and down carry an arrow and a sign in render.js.
     * Every colour is a global token (or radar.css's --up / --down), so both
       themes and the reading panel work without a second palette.
     * Nothing animates. These are read, not watched.
     * Every chart gets an accessible name here; render.js adds the sentence or
       hidden table that carries the actual numbers.
   ============================================================================ */

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, props, children) {
  const node = document.createElementNS(NS, tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/* Round tick values from lo up to the first tick at or above hi, so the axis
   always covers the tallest bar instead of stopping short of it. */
export function niceTicks(lo, hi, count) {
  if (!(hi > lo)) return [lo, lo + 1];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag;
  const out = [];
  let v = Math.ceil(lo / step) * step;
  for (; v < hi - 1e-9; v += step) out.push(Number(v.toFixed(10)));
  out.push(Number(v.toFixed(10)));
  return out;
}

/* Charts are drawn at the pixel width of their container (render.js passes
   it in), so tick labels stay at their real size on a phone instead of
   shrinking with a scaled-down viewBox. */

/* Column chart of counts. xLabel(i) gives the tick text for bar i; ticks are
   thinned to about eight so they never collide. fade marks bars to draw faded
   (partial months). */
export function bars(counts, { xLabel, fade = new Set(), name, height = 190, width = 720 }) {
  const W = Math.max(280, Math.round(width)), H = height, L = 44, R = 8, T = 10, B = 26;
  const n = counts.length;
  const max = Math.max(1, ...counts);
  const ticks = niceTicks(0, max, 4);
  const top = ticks[ticks.length - 1];
  const x = (i) => L + (i * (W - L - R)) / n;
  const bw = Math.max(1, ((W - L - R) / n) * 0.8);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const kids = [];
  for (const tv of ticks) {
    kids.push(svgEl('line', { x1: L, x2: W - R, y1: y(tv), y2: y(tv), class: 'rd-grid' }));
    kids.push(svgEl('text', { x: L - 6, y: y(tv) + 4, 'text-anchor': 'end', class: 'rd-tick', text: tv.toLocaleString('en-GB') }));
  }
  counts.forEach((c, i) => {
    kids.push(svgEl('rect', {
      x: x(i) + ((W - L - R) / n - bw) / 2, y: y(c), width: bw, height: Math.max(0, H - B - y(c)),
      class: fade.has(i) ? 'rd-bar rd-bar-partial' : 'rd-bar',
    }));
  });
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 80))));
  for (let i = 0; i < n; i += every) {
    kids.push(svgEl('text', { x: x(i) + (W - L - R) / n / 2, y: H - 8, 'text-anchor': 'middle', class: 'rd-tick', text: xLabel(i) }));
  }
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rd-svg', role: 'img', 'aria-label': name }, kids);
}

/* A share line, with the y axis in percent. values are fractions; null gaps
   (an empty bucket in the denominator) break the line rather than dive to 0. */
export function line(values, { xLabel, name, height = 170, width = 640 }) {
  const W = Math.max(280, Math.round(width)), H = height, L = 52, R = 10, T = 10, B = 26;
  const n = values.length;
  const real = values.filter((v) => v !== null);
  const max = Math.max(1e-6, ...real);
  const ticks = niceTicks(0, max * 100, 4);
  const top = ticks[ticks.length - 1] / 100;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const kids = [];
  for (const tv of ticks) {
    kids.push(svgEl('line', { x1: L, x2: W - R, y1: y(tv / 100), y2: y(tv / 100), class: 'rd-grid' }));
    kids.push(svgEl('text', { x: L - 6, y: y(tv / 100) + 4, 'text-anchor': 'end', class: 'rd-tick', text: tv + '%' }));
  }
  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    d += (d && values[i - 1] !== null ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
  });
  kids.push(svgEl('path', { d, class: 'rd-line' }));
  if (n <= 60) values.forEach((v, i) => { if (v !== null) kids.push(svgEl('circle', { cx: x(i), cy: y(v), r: 2.4, class: 'rd-dot' })); });
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 90))));
  for (let i = 0; i < n; i += every) {
    kids.push(svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'rd-tick', text: xLabel(i) }));
  }
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rd-svg', role: 'img', 'aria-label': name }, kids);
}

/* A sparkline of share per bucket. Fixed vertical scale per line (its own max),
   which is what a sparkline is for: shape, not size. The accessible name says
   the first and last values. */
export function spark(values, { name, w = 96, h = 24 }) {
  const real = values.filter((v) => v !== null);
  const max = Math.max(1e-9, ...real);
  const n = values.length;
  const x = (i) => (n === 1 ? w / 2 : 1 + (i * (w - 2)) / (n - 1));
  const y = (v) => h - 2 - (h - 4) * (v / max);
  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    d += (d && values[i - 1] !== null ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
  });
  return svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'rd-spark', role: 'img', 'aria-label': name },
    [svgEl('path', { d, class: 'rd-line' })]);
}

/* Twelve small columns, one per week, for an emerging group. */
export function strip(counts, { name, w = 120, h = 22 }) {
  const max = Math.max(1, ...counts);
  const bw = w / counts.length;
  const kids = counts.map((c, i) => svgEl('rect', {
    x: i * bw + 1, width: bw - 2, y: c ? h - 1 - (h - 2) * (c / max) : h - 2, height: c ? (h - 2) * (c / max) : 1,
    class: c ? 'rd-bar' : 'rd-bar rd-bar-empty',
  }));
  return svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'rd-strip', role: 'img', 'aria-label': name }, kids);
}
