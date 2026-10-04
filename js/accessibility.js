/* ============ reading panel (all pages) ============ */
(function () {
  var root = document.documentElement;
  var panel = document.getElementById('aaPanel');
  if (!panel) return;

  var btn = document.getElementById('aaToggle'), reset = document.getElementById('aaReset');
  var MAP = {
    font:{default:'var(--stack-default)',inter:'var(--stack-inter)',atkinson:'var(--stack-atkinson)',dyslexic:'var(--stack-dyslexic)'},
    size:{small:'15px',medium:'16px',large:'18px',xl:'20px'},
    tracking:{normal:'0em',wide:'0.02em',wider:'0.04em'},
    leading:{tight:'1.4',normal:'1.6',relaxed:'1.8',loose:'2.0'},
    measure:{narrow:'55ch',default:'66ch',wide:'80ch',full:'none'}
  };
  var VAR = {font:'--font-body',size:'--size',tracking:'--tracking-body',leading:'--leading-body',measure:'--measure'};
  var DEF = {font:'default',size:'medium',tracking:'normal',leading:'normal',measure:'default'};
  var selects = Array.prototype.slice.call(panel.querySelectorAll('select[data-var]'));
  var saved = {}; try { saved = JSON.parse(localStorage.getItem('qp-reading') || '{}'); } catch (e) {}
  selects.forEach(function (s) { var k = s.dataset.var; s.value = saved[k] || DEF[k]; });
  function apply(s) { root.style.setProperty(VAR[s.dataset.var], MAP[s.dataset.var][s.value]); }
  function persist() { var o = {}; selects.forEach(function (s) { o[s.dataset.var] = s.value; }); try { localStorage.setItem('qp-reading', JSON.stringify(o)); } catch (e) {} }
  selects.forEach(function (s) { apply(s); s.addEventListener('change', function () { apply(s); persist(); }); });
  reset.addEventListener('click', function () { selects.forEach(function (s) { s.value = DEF[s.dataset.var]; apply(s); }); persist(); selects[0].focus(); });

  var open = false;
  function openP() { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); open = true; requestAnimationFrame(function () { selects[0].focus(); }); document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onOut); }
  function closeP(rf) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); open = false; document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onOut); if (rf) btn.focus(); }
  function onKey(e) { if (e.key === 'Escape') closeP(true); }
  function onOut(e) { if (!panel.contains(e.target) && e.target !== btn) closeP(false); }
  btn.addEventListener('click', function () { open ? closeP(false) : openP(); });

  /* learn.html injects a topic's text into the page long after load. It says so
     with this event; re-applying the saved settings makes sure the new subtree
     is typeset like the rest. The values are custom properties on <html>, so in
     the ordinary case this changes nothing and simply costs nothing — it is the
     repair that matters, for anything that has reset them in between.
     This listener is the only thing this file knows about the learn graph. */
  document.addEventListener('learn:content-rendered', function () { selects.forEach(apply); });
})();
