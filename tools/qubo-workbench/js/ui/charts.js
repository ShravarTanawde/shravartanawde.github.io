/* ============================================================================
   charts.js: Step 3's drawing primitives, and the eight views built from them.
   Inline SVG, no library.

   Three rules, applied to every chart here:

     * Colour is never the only cue. Series carry a dash pattern as well as a
       hue, and every chart is followed by a text summary carrying the numbers
       that matter, so the chart is an aid rather than the only way in.
     * Everything comes from the global tokens, so both themes work without a
       second palette.
     * Nothing animates. These are read, not watched.
   ============================================================================ */

import { el, formatCoeff } from './render.js?v=1';

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, props, children) {
  const node = document.createElementNS
    ? document.createElementNS(NS, tag)
    : document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

/* Four series at most anywhere in Step 3, each with its own hue AND stroke. */
export const SERIES_STYLE = [
  { stroke: 'var(--ax-z)', dash: null },
  { stroke: 'var(--ax-x)', dash: '6 3' },
  { stroke: 'var(--ax-y)', dash: '2 3' },
  { stroke: 'var(--muted)', dash: '9 3 2 3' }
];

function niceTicks(lo, hi, count) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out.length ? out : [lo, hi];
}

/* --------------------------------------------------------------- line chart */

/**
 * @param {object} opts
 * @param {Array<{label, xs:number[], ys:number[]}>} opts.series
 * @param {string} opts.xLabel, opts.yLabel, opts.caption (the text alternative)
 * @param {Array<{y:number,label:string}>} [opts.rules] horizontal reference lines
 */
export function lineChart(opts) {
  const W = 520, H = 230, padL = 54, padR = 14, padT = 12, padB = 34;
  const series = opts.series.filter((s) => s.xs.length);
  if (!series.length) return el('p', { class: 'wb-muted', text: 'Nothing to plot.' });

  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const s of series) {
    for (const x of s.xs) { if (x < xlo) xlo = x; if (x > xhi) xhi = x; }
    for (const y of s.ys) { if (y < ylo) ylo = y; if (y > yhi) yhi = y; }
  }
  for (const r of (opts.rules || [])) { if (r.y < ylo) ylo = r.y; if (r.y > yhi) yhi = r.y; }
  if (yhi === ylo) { yhi = ylo + 1; ylo -= 1; }
  const pad = (yhi - ylo) * 0.08;
  ylo -= pad; yhi += pad;

  const sx = (x) => padL + (xhi === xlo ? 0 : (x - xlo) / (xhi - xlo)) * (W - padL - padR);
  const sy = (y) => H - padB - ((y - ylo) / (yhi - ylo)) * (H - padT - padB);

  const kids = [];

  for (const tick of niceTicks(ylo, yhi, 4)) {
    const y = sy(tick);
    kids.push(svgEl('line', { class: 'ch-grid', x1: padL, y1: y, x2: W - padR, y2: y }));
    kids.push(svgEl('text', { class: 'ch-tick', x: padL - 7, y: y + 3.5, 'text-anchor': 'end', text: formatCoeff(tick, 2) }));
  }
  for (const tick of niceTicks(xlo, xhi, 5)) {
    const x = sx(tick);
    kids.push(svgEl('text', { class: 'ch-tick', x: x, y: H - padB + 16, 'text-anchor': 'middle', text: formatCoeff(tick, 2) }));
  }

  for (const r of (opts.rules || [])) {
    const y = sy(r.y);
    kids.push(svgEl('line', { class: 'ch-rule', x1: padL, y1: y, x2: W - padR, y2: y }));
    kids.push(svgEl('text', { class: 'ch-rule-label', x: W - padR, y: y - 5, 'text-anchor': 'end', text: r.label }));
  }

  kids.push(svgEl('line', { class: 'ch-axis', x1: padL, y1: padT, x2: padL, y2: H - padB }));
  kids.push(svgEl('line', { class: 'ch-axis', x1: padL, y1: H - padB, x2: W - padR, y2: H - padB }));

  series.forEach((s, i) => {
    const style = SERIES_STYLE[i % SERIES_STYLE.length];
    const d = s.xs.map((x, k) => (k ? 'L' : 'M') + sx(x).toFixed(2) + ' ' + sy(s.ys[k]).toFixed(2)).join(' ');
    kids.push(svgEl('path', {
      class: 'ch-line', d: d, style: 'stroke:' + style.stroke,
      'stroke-dasharray': style.dash
    }));
    if (s.xs.length <= 12) {
      s.xs.forEach((x, k) => kids.push(svgEl('circle', {
        class: 'ch-dot', cx: sx(x), cy: sy(s.ys[k]), r: 3, style: 'fill:' + style.stroke
      })));
    }
  });

  kids.push(svgEl('text', { class: 'ch-axis-label', x: padL, y: H - 3, text: opts.xLabel || '' }));
  kids.push(svgEl('text', {
    class: 'ch-axis-label', x: 10, y: padT + 4,
    transform: 'rotate(-90 10 ' + (padT + 4) + ')', text: opts.yLabel || ''
  }));

  const svg = svgEl('svg', {
    class: 'wb-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
    'aria-label': opts.caption || ''
  }, [svgEl('title', { text: opts.caption || '' }), ...kids]);

  return el('figure', { class: 'wb-figure' }, [
    svg,
    series.length > 1 ? legend(series) : null,
    opts.caption ? el('figcaption', { text: opts.caption }) : null
  ]);
}

function legend(series) {
  return el('ul', { class: 'wb-legend-list' }, series.map((s, i) => {
    const style = SERIES_STYLE[i % SERIES_STYLE.length];
    return el('li', null, [
      svgEl('svg', { class: 'key', viewBox: '0 0 24 8', 'aria-hidden': 'true' }, [
        svgEl('line', {
          x1: 1, y1: 4, x2: 23, y2: 4, style: 'stroke:' + style.stroke,
          'stroke-width': 2, 'stroke-dasharray': style.dash
        })
      ]),
      s.label
    ]);
  }));
}

/* ------------------------------------------------------------------ heatmap */

/**
 * A grid of rects. Diverging around the midpoint, using the same encoding as the
 * Q matrix so the two read consistently: cool = low = good, warm = high.
 *
 * @param {object} opts {values:Float64Array, cols, rows, xMax, yMax, xLabel,
 *                       yLabel, mark:{x,y,label}, caption, invert}
 */
export function heatmap(opts) {
  const { values, cols, rows } = opts;
  const W = 420, H = 240, padL = 46, padR = 12, padT = 10, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;

  const cw = plotW / cols, ch = plotH / rows;
  const kids = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = (values[r * cols + c] - lo) / span;      // 0 = lowest
      /* two hues rather than one ramp, so "better than average" and "worse" are
         distinguishable at a glance and not only by brightness */
      const cool = t < 0.5;
      const strength = (cool ? (0.5 - t) : (t - 0.5)) * 2;
      kids.push(svgEl('rect', {
        x: (padL + c * cw).toFixed(2), y: (padT + (rows - 1 - r) * ch).toFixed(2),
        width: (cw + 0.6).toFixed(2), height: (ch + 0.6).toFixed(2),
        style: 'fill:' + (cool ? 'var(--ax-x)' : 'var(--ax-y)') +
               ';fill-opacity:' + (0.06 + 0.84 * strength).toFixed(3)
      }));
    }
  }

  if (opts.mark) {
    const mx = padL + (opts.mark.x / opts.xMax) * plotW;
    const my = padT + plotH - (opts.mark.y / opts.yMax) * plotH;
    kids.push(svgEl('circle', { class: 'ch-mark', cx: mx.toFixed(2), cy: my.toFixed(2), r: 5 }));
    kids.push(svgEl('circle', { class: 'ch-mark-dot', cx: mx.toFixed(2), cy: my.toFixed(2), r: 1.6 }));
  }

  for (const [frac, label] of [[0, '0'], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, '1']]) {
    kids.push(svgEl('text', {
      class: 'ch-tick', x: (padL + frac * plotW).toFixed(1), y: H - padB + 15,
      'text-anchor': 'middle', text: label === '0' ? '0' : label + '·' + (opts.xUnit || '')
    }));
    kids.push(svgEl('text', {
      class: 'ch-tick', x: padL - 6, y: (padT + plotH - frac * plotH + 3.5).toFixed(1),
      'text-anchor': 'end', text: label === '0' ? '0' : label + '·' + (opts.yUnit || '')
    }));
  }

  kids.push(svgEl('rect', { class: 'ch-frame', x: padL, y: padT, width: plotW, height: plotH }));
  kids.push(svgEl('text', { class: 'ch-axis-label', x: padL, y: H - 3, text: opts.xLabel || '' }));
  kids.push(svgEl('text', {
    class: 'ch-axis-label', x: 10, y: padT + 4,
    transform: 'rotate(-90 10 ' + (padT + 4) + ')', text: opts.yLabel || ''
  }));

  return el('figure', { class: 'wb-figure' }, [
    svgEl('svg', {
      class: 'wb-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': opts.caption || ''
    }, [svgEl('title', { text: opts.caption || '' }), ...kids]),
    el('p', { class: 'wb-legend' }, [
      el('span', { class: 'swatch', 'data-sign': 'neg', 'aria-hidden': 'true' }),
      opts.lowLabel || 'lower cost',
      el('span', { class: 'swatch', 'data-sign': 'pos', 'aria-hidden': 'true' }),
      opts.highLabel || 'higher cost',
      opts.mark ? el('span', { class: 'sep', text: '·' }) : null,
      opts.mark ? '○ ' + opts.mark.label : null
    ]),
    opts.caption ? el('figcaption', { text: opts.caption }) : null
  ]);
}

/* ---------------------------------------------------------------- histogram */

export function histogram(opts) {
  const { counts, bins } = opts;
  const W = 520, H = 190, padL = 48, padR = 12, padT = 12, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let peak = 0;
  for (const v of counts) if (v > peak) peak = v;
  if (peak <= 0) peak = 1;

  const bw = plotW / bins;
  const kids = [];
  for (let i = 0; i < bins; i++) {
    const h = (counts[i] / peak) * plotH;
    kids.push(svgEl('rect', {
      class: 'ch-bar', x: (padL + i * bw + 0.5).toFixed(2), y: (padT + plotH - h).toFixed(2),
      width: Math.max(1, bw - 1).toFixed(2), height: h.toFixed(2),
      /* the lowest-energy bin is the one people are looking for */
      style: i === 0 ? 'fill:var(--ax-x)' : null
    }));
  }
  kids.push(svgEl('line', { class: 'ch-axis', x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH }));
  kids.push(svgEl('text', { class: 'ch-tick', x: padL, y: H - padB + 16, 'text-anchor': 'start', text: formatCoeff(opts.emin, 2) + ' (best)' }));
  kids.push(svgEl('text', { class: 'ch-tick', x: W - padR, y: H - padB + 16, 'text-anchor': 'end', text: formatCoeff(opts.emax, 2) + ' (worst)' }));
  kids.push(svgEl('text', { class: 'ch-axis-label', x: padL, y: H - 3, text: opts.xLabel || 'energy' }));
  kids.push(svgEl('text', {
    class: 'ch-axis-label', x: 10, y: padT + 4,
    transform: 'rotate(-90 10 ' + (padT + 4) + ')', text: 'probability'
  }));

  return el('figure', { class: 'wb-figure' }, [
    svgEl('svg', {
      class: 'wb-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': opts.caption || ''
    }, [svgEl('title', { text: opts.caption || '' }), ...kids]),
    opts.caption ? el('figcaption', { text: opts.caption }) : null
  ]);
}


/* ============================================================================
   The eight views, in the priority order Step 3 presents them.

   Each takes a plain data object computed by pipeline.js and returns a section.
   None of them compute anything, and none of them know about each other, so the
   step can render whatever has finished so far and fill the rest in as it lands.
   ============================================================================ */

function section(order, title, blurb, children) {
  return el('section', { class: 'wb-sub', 'data-order': String(order) }, [
    el('h4', { class: 'wb-h4' }, [el('span', { class: 'ord', text: String(order) }), title]),
    blurb ? el('p', { class: 'wb-sub-blurb', text: blurb }) : null,
    ...[].concat(children).filter(Boolean)
  ]);
}

function factRow(items) {
  return el('div', { class: 'wb-facts' }, items.map(([k, v, note]) => el('div', { class: 'fact' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v' }, [String(v), note ? el('small', { text: ' ' + note }) : null])
  ])));
}

const pct = (x) => (x * 100).toFixed(x < 0.001 && x > 0 ? 4 : 2) + '%';

/* --- 1. optimizer comparison ------------------------------------------- */

export function viewOptimizers(data) {
  const best = data.runs.reduce((a, b) => (b.best < a.best ? b : a));
  const stuck = data.runs.filter((r) => r.best > data.gridBest + 1e-6);
  const gap = best.best - data.gridBest;

  const children = [
    lineChart({
      series: data.runs.map((r) => ({ label: r.label, xs: r.trace.map((_, i) => i), ys: r.trace })),
      xLabel: 'iteration', yLabel: '⟨C⟩',
      rules: [
        { y: data.gridBest, label: 'best found by sweeping' },
        { y: data.groundEnergy, label: 'ground state' }
      ],
      caption: 'Convergence of four optimizers from a common start. ' +
        data.runs.map((r) => r.label + ' reaches ' + formatCoeff(r.best, 3)).join('; ') +
        '. The best p=1 parameters anywhere give ' + formatCoeff(data.gridBest, 3) +
        ', and the ground state is at ' + formatCoeff(data.groundEnergy, 3) + '.'
    }),
    factRow([
      ['Best method', best.label],
      ['Reached', formatCoeff(best.best, 4)],
      ['Best on the p=1 sweep', formatCoeff(data.gridBest, 4)],
      ['Ground state', formatCoeff(data.groundEnergy, 4)]
    ])
  ];

  /* The gap between "what an optimizer found" and "what p=1 can do" is the most
     useful thing on this chart, so it is stated rather than left to be inferred
     from two lines. It is also usually non-zero, which is the point. */
  if (stuck.length) {
    children.push(el('div', { class: 'wb-callout', 'data-level': gap > 1e-6 ? 'warn' : 'note' }, [
      el('span', { class: 'ico', 'aria-hidden': 'true', text: '~' }),
      el('p', { class: 'title', text: stuck.length + ' of ' + data.runs.length + ' stopped short of what the sweep found' }),
      el('p', { text:
        (gap > 1e-6
          ? 'Even the best of them, ' + best.label + ', finished ' + formatCoeff(gap, 3) +
            ' above the lowest point the sweep in section 4 landed on. '
          : best.label + ' did reach it, but ' + stuck.map((r) => r.label).join(', ') +
            ' did not. ') +
        'That is not a bug in the optimizers: the p=1 landscape has local minima, and a large flat ' +
        'region at γ = 0 where the circuit does nothing at all. Which start you pick decides which ' +
        'of those you fall into, which is what section 5 is about.' })
    ]));
  }

  children.push(el('ul', { class: 'wb-notes' }, data.runs.map((r) =>
    el('li', null, [el('b', { text: r.label + ': ' }), r.note]))));

  return section(1, 'Optimizer comparison',
    'All four start from the same point and get the same budget, so the difference between the ' +
    'lines is the method and nothing else. The value plotted is the best seen so far, which is what ' +
    'you would actually keep.', children);
}

/* --- 2. approximation ratio -------------------------------------------- */

export function viewRatio(data) {
  const first = data.points[0];
  const children = [
    factRow([
      ['Ratio at p=1', first.ratio.toFixed(4)],
      ['⟨C⟩', formatCoeff(first.energy, 4)],
      ['P(optimum)', pct(first.groundProbability)],
      ['Depth reached', 'p = ' + data.points[data.points.length - 1].p]
    ]),
    el('p', { class: 'wb-muted', text:
      'The ratio is measured from the worst assignment to the best: 1.000 means the circuit lands ' +
      'on the ground state every time, 0.000 means it lands on the worst. Both ends come from the ' +
      'brute-force search, which is why this number exists only below the cap.' })
  ];

  if (data.points.length > 1) {
    children.push(lineChart({
      series: [
        { label: 'approximation ratio', xs: data.points.map((d) => d.p), ys: data.points.map((d) => d.ratio) },
        { label: 'P(optimum)', xs: data.points.map((d) => d.p), ys: data.points.map((d) => d.groundProbability) }
      ],
      xLabel: 'circuit depth p', yLabel: 'fraction',
      rules: [{ y: 1, label: 'perfect' }],
      caption: 'Approximation ratio against circuit depth: ' +
        data.points.map((d) => 'p=' + d.p + ' → ' + d.ratio.toFixed(3)).join(', ') + '.'
    }));
  } else if (data.deeperAvailable) {
    children.push(el('div', { class: 'wb-callout', 'data-level': 'note' }, [
      el('span', { class: 'ico', 'aria-hidden': 'true', text: 'i' }),
      el('p', { class: 'title', text: 'Deeper circuits are not drawn yet' }),
      el('p', { text:
        'p=1 has a closed form, so it is free at any size below the cap. Past p=1 every evaluation ' +
        'needs the whole statevector, and that doubles with each qubit. At ' + data.qubitCount +
        ' qubits the curve is worth asking for rather than assuming.' }),
      el('div', { class: 'wb-actions' }, [
        el('button', { class: 'wb-btn', type: 'button', id: 'wbDeeperP', text: 'Compute p = 2 and 3 anyway' })
      ])
    ]));
  }
  return section(2, 'Approximation ratio', null, children);
}

/* --- 3. solution quality ----------------------------------------------- */

export function viewDistribution(data) {
  const lift = data.uniformGroundProbability > 0
    ? data.groundProbability / data.uniformGroundProbability : Infinity;
  return section(3, 'What you would actually measure',
    'The circuit does not return an answer, it returns a distribution. This is that distribution, ' +
    'binned by energy, at the best parameters found above.',
    [
      histogram({
        counts: data.counts, bins: data.bins, emin: data.emin, emax: data.emax,
        caption: 'Output probability by energy. P(optimum) = ' + pct(data.groundProbability) +
          ', against ' + pct(data.uniformGroundProbability) + ' for random guessing.'
      }),
      factRow([
        ['P(optimum)', pct(data.groundProbability)],
        ['Random guessing', pct(data.uniformGroundProbability)],
        ['Improvement', Number.isFinite(lift) ? lift.toFixed(1) + '×' : '–'],
        ['Most likely single result', data.topBits + ' at ' + pct(data.topProbability)]
      ])
    ]);
}

/* --- 4. the p=1 landscape ---------------------------------------------- */

export function viewLandscape(data) {
  return section(4, 'The p = 1 cost landscape',
    'At p=1 there are exactly two parameters, so this is the whole landscape. Nothing is projected ' +
    'away and nothing is hidden. There is no honest picture like this at p>1, so the tool does not ' +
    'draw one.',
    [
      heatmap({
        values: data.F, cols: data.gammaSteps, rows: data.betaSteps,
        xMax: data.gammaMax, yMax: data.betaMax, xUnit: '2π', yUnit: 'π',
        xLabel: 'γ', yLabel: 'β',
        mark: { x: data.bestAt.gamma, y: data.bestAt.beta, label: 'lowest cell on this grid' },
        caption: '⟨C⟩ over γ ∈ [0, 2π] and β ∈ [0, π]. The lowest point on the grid is ' +
          formatCoeff(data.best, 3) + ' at γ = ' + data.bestAt.gamma.toFixed(3) +
          ', β = ' + data.bestAt.beta.toFixed(3) + '; the highest is ' + formatCoeff(data.worst, 3) + '.'
      }),
      el('ul', { class: 'wb-notes' }, [
        ...data.symmetry.notes.map((n) => el('li', { text: n })),
        data.windowed
          ? el('li', null, [el('b', { text: 'This is a window, not the whole period. ' }),
            'The coefficients here are large enough that ⟨C⟩ turns over roughly ' +
            Math.round(data.oscillations) + ' times across γ ∈ [0, 2π]. Drawing all of it at this ' +
            'width would show stripes that are an artefact of the sampling rather than the landscape, ' +
            'so the sweep is narrowed to a range it can actually resolve.'])
          : null
      ].filter(Boolean))
    ]);
}

/* --- 5. initialisation -------------------------------------------------- */

export function viewInitialization(data) {
  return section(5, 'Where you start matters',
    'The same optimizer, from different starting points. The linear ramp is the standard warm start; ' +
    'the rest are random.',
    [
      lineChart({
        series: data.runs.map((r) => ({ label: r.label, xs: r.trace.map((_, i) => i), ys: r.trace })),
        xLabel: 'iteration', yLabel: '⟨C⟩',
        rules: [{ y: data.groundEnergy, label: 'ground state' }],
        caption: 'One optimizer from ' + data.runs.length + ' starting points. Final values: ' +
          data.runs.map((r) => r.label + ' ' + formatCoeff(r.best, 3)).join(', ') + '.'
      }),
      factRow([
        ['Best start', data.runs.reduce((a, b) => (b.best < a.best ? b : a)).label],
        ['Spread', formatCoeff(Math.max(...data.runs.map((r) => r.best)) - Math.min(...data.runs.map((r) => r.best)), 4)],
        ['Ground state', formatCoeff(data.groundEnergy, 4)]
      ])
    ]);
}

/* --- 6. parameter sensitivity ------------------------------------------ */

export function viewSensitivity(data) {
  return section(6, 'How sharp is the optimum?',
    'The curvature at the best point found, as Hessian eigenvalues and as a one-dimensional cut ' +
    'along each parameter. Cuts rather than a surface: at p>1 there is no surface to show, and ' +
    'faking a projection of one would say more than the tool knows.',
    [
      factRow([
        ['Stiffest direction', formatCoeff(data.eigenvalues[0], 4)],
        ['Softest direction', formatCoeff(data.eigenvalues[data.eigenvalues.length - 1], 4)],
        ['Anisotropy', Number.isFinite(data.anisotropy) ? data.anisotropy.toFixed(1) + '×' : 'unbounded'],
        ['Downhill directions left', String(data.negativeDirections)]
      ]),
      lineChart({
        series: data.slices.map((s) => ({
          label: s.label + ' through the optimum',
          xs: s.xs, ys: s.ys
        })),
        xLabel: 'parameter value', yLabel: '⟨C⟩',
        caption: 'One-dimensional cuts through the best point, one per parameter. ' +
          'Eigenvalues of the Hessian: ' + data.eigenvalues.map((v) => formatCoeff(v, 3)).join(', ') + '.'
      }),
      data.negativeDirections > 0
        ? el('p', { class: 'wb-muted', text:
          'A negative eigenvalue means this point is not a minimum in that direction: the optimizer ' +
          'stopped on a saddle, or simply ran out of iterations.' })
        : null
    ]);
}

/* --- 7. flatness -------------------------------------------------------- */

export function viewFlatness(data) {
  return section(7, 'Where the landscape is flat',
    'The size of the gradient across the same p=1 grid. Dark regions are flat: an optimizer that ' +
    'starts there has almost nothing to follow.',
    [
      heatmap({
        values: data.G, cols: data.gammaSteps, rows: data.betaSteps,
        xMax: data.gammaMax, yMax: data.betaMax, xUnit: '2π', yUnit: 'π',
        xLabel: 'γ', yLabel: 'β',
        lowLabel: 'flat, little to follow', highLabel: 'steep',
        caption: '|∇⟨C⟩| over the same grid. ' + pct(data.flatFraction) +
          ' of the landscape has a gradient under 1% of the peak; the mean magnitude is ' +
          formatCoeff(data.mean, 3) + '.'
      }),
      factRow([
        ['Steepest', formatCoeff(data.peak, 4)],
        ['Mean', formatCoeff(data.mean, 4)],
        ['Variance', formatCoeff(data.variance, 4)],
        ['Nearly flat', pct(data.flatFraction), 'of the grid']
      ]),
      /* The wording here is a constraint, not a preference: calling this a
         barren plateau would claim a variance-versus-system-size result that
         this tool does not produce. */
      el('p', { class: 'wb-muted', text:
        'This is a map of one instance at one size, so it can say where the landscape is flat but ' +
        'not why. Showing that flatness grows with the number of qubits would take a sweep across ' +
        'system sizes, which the tool does not do, so it says "flat region" and stops there.' })
    ]);
}

/* --- 8. energy-scale separation ---------------------------------------- */

export function viewScale(data) {
  const level = data.level === 'ok' ? 'note' : (data.level === 'warn' ? 'warn' : 'stop');
  return section(8, 'Energy-scale separation', null, [
    el('div', { class: 'wb-callout', 'data-level': level }, [
      el('span', { class: 'ico', 'aria-hidden': 'true', text: data.level === 'ok' ? '✓' : '!' }),
      el('p', { class: 'title', text: data.level === 'ok' ? 'Coefficients are on a comparable scale' : 'The coefficients are far apart' }),
      el('p', { text: data.message })
    ]),
    factRow([
      ['Largest |coefficient|', formatCoeff(data.largest, 4)],
      ['Smallest non-zero', formatCoeff(data.smallest, 4)],
      ['Ratio', Number.isFinite(data.ratio) ? data.ratio.toFixed(1) + '×' : '∞'],
      ['Non-zero terms', String(data.terms)]
    ])
  ]);
}
