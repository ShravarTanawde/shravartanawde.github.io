/* ============ Bloch sphere navigator — front page only ============ */
(function () {
  var wrap = document.getElementById('sphereWrap');
  var canvas = document.getElementById('bloch');
  if (!wrap || !canvas) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.THREE) { document.body.classList.add('no-webgl'); return; }

  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true }); }
  catch (e) { document.body.classList.add('no-webgl'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.35, 4.4);
  camera.lookAt(0, 0, 0);

  var group = new THREE.Group(); scene.add(group);
  group.rotation.set(0.42, -0.6, 0);

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function colr(v) { return new THREE.Color(css(v) || '#888'); }

  // clear glass sphere — inner shell (BackSide + no depth write, so it never hides the axes)
  var shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.996, 48, 32),
    new THREE.MeshBasicMaterial({ color: colr('--accent'), transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false })
  );
  group.add(shell);

  // crisp silhouette rim — always faces the camera, so the sphere reads as a clean edge
  var rimGeo = new THREE.BufferGeometry(); var rimPts = [];
  for (var a = 0; a <= 96; a++) { var t = a / 96 * Math.PI * 2; rimPts.push(Math.cos(t), Math.sin(t), 0); }
  rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPts, 3));
  var rim = new THREE.Line(rimGeo, new THREE.LineBasicMaterial({ color: colr('--sphere-line'), transparent: true, opacity: 0.85 }));
  scene.add(rim);

  // equator great circle — subtle depth cue that tilts as you drag
  var ringGeo = new THREE.BufferGeometry(); var rpts = [];
  for (var a2 = 0; a2 <= 96; a2++) { var t2 = a2 / 96 * Math.PI * 2; rpts.push(Math.cos(t2), 0, Math.sin(t2)); }
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(rpts, 3));
  var equator = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: colr('--sphere-line'), transparent: true, opacity: 0.32 }));
  group.add(equator);

  // axes: three observables. Bloch Z->three Y (up), X->X, Y->Z.
  var AX = {
    z: { dir: new THREE.Vector3(0, 1, 0), col: '--ax-z', dest: 'projects.html' },
    x: { dir: new THREE.Vector3(1, 0, 0), col: '--ax-x', dest: 'learn.html' },
    y: { dir: new THREE.Vector3(0, 0, 1), col: '--ax-y', dest: 'tools.html' }
  };
  Object.keys(AX).forEach(function (k) {
    var d = AX[k].dir, c = colr(AX[k].col);
    var g = new THREE.BufferGeometry().setFromPoints([d.clone().multiplyScalar(-1.15), d.clone().multiplyScalar(1.15)]);
    var m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 });
    var line = new THREE.Line(g, m); line.userData.axis = k; group.add(line); AX[k].line = line; AX[k].mat = m; AX[k].color = c;
    // pole dots
    AX[k].dots = [1, -1].map(function (s) {
      var dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({ color: c }));
      dot.position.copy(d.clone().multiplyScalar(s)); group.add(dot); return dot;
    });
  });

  // state vector (arrow) — starts pointing up
  var vecDir = new THREE.Vector3(0.4, 0.55, 0.72).normalize();
  var vecGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), vecDir.clone()]);
  var vecMat = new THREE.LineBasicMaterial({ color: colr('--vector'), transparent: true, opacity: 0.95 });
  var vec = new THREE.Line(vecGeo, vecMat); group.add(vec);
  var tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: colr('--vector') }));
  group.add(tip);

  // labels
  var labels = Array.prototype.slice.call(wrap.querySelectorAll('.ket-label'));
  var poleVec = {
    top: new THREE.Vector3(0, 1, 0), bottom: new THREE.Vector3(0, -1, 0),
    right: new THREE.Vector3(1, 0, 0), left: new THREE.Vector3(-1, 0, 0),
    front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1)
  };

  // Numerator only — the √2 denominator is static markup under the fraction bar.
  var FORMULA = {
    z: { obs: 'Z basis', num: '|Project⟩ + |Experience⟩', dest: 'Projects & Experience' },
    x: { obs: 'X basis', num: '|Simulations⟩ + |Learn⟩', dest: 'Simulations & Learn' },
    y: { obs: 'Y basis', num: '|Tools⟩ + i|Software⟩', dest: 'Tools & Software' }
  };
  var readout = document.getElementById('readout');
  var roObs = document.getElementById('ro-obs'), roNum = document.getElementById('ro-num'), roD = document.getElementById('ro-dest');

  var active = null;
  function setActive(k) {
    active = k;
    if (k) { wrap.setAttribute('data-active', k); roObs.textContent = FORMULA[k].obs; roNum.textContent = FORMULA[k].num; roD.textContent = '\u2192 ' + FORMULA[k].dest; }
    else { wrap.removeAttribute('data-active'); }
    labels.forEach(function (l) { l.classList.toggle('on', l.dataset.axis === k); });
    Object.keys(AX).forEach(function (ax) {
      var on = ax === k, o = k ? (on ? 1 : 0.18) : 0.9;
      AX[ax].mat.opacity = on ? 1 : o;
      AX[ax].dots.forEach(function (dt) { dt.material.opacity = k ? (on ? 1 : 0.2) : 1; dt.material.transparent = true; });
    });
    // fade the state vector back while a basis is highlighted
    if (!measuring) { vecMat.opacity = k ? 0.2 : 0.95; tip.material.transparent = true; tip.material.opacity = k ? 0.2 : 1; }
  }

  // hover wiring: labels
  labels.forEach(function (l) {
    l.addEventListener('pointerenter', function () { setActive(l.dataset.axis); });
    l.addEventListener('focus', function () { setActive(l.dataset.axis); });
    l.addEventListener('pointerleave', function () { setActive(null); });
    l.addEventListener('blur', function () { setActive(null); });
    l.addEventListener('click', function (e) { e.preventDefault(); measureToAxis(l.dataset.axis); });
  });
  wrap.addEventListener('pointerleave', function () { if (!measuring) setActive(null); });

  // raycast hover on dots
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitObjects = [];
  ray.params.Line.threshold = 0.07; // let the whole axis line be pickable, not just the poles
  Object.keys(AX).forEach(function (k) { AX[k].dots.forEach(function (d) { d.userData.axis = k; hitObjects.push(d); }); hitObjects.push(AX[k].line); });
  function pick(e) {
    var r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(hitObjects);
  }
  function labelHover() { return labels.some(function (l) { return l.matches(':hover'); }); }

  // drag to rotate; a near-stationary press is treated as a tap → measure
  var dragging = false, velX = 0, velY = 0, lastX = 0, lastY = 0, moved = 0;
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; velX = 0; velY = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (dragging) {
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      var k = 0.008;
      group.rotation.y += dx * k; group.rotation.x += dy * k;
      velY = dx * k; velX = dy * k;
      if (active) setActive(null);
      return;
    }
    var hits = pick(e);
    if (hits.length) { setActive(hits[0].object.userData.axis); canvas.style.cursor = 'pointer'; }
    else if (!labelHover()) { setActive(null); canvas.style.cursor = 'grab'; }
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = 'grab';
    if (reduce) { velX = 0; velY = 0; }
    if (moved < 6) { var hits = pick(e); if (hits.length) { measureToAxis(hits[0].object.userData.axis); } }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // measure animation → navigate
  var measuring = false;
  // measurement outcome is random: collapse to either pole of the chosen axis
  function measureToAxis(k) { measureTo(AX[k].dir.clone().multiplyScalar(Math.random() < 0.5 ? 1 : -1), AX[k].dest); }
  function measureTo(target, dest) {
    if (measuring) return;
    vecMat.opacity = 0.95; tip.material.opacity = 1;
    if (reduce) { navigate(dest); return; }
    measuring = true;
    var from = vecDir.clone(), t0 = performance.now(), dur = 620;
    (function step(now) {
      var p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      vecDir.copy(from).lerp(target, e).normalize();
      if (p < 1) requestAnimationFrame(step); else setTimeout(function () { navigate(dest); }, 90);
    })(performance.now());
  }
  /* Cross-document view transitions (css/global.css) do the sphere-into-the-topbar
     morph on their own, and far better than script can — they animate across the
     document swap. Where they are missing, fly the sphere to the bar ourselves first
     and navigate when it lands; the next page then paints with its mini sphere
     already in that spot, which reads as one continuous movement.

     Detection is deliberately generous — CSSViewTransitionRule is the IDL interface
     for the `@view-transition` at-rule, and pageswap shipped alongside it. Either
     signal disables the fallback, because a false negative would run our animation
     on top of the browser's, which looks far worse than not running it at all.

     This fallback only covers front page -> section. The reverse needs the incoming
     page's layout to aim at, which we cannot measure from here. */
  var NATIVE_PAGE_TRANSITIONS = ('CSSViewTransitionRule' in window) || ('onpageswap' in window);
  function flyToTopbar(done) {
    var bar = document.querySelector('.topbar');
    if (NATIVE_PAGE_TRANSITIONS || reduce || !bar) return done();

    var from = wrap.getBoundingClientRect();
    if (!from.width) return done();
    var br = bar.getBoundingClientRect();
    var SIZE = 34; // .brand-sphere in global.css
    var padLeft = parseFloat(getComputedStyle(bar).paddingLeft) || 16;
    var tx = (br.left + padLeft + SIZE / 2) - (from.left + from.width / 2);
    var ty = (br.top + br.height / 2) - (from.top + from.height / 2);

    wrap.style.transformOrigin = 'center';
    wrap.style.transition = 'transform .5s cubic-bezier(.6,.05,.3,1), opacity .5s ease';
    wrap.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + (SIZE / from.width) + ')';
    wrap.style.opacity = '.2';
    setTimeout(done, 470);
  }

  function navigate(dest) {
    // The front page has no axis of its own; clear the stored one so arriving at a
    // section shows its axis settled rather than swinging in from a stale value.
    try { sessionStorage.removeItem('qp-axis'); } catch (e) {}
    flyToTopbar(function () { window.location.href = dest; });
  }

  // Back/forward restores this page from the bfcache with its JS state intact — the
  // script does not re-run. Without this, `measuring` is still true from the
  // measurement that navigated away and measureTo() swallows every later click,
  // and the fly-to-topbar transform is still on the sphere.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    measuring = false;
    setActive(null);
    canvas.style.cursor = 'grab';
    wrap.style.transition = ''; wrap.style.transform = ''; wrap.style.opacity = '';
  });

  // resize
  function resize() {
    var s = wrap.clientWidth || 400;
    renderer.setSize(s, s, false);
    camera.aspect = 1; camera.updateProjectionMatrix();
    measure();
    place();
  }

  /* Label widths, cached. place() needs them every frame to keep a label inside
     the sphere's box, and reading offsetWidth in there would force a layout
     flush six times a frame. They only change when the fonts land or the box
     resizes, which is exactly when this runs. */
  function measure() {
    labels.forEach(function (l) { l._half = l.offsetWidth / 2; });
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { try { measure(); place(); } catch (e) {} });
  }

  // project labels to screen each frame
  function place() {
    var s = wrap.clientWidth || 400;
    labels.forEach(function (l) {
      var v = poleVec[l.dataset.pole].clone().multiplyScalar(1.28).applyMatrix4(group.matrixWorld);
      v.project(camera);
      /* Clamped to the box. A pole dragged to the far edge projects to about
         92% of the width, and half of "|Simulations⟩" past that hangs out over
         the page — which a narrow screen answers with a horizontal scrollbar
         across the whole document. */
      var half = l._half || 0;
      var x = (v.x * 0.5 + 0.5) * s;
      l.style.left = Math.max(half, Math.min(s - half, x)) + 'px';
      l.style.top = ((-v.y * 0.5 + 0.5) * s) + 'px';
    });
  }

  function refreshColors() {
    shell.material.color = colr('--accent');
    rim.material.color = colr('--sphere-line'); equator.material.color = colr('--sphere-line');
    vecMat.color = colr('--vector'); tip.material.color = colr('--vector');
    Object.keys(AX).forEach(function (k) { var c = colr(AX[k].col); AX[k].mat.color = c; AX[k].dots.forEach(function (d) { d.material.color = c; }); });
  }
  new MutationObserver(refreshColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function loop() {
    requestAnimationFrame(loop);
    if (!dragging) {
      group.rotation.y += velY; group.rotation.x += velX;
      velY *= 0.92; velX *= 0.92;
      if (Math.abs(velY) < 1e-5) velY = 0;
      if (Math.abs(velX) < 1e-5) velX = 0;
    }
    group.rotation.x = Math.max(-1.35, Math.min(1.35, group.rotation.x));
    group.updateMatrixWorld();
    rim.quaternion.copy(camera.quaternion); // keep the silhouette facing the camera
    vecGeo.setFromPoints([new THREE.Vector3(0, 0, 0), vecDir.clone()]);
    tip.position.copy(vecDir);
    place();
    renderer.render(scene, camera);
  }
  /* Rotating a phone fires both of these, and iOS is known to report the new
     box a beat after the event — sizing the sphere from the pre-rotation width
     and leaving it wrong until something else nudges it. Three passes: now, next
     frame, and once the dust has settled. resize() is cheap and idempotent, and
     the settle pass is debounced so dragging a desktop window does not queue a
     timer per pixel. */
  var settle = 0;
  function viewportChanged() {
    resize();
    requestAnimationFrame(resize);
    clearTimeout(settle);
    settle = setTimeout(resize, 300);
  }
  window.addEventListener('resize', viewportChanged);
  window.addEventListener('orientationchange', viewportChanged);
  resize(); loop();
})();
