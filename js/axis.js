/* ============ topbar sphere: swing the highlighted axis into place ============
   Inner pages only. The mini sphere draws all three observables faintly and one
   of them bright. That bright axis starts at the *previous* page's orientation
   (the pre-paint script in <head> sets it from sessionStorage) and this file
   moves it to the current page's orientation once the first frame is on screen,
   so switching sections visibly rotates the axis rather than just recolouring it.

   Angles are measured from vertical (Z). X and Y are the foreshortened in-plane
   axes of the isometric view, so they are nearly horizontal and slightly shorter.
   Keep AXIS in sync with the copy inside each page's pre-paint <script>. */
(function () {
  var root = document.documentElement;
  var axis = root.getAttribute('data-axis');
  var AXIS = { z: ['0deg', '1'], x: ['-78.5deg', '0.882'], y: ['78.5deg', '0.882'] };
  if (!AXIS[axis]) return;

  // Two frames: the first paints the "from" orientation, the second starts the
  // transition towards this page's. One frame is not always enough — the style
  // change can get coalesced into the same recalc and the transition is skipped.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.style.setProperty('--axis-angle', AXIS[axis][0]);
      root.style.setProperty('--axis-scale', AXIS[axis][1]);
    });
  });

  function remember() { try { sessionStorage.setItem('qp-axis', axis); } catch (e) {} }
  remember();

  // A Back navigation restores this page from the bfcache without re-running the
  // script, leaving qp-axis pointing at the page we came from. Re-stamp it, or the
  // next section would swing in from the wrong angle.
  window.addEventListener('pageshow', function (e) { if (e.persisted) remember(); });
})();
