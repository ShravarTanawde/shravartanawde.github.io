/* ============================================================
   sims/interference-mach-zehnder.js — the reference interactive.

   Two phase controls, one live output. Everything is computed in closed form on
   each input event; there is no animation loop, so there is no frame to leak.

   The physics, in full. Both beam splitters are 50:50 with the symmetric
   convention B = (1/sqrt2) [[1, i], [i, 1]]. A photon enters port 0:

       after BS1     (1/sqrt2) (1, i)
       after phases  (1/sqrt2) (e^i.pa, i e^i.pb)
       after BS2     out0 = (e^i.pa - e^i.pb) / 2
                     out1 = i (e^i.pa + e^i.pb) / 2

   so with D = pa - pb,  P(D0) = sin^2(D/2)  and  P(D1) = cos^2(D/2). They sum
   to one for every setting, which is the check worth having: nothing is lost in
   the interferometer, the photon is only redirected.

   What this demonstrates is where a single photon comes out, and nothing more.
   It is not a simulation of a photon source, a detector, or any real apparatus.
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

let root = null;

function el(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

/** The schematic. Drawn once; only the two detector fills change afterwards. */
function figure() {
  const svg = el('svg', {
    class: 'sim-figure mzi',
    viewBox: '0 0 340 190',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': 'Schematic of the interferometer. Light enters at the left, splits into an upper and a lower arm, and recombines into two detectors at the right.'
  });

  /* paths: in -> BS1(70,130) -> up to M(70,60) -> across to BS2(250,60)
                             -> across to M(250,130) -> up to BS2 */
  const beams = [
    [20, 130, 70, 130],     // input
    [70, 130, 70, 60],      // upper arm, rising
    [70, 60, 250, 60],      // upper arm, across
    [70, 130, 250, 130],    // lower arm, across
    [250, 130, 250, 60],    // lower arm, rising into BS2
    [250, 60, 310, 60],     // output 0
    [250, 60, 250, 20]      // output 1
  ];
  for (const [x1, y1, x2, y2] of beams) {
    el('line', { class: 'mzi-beam', x1: x1, y1: y1, x2: x2, y2: y2 }, svg);
  }

  /* optics */
  el('line', { class: 'mzi-bs', x1: 58, y1: 142, x2: 82, y2: 118 }, svg);     // BS1
  el('line', { class: 'mzi-bs', x1: 238, y1: 72, x2: 262, y2: 48 }, svg);     // BS2
  el('line', { class: 'mzi-mirror', x1: 58, y1: 72, x2: 82, y2: 48 }, svg);   // mirror, upper
  el('line', { class: 'mzi-mirror', x1: 238, y1: 142, x2: 262, y2: 118 }, svg); // mirror, lower

  /* phase plates, one per arm */
  el('rect', { class: 'mzi-plate', x: 150, y: 50, width: 10, height: 20, rx: 2 }, svg);
  el('rect', { class: 'mzi-plate', x: 150, y: 120, width: 10, height: 20, rx: 2 }, svg);

  const d0 = el('circle', { class: 'mzi-detector', cx: 320, cy: 60, r: 9 }, svg);
  const d1 = el('circle', { class: 'mzi-detector', cx: 250, cy: 12, r: 9 }, svg);

  return { svg: svg, d0: d0, d1: d1 };
}

function slider(name, label, value, signal, onInput) {
  const row = document.createElement('div');
  row.className = 'sim-row';

  const id = 'mzi-' + name;
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.appendChild(document.createTextNode(label));
  const out = document.createElement('span');
  out.className = 'sim-value';
  lab.appendChild(out);
  row.appendChild(lab);

  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = '0';
  input.max = '2';
  input.step = '0.01';
  input.value = String(value);
  row.appendChild(input);

  input.addEventListener('input', onInput, { signal: signal });
  return { row: row, input: input, out: out };
}

export default {
  mount(container, ctx) {
    root = document.createElement('div');
    root.className = 'sim mzi-sim';

    const fig = figure();
    root.appendChild(fig.svg);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';

    const upper = slider('upper', 'Phase, upper arm', 0, ctx.signal, update);
    const lower = slider('lower', 'Phase, lower arm', 0, ctx.signal, update);
    controls.appendChild(upper.row);
    controls.appendChild(lower.row);
    root.appendChild(controls);

    const readout = document.createElement('p');
    readout.className = 'sim-readout';
    readout.setAttribute('aria-live', 'polite');
    const rDelta = document.createElement('span');
    const r0 = document.createElement('span');
    const r1 = document.createElement('span');
    readout.appendChild(rDelta);
    readout.appendChild(r0);
    readout.appendChild(r1);
    root.appendChild(readout);

    const note = document.createElement('p');
    note.className = 'sim-note';
    note.textContent = 'One photon at a time. The two numbers are where it is found, not how much light arrives.';
    root.appendChild(note);

    container.appendChild(root);
    update();

    function update() {
      const pa = parseFloat(upper.input.value) * Math.PI;
      const pb = parseFloat(lower.input.value) * Math.PI;
      const delta = pa - pb;

      const p0 = Math.sin(delta / 2) ** 2;
      const p1 = Math.cos(delta / 2) ** 2;

      upper.out.textContent = fmtPi(upper.input.value);
      lower.out.textContent = fmtPi(lower.input.value);

      /* A numeric custom property, read by fill-opacity in css/learn.css. The
         colour itself stays in the stylesheet. */
      fig.d0.style.setProperty('--lit', p0.toFixed(3));
      fig.d1.style.setProperty('--lit', p1.toFixed(3));

      const wrapped = ((parseFloat(upper.input.value) - parseFloat(lower.input.value)) + 4) % 2;
      rDelta.textContent = 'phase difference ' + fmtPi(wrapped);
      fill(r0, 'detector A ', p0);
      fill(r1, 'detector B ', p1);
    }
  },

  unmount() {
    /* Every listener was registered with ctx.signal, which sim-host aborts
       before calling this, so there is nothing to detach by hand. */
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }
};

function fill(span, label, p) {
  span.textContent = label;
  const b = document.createElement('b');
  b.textContent = (p * 100).toFixed(1) + '%';
  span.appendChild(b);
}

function fmtPi(v) {
  const n = Number(v);
  if (Math.abs(n) < 0.005) return '0';
  return n.toFixed(2) + 'π';
}
