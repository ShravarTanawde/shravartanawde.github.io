/* ============ projects: the circuit view ============
   projects.html only. Progressive enhancement over the <details> stack.

   The stack IS the data. This file reads the data-* attributes off each
   <details class="proj"> to draw the SVG, and the hidden #registers list for
   the wires and their order — so there is no second copy of the project list
   to fall out of sync, and deleting this file leaves a page that still works.

   Nothing is shown until the SVG has actually been built: the section starts
   [hidden] in the markup and is only revealed on success, so a thrown error
   (or no SVG support) simply leaves the stack on its own.

   One `selected` id drives both views. Selecting is a measurement: the other
   gates dim, the other registers fade, and the stack collapses to the one
   project. Selecting the same thing twice, Escape, the reset button, the back-
   to-circuit button, or a click on empty wire space all put it back into
   superposition.

   Nothing scrolls without a reason the reader gave, and where they gave it
   decides what happens (see follow()). Act from the stack and the card they
   touched is pinned, so the collapse cannot move the page out from under them.
   Act from the circuit — a question asked of the diagram — and the page travels
   down to the write-up that answers it. #toCircuit is the way back, and drops
   the measurement on the way. */
(function () {
  var main     = document.getElementById('projMain');
  var section  = document.getElementById('circuit');
  var stage    = document.getElementById('circuitStage');
  var scroller = document.getElementById('circuitScroll');
  var regList  = document.getElementById('registers');
  var stack    = document.getElementById('stack');
  var status   = document.getElementById('circuitStatus');
  var resetBtn = document.getElementById('measureAgain');
  if (!main || !section || !stage || !scroller || !regList || !stack || !status || !resetBtn) return;
  if (!document.createElementNS) return;

  var NS = 'http://www.w3.org/2000/svg';

  /* Geometry, in SVG user units. The SVG is rendered 1:1 (width == viewBox
     width), which is what lets the overlaid HTML buttons be positioned with
     the same numbers. Gate boxes are sized to their text, not to a fixed
     grid, so a long label widens the diagram instead of being clipped. */
  var GUTTER  = 54;   // left margin holding the register names
  var GAP     = 28;   // wire visible between two gates
  var PAD_R   = 16;
  var ROW_TOP = 62;   // y of the first register
  var ROW_GAP = 92;
  var BOX_H   = 40;
  var BOX_MIN = 74;
  var BOX_PAD = 26;   // horizontal padding around a gate's label

  function mk(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---- registers, read off the hidden #registers list ----
     That list is never rendered; it exists so the wires have one source of
     truth in the markup rather than an array in here. */
  var wires = [], wireById = {};
  Array.prototype.forEach.call(regList.querySelectorAll('.reg[data-wire]'), function (li, i) {
    var reg = li.querySelector('.reg-id');
    var w = {
      id: li.getAttribute('data-wire'),
      reg: reg ? reg.textContent.trim() : '',
      y: ROW_TOP + i * ROW_GAP,
      lines: []
    };
    wires.push(w);
    wireById[w.id] = w;
  });

  /* ---- gates, read off the stack ----
     The stack is grouped by kind (projects / roles / misc), so DOM order is
     no longer chronological. data-order carries the circuit's left-to-right
     ordering instead — an explicit integer, because data-year holds things
     like "2024–25" and "Ongoing" that no date parser should be asked about. */
  var gates = [];
  Array.prototype.forEach.call(stack.querySelectorAll('details.proj'), function (d, i) {
    var w = wireById[d.getAttribute('data-wire')];
    var li = d.closest ? d.closest('.proj-item') : d.parentNode;
    if (!w || !li) return;
    var title = d.querySelector('.p-title');
    gates.push({
      d: d, li: li,
      order: +(d.getAttribute('data-order') || i + 1),
      id: d.getAttribute('data-id') || d.id,
      short: d.getAttribute('data-short') || '?',
      year: d.getAttribute('data-year') || '',
      title: title ? title.textContent.trim() : '',
      role: d.getAttribute('data-type') === 'role',
      pub: d.hasAttribute('data-pub'),          // published work; orthogonal to project/role
      wire: w,
      ctrl: wireById[d.getAttribute('data-control')] || null
    });
  });
  if (!wires.length || !gates.length) return;
  gates.sort(function (a, b) { return a.order - b.order; });

  /* the group sections, so a heading can leave with its last visible entry */
  var groups = Array.prototype.slice.call(stack.querySelectorAll('.stack-group'));

  var svgRoot = null;
  var selected = null;
  var priorOpen = null;   // what the reader had open before measuring, restored on reset

  /* getComputedTextLength only reports on a laid-out element, so the section
     has to be visible before the gates can be measured. Nothing paints between
     here and the end of build(), so revealing it first is not a flash. */
  section.hidden = false;
  try {
    build();
  } catch (e) {
    section.hidden = true;
    return;
  }

  function build() {
    svgRoot = mk('svg', { 'class': 'cq' });
    svgRoot.setAttribute('aria-hidden', 'true');   // the button layer carries the semantics
    var wiresG = mk('g', { 'class': 'wires' }, svgRoot);
    var gatesG = mk('g', { 'class': 'gates' }, svgRoot);

    wires.forEach(function (w) {
      w.g = mk('g', { 'class': 'wire-group', 'data-wire': w.id }, wiresG);
      w.regText = mk('text', { 'class': 'wire-reg' }, w.g);
      w.regText.textContent = w.reg;
      // a classical register is drawn as a double line — the standard notation,
      // and an honest one: this work was never quantum
      var n = w.id === 'classical' ? 2 : 1;
      for (var i = 0; i < n; i++) w.lines.push(mk('line', { 'class': 'wire-line' }, w.g));
    });

    gates.forEach(function (it) {
      it.g = mk('g', {
        'class': 'gate',
        'data-wire': it.wire.id,
        'data-type': it.role ? 'role' : 'project'
      }, gatesG);
      if (it.pub) it.g.setAttribute('data-pub', '');

      // the one controlled gate: dot on the controlling register, box on the target
      if (it.ctrl) {
        it.g.setAttribute('data-control', it.ctrl.id);
        it.link = mk('line', { 'class': 'ctrl-link' }, it.g);
        it.dot  = mk('circle', { 'class': 'ctrl-dot', r: 5 }, it.g);
      }

      it.box = mk('rect', { 'class': 'gate-box', rx: 9, height: BOX_H }, it.g);
      it.label = mk('text', { 'class': 'gate-label' }, it.g);
      it.label.textContent = it.short;
      it.yearT = mk('text', { 'class': 'gate-year' }, it.g);
      it.yearT.textContent = it.year;
      /* Outlined-vs-filled already carries project-vs-role. The strip above the
         box is the open channel for any further kind a gate belongs to, and it
         takes more than one — a published job would read "ROLE · PUBLISHED". */
      var tags = [];
      if (it.role) tags.push('ROLE');
      if (it.pub) tags.push('PUBLISHED');
      if (tags.length) {
        it.tag = tags.join(' · ');
        it.tagT = mk('text', { 'class': 'gate-tag' }, it.g);
        it.tagT.textContent = it.tag;
      }

      // A real <button>, overlaid. An SVG <g tabindex> is focusable but its
      // name and pressed state are far less reliably announced.
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gate-hit';
      b.setAttribute('aria-pressed', 'false');
      if (it.d.id) b.setAttribute('aria-controls', it.d.id);
      var sr = document.createElement('span');
      sr.className = 'vh';
      sr.textContent = it.short + ' — ' + it.title + '. ' + it.year + '. ' +
        (it.role ? 'Role' : 'Project') + (it.pub ? ', published' : '') +
        ' on register ' + it.wire.reg +
        (it.ctrl ? ', controlled from register ' + it.ctrl.reg : '') + '.';
      b.appendChild(sr);
      /* Measuring from the circuit is a question asked of the diagram and
         answered in the stack, so the page travels down to the answer. Clicking
         the same gate again only un-measures it — there is nothing to read, so
         the diagram the reader is looking at holds still instead. */
      b.addEventListener('click', function () {
        if (it.id === selected) { apply(null, section); return; }
        apply(it.id);
        // the write-up is where the reader is headed, so send the keyboard too —
        // before the travel, so that a browser without preventScroll support
        // does its jump first and gets corrected on the way down
        var sum = it.d.querySelector('summary');
        if (sum) { try { sum.focus({ preventScroll: true }); } catch (e) {} }
        travelTo(it.li);
      });
      it.btn = b;
    });

    stage.appendChild(svgRoot);
    gates.forEach(function (it) { stage.appendChild(it.btn); });

    layout();

    // Web fonts land after first paint and change every measurement, so lay
    // the diagram out again once they are in.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { try { layout(); } catch (e) {} });
    }

    /* Each of these passes the element the reader is looking at when they act:
       their own card if they used the stack, the diagram if they used the
       circuit. That element is what stays put across the change. */
    gates.forEach(function (it) {
      var sum = it.d.querySelector('summary');
      if (sum) sum.addEventListener('click', function (e) {
        e.preventDefault();          // we own `open`; native toggling would desync the views
        select(it.id, it.li);
      });
    });

    resetBtn.addEventListener('click', function () { apply(null, section); });

    // empty wire space (and the margin either side of the diagram) resets
    scroller.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.gate-hit')) apply(null, section);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !selected) return;
      if (panelOpen()) return;              // the reading panel owns Escape while it is open
      apply(null, currentItem() || section);
    });

    /* Click away to dismiss. Anywhere outside the open card counts, except the
       controls that already answer for themselves — the circuit resets to its
       own diagram, the back-to-circuit button travels, the chrome is not part
       of this conversation at all.

       The card that was open is the anchor, so dismissing does not move the
       page: the reader stays exactly where they were reading, with the stack
       reassembled around them. */
    document.addEventListener('click', function (e) {
      if (!selected || !e.target.closest) return;
      if (panelOpen()) return;                              // that click was the panel's to take
      if (e.target.closest('.proj-item.is-selected')) return;          // inside the card
      if (e.target.closest('#circuit, #toCircuit, .topbar, .nav')) return;
      /* A text selection dragged out of the card ends its mouseup out here, and
         that is a highlight, not a dismissal. A plain click has already
         collapsed any old selection by the time it fires, so this only ever
         catches the real case. */
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;
      apply(null, currentItem() || section);
    });

    wireBackToCircuit();
    apply(null);
  }

  function currentItem() {
    var found = null;
    gates.forEach(function (it) { if (it.id === selected) found = it.li; });
    return found;
  }

  // the reading panel is modal-ish: while it is up, Escape and stray clicks are its
  function panelOpen() {
    var panel = document.getElementById('aaPanel');
    return !!(panel && !panel.hidden);
  }

  /* Wired only from build(), so a page whose circuit never got drawn keeps the
     button hidden — there would be nothing to scroll back to. */
  function wireBackToCircuit() {
    var btn = document.getElementById('toCircuit');
    if (!btn) return;

    /* Going back to the circuit means going back to the question, so the
       measurement is dropped on the way: the stack returns to all nine as the
       page returns to the diagram. Nothing anchors this one — the circuit sits
       above the whole stack, so the cards reopening below cannot move it, and
       the browser's own smooth scroll is left to do the travelling. */
    btn.addEventListener('click', function () {
      stopAnchor();               // this scroll is the reader's, let it through
      if (selected) apply(null);
      try {
        section.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      } catch (e) {
        section.scrollIntoView(true);
      }
      try { section.focus({ preventScroll: true }); } catch (e) { section.focus(); }
    });

    // No observer (or no support) means the button simply never appears, which
    // is the right failure: the page still works, it just offers one less trip.
    if (!window.IntersectionObserver) return;
    new IntersectionObserver(function (entries) {
      btn.classList.toggle('is-on', !entries[entries.length - 1].isIntersecting);
    }, { rootMargin: '-80px 0px 0px 0px' }).observe(section);
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---- following an element ----
     Every scroll on this page is the same job: keep one element at one offset
     in the viewport while the cards around it are still animating open or shut.
     Holding a card where it already was and travelling down to a card that was
     off screen differ only in the offset asked for and how hard each frame
     chases it, so both go through follow().

     It has to be a per-frame loop rather than one computed jump. A measurement
     collapses eight of the nine cards, taking thousands of pixels out of the
     document over .42s; anything worked out up front is wrong by the next
     frame. Measuring the real gap every frame also means the browser's own
     scroll anchoring can help without the two fighting — if it already got the
     element where it belongs, the gap is zero and we do nothing.

     The first real scroll input hands control straight back to the reader. */
  var HOLD_MS   = 520;    // the .42s collapse, plus a frame or two of slack
  var TRAVEL_MS = 900;    // the collapse, plus the easing's long tail
  var LEAD      = 88;     // where a card is asked to land: clear of the sticky top bar

  var anchorGen = 0, anchorRAF = 0, anchorOff = null;

  function stopAnchor() {
    anchorGen++;
    if (anchorRAF) cancelAnimationFrame(anchorRAF);
    anchorRAF = 0;
    if (anchorOff) { anchorOff(); anchorOff = null; }
  }

  /* Keep el's top edge at `top` px down the viewport, closing `ease` of the
     remaining gap each frame — 1 is a lock, less than 1 is a glide. */
  function follow(el, top, ease, ms) {
    stopAnchor();
    if (!el || !window.requestAnimationFrame) return;
    var gen = anchorGen, until = Date.now() + ms;

    /* Listeners go on a frame late, so the very keypress that triggered this
       (Escape) is not itself read as the reader taking the scroll back. */
    requestAnimationFrame(function () {
      if (gen !== anchorGen) return;
      var evs = ['wheel', 'touchstart', 'keydown'], opts = { passive: true };
      evs.forEach(function (t) { window.addEventListener(t, stopAnchor, opts); });
      anchorOff = function () {
        evs.forEach(function (t) { window.removeEventListener(t, stopAnchor, opts); });
      };
    });

    (function step() {
      if (gen !== anchorGen) return;
      var gap = el.getBoundingClientRect().top - top;
      if (Math.abs(gap) > 0.5) window.scrollBy(0, gap * ease);
      if (Date.now() < until) anchorRAF = requestAnimationFrame(step);
      else stopAnchor();
    })();
  }

  // run() makes the change; el comes out of it sitting where it went in
  function anchored(el, run) {
    stopAnchor();
    if (!el || !window.requestAnimationFrame) { run(); return; }
    var top = el.getBoundingClientRect().top;
    run();
    follow(el, top, 1, HOLD_MS);
  }

  // and the other direction: bring el up to the reading position
  function travelTo(el) {
    follow(el, LEAD, reduced() ? 1 : 0.18, reduced() ? 120 : TRAVEL_MS);
  }

  /* Re-runnable: it only moves existing nodes, so calling it again after the
     fonts load (or after any future re-measure) is safe. */
  function layout() {
    var x = GUTTER + GAP;
    gates.forEach(function (it) {
      it.w = Math.max(
        BOX_MIN,
        Math.ceil(textWidth(it.label, it.short)) + BOX_PAD,
        Math.ceil(textWidth(it.yearT, it.year)) + 14,
        it.tagT ? Math.ceil(textWidth(it.tagT, it.tag)) + 12 : 0   // a long tag widens its gate rather than running into the next one
      );
      it.cx = x + it.w / 2;
      x += it.w + GAP;
    });

    var totalW = Math.round(x + PAD_R);
    var totalH = wires[wires.length - 1].y + 50;
    svgRoot.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);
    svgRoot.setAttribute('width', totalW);
    svgRoot.setAttribute('height', totalH);
    stage.style.width = totalW + 'px';
    stage.style.height = totalH + 'px';

    wires.forEach(function (w) {
      w.regText.setAttribute('x', 16);
      w.regText.setAttribute('y', w.y + 4.5);
      w.lines.forEach(function (ln, k) {
        var off = w.lines.length === 1 ? 0 : (k === 0 ? -2.2 : 2.2);
        ln.setAttribute('x1', GUTTER);
        ln.setAttribute('x2', totalW - 12);
        ln.setAttribute('y1', w.y + off);
        ln.setAttribute('y2', w.y + off);
      });
    });

    gates.forEach(function (it) {
      var y = it.wire.y, half = it.w / 2, top = y;

      it.box.setAttribute('x', it.cx - half);
      it.box.setAttribute('y', y - BOX_H / 2);
      it.box.setAttribute('width', it.w);
      it.label.setAttribute('x', it.cx);
      it.label.setAttribute('y', y + 4.3);
      it.yearT.setAttribute('x', it.cx);
      it.yearT.setAttribute('y', y + BOX_H / 2 + 16);
      if (it.tagT) {
        it.tagT.setAttribute('x', it.cx);
        it.tagT.setAttribute('y', y - BOX_H / 2 - 10);
      }

      if (it.ctrl) {
        var cy = it.ctrl.y, edge = cy < y ? y - BOX_H / 2 : y + BOX_H / 2;
        it.link.setAttribute('x1', it.cx); it.link.setAttribute('x2', it.cx);
        it.link.setAttribute('y1', cy);    it.link.setAttribute('y2', edge);
        it.dot.setAttribute('cx', it.cx);  it.dot.setAttribute('cy', cy);
        top = Math.min(y, cy);
      }

      // the hit area covers label, box, year and any control dot
      var t = top - 38, bottom = y + BOX_H / 2 + 24;
      it.btn.style.left = (it.cx - half - 8) + 'px';
      it.btn.style.top = t + 'px';
      it.btn.style.width = (it.w + 16) + 'px';
      it.btn.style.height = (bottom - t) + 'px';
    });
  }

  function textWidth(node, fallback) {
    try {
      var w = node.getComputedTextLength();
      if (w > 0) return w;
    } catch (e) {}
    return fallback.length * 7.4;   // rough mono advance, only used if measuring fails
  }

  /* ---- selection ----
     `anchor` is the element that must not appear to move across the change;
     omit it (the first call, before anything is on screen) and the page is
     left exactly as the browser puts it. */
  function select(id, anchor) { apply(id === selected ? null : id, anchor); }

  function apply(id, anchor) {
    if (anchor) anchored(anchor, function () { commit(id); });
    else commit(id);
  }

  function commit(id) {
    if (id && priorOpen === null) {
      priorOpen = gates.map(function (it) { return it.d.open; });
    }
    selected = id || null;

    if (selected) main.setAttribute('data-selected', selected);
    else main.removeAttribute('data-selected');

    var live = {}, chosen = null;
    gates.forEach(function (it, i) {
      var on = it.id === selected;
      it.g.classList.toggle('is-selected', on);
      it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      it.li.classList.toggle('is-off', !!selected && !on);
      it.li.classList.toggle('is-selected', on);
      it.d.open = selected ? on : (priorOpen ? priorOpen[i] : it.d.open);
      if (on) {
        chosen = it;
        live[it.wire.id] = 1;
        if (it.ctrl) live[it.ctrl.id] = 1;
      }
    });
    wires.forEach(function (w) {
      w.g.classList.toggle('is-live', !selected || !!live[w.id]);
    });
    // a group whose entries have all collapsed takes its heading with it
    groups.forEach(function (sec) {
      sec.classList.toggle('is-off', !!selected && !sec.querySelector('.proj-item.is-selected'));
    });

    resetBtn.disabled = !selected;
    if (chosen) {
      status.textContent = 'Measured ' + chosen.short + ' — ' + chosen.title +
        '. Showing 1 of ' + gates.length + '.';
      reveal(chosen);
    } else {
      status.textContent = 'Superposition — all ' + gates.length + ' on screen.';
      priorOpen = null;
    }
  }

  // keep the measured gate on screen when the circuit is wider than its frame
  function reveal(it) {
    var left = it.cx - it.w / 2 - 40, right = it.cx + it.w / 2 + 40;
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left);
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth;
  }
})();
