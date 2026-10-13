'use strict';
/* Admin console client behaviour. Progressive enhancement — the console is
   fully usable (server-rendered) without this file. */
(function () {
  'use strict';

  /* ---- password visibility ---- */
  document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = btn.closest('.pw').querySelector('input');
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  /* ---- CSV file → textarea ---- */
  document.querySelectorAll('[data-csv-file]').forEach(function (input) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var form = input.closest('form');
      var area = form ? form.querySelector('textarea[name="csv"]') : null;
      if (!area) return;
      var reader = new FileReader();
      reader.onload = function () { area.value = String(reader.result || ''); };
      reader.readAsText(file);
    });
  });

  /* ---- sidebar: collapse to icon rail (persisted) ---- */
  var RAIL_KEY = 'sym_admin_rail';
  try {
    if (localStorage.getItem(RAIL_KEY) === '1') document.body.classList.add('rail');
  } catch (e) { /* storage unavailable */ }
  var railBtn = document.querySelector('[data-toggle-rail]');
  if (railBtn) {
    railBtn.addEventListener('click', function () {
      var on = document.body.classList.toggle('rail');
      try { localStorage.setItem(RAIL_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    });
  }

  /* ---- sidebar: mobile drawer ---- */
  var burger = document.querySelector('[data-toggle-sidebar]');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('menuOverlay');
  function setDrawer(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('show', open);
    if (burger) burger.setAttribute('aria-expanded', String(open));
  }
  if (burger && sidebar) burger.addEventListener('click', function () { setDrawer(!sidebar.classList.contains('open')); });
  if (overlay) overlay.addEventListener('click', function () { setDrawer(false); });

  /* ---- dropdown menus (notifications, profile) ---- */
  function closeMenus(except) {
    document.querySelectorAll('[data-dropdown] .menu.open').forEach(function (m) {
      if (m !== except) {
        m.classList.remove('open');
        var t = m.parentElement.querySelector('[data-dropdown-toggle]');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  }
  document.querySelectorAll('[data-dropdown-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = btn.parentElement.querySelector('.menu');
      if (!menu) return;
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      closeMenus(menu);
    });
  });
  document.addEventListener('click', function () { closeMenus(null); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeMenus(null); setDrawer(false); }
  });

  /* ---- sidebar menu search filter ---- */
  var filter = document.getElementById('navFilter');
  if (filter) {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var sections = document.querySelectorAll('#adminNav .nav-section');
      document.querySelectorAll('#adminNav .nav-item').forEach(function (item) {
        var label = (item.textContent || '').toLowerCase();
        item.style.display = !q || label.indexOf(q) !== -1 ? '' : 'none';
      });
      sections.forEach(function (s) {
        s.style.display = q ? 'none' : '';
      });
    });
  }

  /* ---- confirm before destructive submits ---- */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm || 'Are you sure?')) e.preventDefault();
    });
  });

  /* ---- media upload: raw-body POST (no multipart parser needed) ---- */
  document.querySelectorAll('form[data-media-upload]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var input = form.querySelector('input[type="file"]');
      var file = input && input.files && input.files[0];
      if (!file) return; // fall back to the browser default (shows the server error)
      e.preventDefault();
      var csrf = form.querySelector('input[name="_csrf"]');
      var alt = form.querySelector('input[name="altText"]');
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.classList.add('loading'); }
      fetch(form.getAttribute('action') || '/admin/media/upload', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-csrf-token': csrf ? csrf.value : '',
          'x-filename': encodeURIComponent(file.name || 'upload'),
          'x-alt-text': alt ? alt.value : ''
        },
        body: file
      }).then(function (res) {
        if (res.ok) { window.location.reload(); return null; }
        return res.json().then(function (j) {
          throw new Error((j.error && j.error.message) || 'Upload failed.');
        });
      }).catch(function (err) {
        window.alert(err.message || 'Upload failed.');
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      });
    });
  });

  /* ---- submit loading state ---- */
  document.querySelectorAll('form[data-loading-label]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type="submit"]');
      if (!btn || form.dataset.submitted === '1') return;
      form.dataset.submitted = '1';
      btn.classList.add('loading');
      btn.disabled = true;
      var label = btn.querySelector('.btn-label');
      if (label) label.textContent = form.dataset.loadingLabel || 'Please wait…';
      setTimeout(function () {
        form.dataset.submitted = '';
        btn.classList.remove('loading');
        btn.disabled = false;
      }, 8000);
    });
  });
})();
