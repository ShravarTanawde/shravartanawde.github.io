/* ============ contact modal (Web3Forms) — front page only ============ */
(function () {
  var scrim = document.getElementById('contactScrim');
  if (!scrim) return;

  var form = document.getElementById('contactForm'),
      status = document.getElementById('cf-status'), sendBtn = document.getElementById('cf-send');
  function openC(e) { if (e) e.preventDefault(); scrim.hidden = false; document.getElementById('cf-name').focus(); document.addEventListener('keydown', escC); }
  function closeC() { scrim.hidden = true; document.removeEventListener('keydown', escC); }
  function escC(e) { if (e.key === 'Escape') closeC(); }
  document.getElementById('emailLink').addEventListener('click', openC);
  document.getElementById('cf-cancel').addEventListener('click', closeC);
  scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closeC(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.className = 'status'; status.textContent = 'Sending…'; sendBtn.disabled = true;
    var data = Object.fromEntries(new FormData(form).entries());
    if (data.access_key === 'YOUR_ACCESS_KEY_HERE') {
      status.className = 'status err'; status.textContent = 'Add your Web3Forms access key to enable sending.'; sendBtn.disabled = false; return;
    }
    fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.success) { status.className = 'status ok'; status.textContent = 'Sent — thank you. I’ll reply soon.'; form.reset(); }
        else { status.className = 'status err'; status.textContent = j.message || 'Something went wrong. Try again.'; }
        sendBtn.disabled = false;
      })
      .catch(function () { status.className = 'status err'; status.textContent = 'Network error — please try again.'; sendBtn.disabled = false; });
  });
})();
