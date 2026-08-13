/* ============ polarization theme toggle — all pages ============ */
(function () {
  var root = document.documentElement;
  var spin = document.getElementById('spin');
  if (!spin) return;

  /* The strip of browser chrome above the page on a phone. Read off --bg rather
     than written down again here, so it cannot drift from the palette. */
  var chrome = document.querySelector('meta[name="theme-color"]');

  function reflectTheme() {
    var dark = root.getAttribute('data-theme') === 'dark';
    spin.setAttribute('aria-checked', dark ? 'true' : 'false');
    if (chrome) {
      var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (bg) chrome.setAttribute('content', bg);
    }
  }
  reflectTheme();
  spin.addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('qp-theme', dark ? 'light' : 'dark'); } catch (e) {}
    reflectTheme();
  });
})();
