/* ============================================================================
   Symbiosis Education Consultancy — application logic
   Renders the verified dataset in js/data.js and wires up:
     • fee finder (field chips + free-text search + country filter + reset)
     • booking (calendar, time slots, validated WhatsApp request, .ics/.gcal)
     • mobile drawer, sticky nav, scroll reveals, count-ups
   No backend is required: bookings are encoded into a WhatsApp deep link.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.SYM || {};
  var CONTACT = S.CONTACT, FIELDS = S.FIELDS, COURSES = S.COURSES;

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fieldName = function (id) { var f = FIELDS.filter(function (x) { return x.id === id; })[0]; return f ? f.name : id; };
  var inr = function (n) { return '₹' + Number(n).toLocaleString('en-IN'); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };

  /* --------------------------------------------------------------- icons */
  var ICONS = {
    compass: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-3-2Z"/><path d="M9 8h6M9 12h6"/>',
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5 5 5 5m9-5-5 5m5 9-5-5M5 19l5-5"/>'
  };
  var svg = function (path, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'; };
  var promiseIcons = [ICONS.receipt, ICONS.life, ICONS.user, ICONS.globe, ICONS.shield];

  /* --------------------------------------------------- field tile artwork */
  var TILE_COLORS = {
    medical: ['#062d3a', '#14908c'], pharmacy: ['#0b2a5b', '#2a73d9'], paramedical: ['#1d1147', '#6a4ad8'],
    engineering: ['#0e1d33', '#3f6a9c'], management: ['#08292a', '#1f8a6b'], education: ['#2a1903', '#b8801c'],
    creative: ['#360b20', '#c2416b'], more: ['#14162b', '#4d5487'], overseas: ['#071a3d', '#1b5bb8'], pro: ['#0b2a5b', '#136bc2']
  };
  var GLYPH = {
    stetho: 'M9 4v8a6 6 0 0 0 12 0V4M15 18v2a4 4 0 0 0 8 0v-3',
    capsule: 'M6 14 14 6a4 4 0 0 1 6 6l-8 8a4 4 0 0 1-6-6Z',
    cross: 'M12 5v14M5 12h14',
    gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.6.1-1Z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    book: 'M4 5c5-2 9-1 12 2 3-3 7-4 12-2v14c-5-2-9-1-12 2-3-3-7-4-12-2Z',
    pen: 'M4 20l4-1 10-10-3-3L5 16Z M14 6l3 3',
    scales: 'M12 4v16M6 20h12M4 9h16M7 9l-3 6h6Z M17 9l-3 6h6Z',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    case: 'M4 8h16v11H4Z M9 8V6a3 3 0 0 1 6 0v2M4 13h16'
  };
  function artSvg(key) {
    return '<svg class="t-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPH[key] || GLYPH.book) + '</svg>';
  }

  /* --------------------------------------------------------- hero + trust */
  function renderServices() {
    $('#servicesGrid').innerHTML = (S.SERVICES || []).map(function (s) {
      return '<div class="svc">' + svg(ICONS[s.icon] || ICONS.compass) + '<b>' + esc(s.title) + '</b><span>' + esc(s.text) + '</span></div>';
    }).join('');
  }
  function renderTrust() {
    var icons = [ICONS.user, ICONS.shield, ICONS.receipt, ICONS.globe];
    $('#trustGrid').innerHTML = (S.TRUST || []).map(function (t, i) {
      return '<div class="trust-item">' + svg(icons[i] || ICONS.shield) + '<div><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div></div>';
    }).join('');
  }

  /* ------------------------------------------------------------- bento */
  function renderBento() {
    var order = ['medical', 'pharmacy', 'paramedical', 'engineering', 'management', 'education', 'creative', 'more', 'overseas', 'pro'];
    var big = { medical: 1, pharmacy: 1, overseas: 1, pro: 1 };
    $('#bento').innerHTML = order.map(function (id) {
      var f = FIELDS.filter(function (x) { return x.id === id; })[0];
      if (!f) return '';
      var list = COURSES.filter(function (c) { return c.field === id; });
      var froms = list.map(function (c) { return c.from; }).filter(Boolean);
      var from = froms.length ? 'From ' + inr(Math.min.apply(null, froms)) + ' / yr' : 'Fees on counselling';
      var col = TILE_COLORS[id] || ['#0b2a5b', '#1b5bb8'];
      return '<a class="tile ' + (big[id] ? 'big' : '') + ' reveal" href="#finder" data-field="' + id + '" style="--c1:' + col[0] + ';--c2:' + col[1] + '">' +
        '<span class="t-bg" aria-hidden="true">' + artSvg(f.icon) + '</span>' +
        '<img class="t-person" src="assets/cutouts/' + (S.FIELD_PEOPLE[id] || 'student') + '.webp" alt="" loading="lazy">' +
        '<span class="t-count">' + list.length + ' programme' + (list.length === 1 ? '' : 's') + '</span>' +
        '<h3>' + esc(f.name) + '</h3><p>' + esc(f.blurb) + '</p>' +
        '<div class="t-foot"><span class="t-from">' + from + '</span><span class="t-go" aria-hidden="true">→</span></div></a>';
    }).join('');
  }

  function renderPaths() {
    $('#paths').innerHTML = (S.PATHS || []).map(function (p) {
      return '<button class="path reveal" type="button" data-q="' + esc(p.q) + '"><span class="path-disc' + (p.inside ? ' in' : '') + '">' +
        '<img src="assets/cutouts/' + p.img + '.webp" alt="" loading="lazy"></span><b>' + esc(p.label) + '</b><small>' + esc(p.from) + '</small></button>';
    }).join('');
    $('#paths').addEventListener('click', function (e) {
      var b = e.target.closest('.path'); if (!b) return;
      state.field = 'all'; state.q = b.getAttribute('data-q'); $('#q').value = state.q;
      renderChips(); renderCourses(); scrollTo('#finder');
    });
  }

  function renderPromises() {
    $('#promises').innerHTML = (S.PROMISES || []).map(function (p, i) {
      return '<li class="reveal"><span class="p-ico">' + svg(promiseIcons[i] || ICONS.shield) + '</span><div><b>' + esc(p[0]) + '</b><span>' + esc(p[1]) + '</span></div></li>';
    }).join('');
  }

  /* ------------------------------------------------------- fee finder */
  var state = { field: 'all', q: '', country: 'all' };
  var PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var CAP = '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5Z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/></svg>';

  function courseCard(c) {
    var hasMore = c.fees.length || c.points.length;
    return '<article class="course" data-id="' + c.id + '">' +
      '<div class="c-top"><span class="c-field">' + esc(fieldName(c.field)) + '</span><span class="c-tag">' + esc(c.tag) + '</span></div>' +
      '<h3>' + esc(c.name) + '</h3><p class="c-univ">' + esc(c.univ) + '</p>' +
      '<div class="c-meta"><span>' + PIN + esc(c.place) + '</span><span>' + CLOCK + esc(c.duration) + '</span>' + (c.eligibility ? '<span>' + CAP + esc(c.eligibility) + '</span>' : '') + '</div>' +
      '<div class="c-total"><small>' + (c.total === 'On counselling' ? 'Fees' : 'Total / key fee') + '</small><b>' + esc(c.total) + '</b></div>' +
      (hasMore ? '<div class="c-more"><div>' +
        (c.fees.length ? '<table class="c-fees">' + c.fees.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' : '') +
        (c.points.length ? '<ul class="c-points">' + c.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        (c.src ? '<a class="c-src" href="https://www.instagram.com/reel/' + c.src + '/" target="_blank" rel="noopener">See the original post ↗</a>' : '') +
      '</div></div>' : '') +
      '<div class="c-actions">' +
        (hasMore ? '<button class="btn c-toggle" type="button" aria-expanded="false">Fee details</button>' : '') +
        '<a class="btn btn-blue c-book" href="#book" data-course="' + c.id + '">Book counselling</a>' +
      '</div></article>';
  }

  function renderChips() {
    var all = [{ id: 'all', name: 'All courses' }].concat(FIELDS);
    $('#chips').innerHTML = all.map(function (f) {
      var n = f.id === 'all' ? COURSES.length : COURSES.filter(function (c) { return c.field === f.id; }).length;
      return '<button class="chip ' + (f.id === state.field ? 'on' : '') + '" role="tab" aria-selected="' + (f.id === state.field) + '" data-field="' + f.id + '">' + esc(f.name) + '<small>' + n + '</small></button>';
    }).join('');
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return COURSES.filter(function (c) {
      if (state.field !== 'all' && c.field !== state.field) return false;
      if (state.country !== 'all' && c.country !== state.country) return false;
      if (!q) return true;
      var hay = [c.name, c.univ, c.place, c.country, c.tag, c.eligibility, fieldName(c.field)]
        .concat(c.points, [].concat.apply([], c.fees)).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderCourses() {
    var list = filtered();
    $('#courses').innerHTML = list.map(courseCard).join('');
    $('#empty').hidden = list.length > 0;
    var total = COURSES.length;
    $('#finderStatus').textContent = list.length === total
      ? total + ' programmes listed'
      : 'Showing ' + list.length + ' of ' + total + ' programmes';
  }

  function wireFinder() {
    $('#chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      state.field = b.getAttribute('data-field'); renderChips(); renderCourses();
    });
    var t;
    $('#q').addEventListener('input', function (e) {
      clearTimeout(t); t = setTimeout(function () { state.q = e.target.value; renderCourses(); }, 120);
    });
    var country = $('#country');
    if (country) country.addEventListener('change', function (e) { state.country = e.target.value; renderCourses(); });
    $('#resetFinder').addEventListener('click', function () {
      state = { field: 'all', q: '', country: 'all' };
      $('#q').value = ''; if (country) country.value = 'all';
      renderChips(); renderCourses();
    });
    $('#courses').addEventListener('click', function (e) {
      var tog = e.target.closest('.c-toggle');
      if (tog) {
        var card = tog.closest('.course'); var open = card.classList.toggle('open');
        tog.textContent = open ? 'Hide details' : 'Fee details'; tog.setAttribute('aria-expanded', open);
      }
      var bk = e.target.closest('.c-book');
      if (bk) { var sel = $('#courseSelect'); if (sel) sel.value = bk.getAttribute('data-course'); }
    });
    // field links anywhere (tiles, footer, hero)
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-field]:not(.chip)');
      if (!a) return; e.preventDefault();
      state.field = a.getAttribute('data-field'); state.q = ''; $('#q').value = '';
      renderChips(); renderCourses(); scrollTo('#finder');
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-country]');
      if (!a) return; e.preventDefault();
      var v = a.getAttribute('data-country'); state = { field: 'all', q: '', country: v };
      $('#q').value = ''; if (country) country.value = v;
      renderChips(); renderCourses(); scrollTo('#finder');
    });
  }

  /* ------------------------------------------------------------ updates */
  function renderUpdates() {
    $('#updatesGrid').innerHTML = (S.UPDATES || []).map(function (u) {
      return '<a class="upd reveal" href="https://www.instagram.com/reel/' + u.code + '/" target="_blank" rel="noopener">' +
        '<figure class="u-img"><img src="assets/posts/' + u.code + '.webp" alt="Instagram post: ' + esc(u.title) + '" loading="lazy"><span class="u-play" aria-hidden="true">▶</span></figure>' +
        '<div class="u-meta"><span class="u-tag">' + esc(u.tag) + '</span>' + svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/>', 'u-ig') + '</div>' +
        '<h3>' + esc(u.title) + '</h3></a>';
    }).join('');
  }

  /* ---------------------------------------------------------------- FAQ */
  function renderFaq() {
    $('#faqList').innerHTML = (S.FAQ || []).map(function (f) {
      return '<details class="reveal"><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + '</p></details>';
    }).join('');
  }

  /* ------------------------------------------------------------ booking */
  var SLOTS = ['10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '17:00', '18:00'];
  var DAYS_AHEAD = 60;
  var bk = { month: null, date: null, slot: null };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var fmtSlot = function (s) { var p = s.split(':').map(Number); var h = p[0], m = p[1]; return ((h + 11) % 12 + 1) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); };
  var fmtDate = function (d) { return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); };
  var startOfDay = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  function slotOpen(date, s) {
    var p = s.split(':').map(Number);
    var t = new Date(date); t.setHours(p[0], p[1], 0, 0);
    return t - Date.now() > 60 * 60 * 1000; // one hour's notice
  }
  function renderCal() {
    var today = startOfDay(new Date());
    var last = new Date(today); last.setDate(last.getDate() + DAYS_AHEAD);
    var m = bk.month;
    $('#calTitle').textContent = m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    $('#calPrev').disabled = m <= new Date(today.getFullYear(), today.getMonth(), 1);
    $('#calNext').disabled = new Date(m.getFullYear(), m.getMonth() + 1, 1) > last;
    var first = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7;
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var html = '<span class="blank" aria-hidden="true"></span>'.repeat(first);
    for (var d = 1; d <= days; d++) {
      var date = new Date(m.getFullYear(), m.getMonth(), d);
      var off = date < today || date > last || date.getDay() === 0 || (+date === +today && !SLOTS.some(function (s) { return slotOpen(date, s); }));
      var cls = ['day', +date === +today ? 'today' : '', bk.date && +date === +bk.date ? 'sel' : ''].join(' ');
      html += '<button type="button" role="gridcell" class="' + cls + '" data-d="' + d + '" ' + (off ? 'disabled' : '') + ' aria-label="' + fmtDate(date) + (off ? ', unavailable' : '') + '">' + d + '</button>';
    }
    $('#calGrid').innerHTML = html;
  }
  function renderSlots() {
    if (!bk.date) { $('#slots').innerHTML = ''; return; }
    $('#slotsTitle').textContent = 'Available times · ' + fmtDate(bk.date);
    $('#slots').innerHTML = SLOTS.map(function (s) {
      return '<button type="button" class="slot ' + (bk.slot === s ? 'sel' : '') + '" data-s="' + s + '" ' + (slotOpen(bk.date, s) ? '' : 'disabled') + '>' + fmtSlot(s) + '</button>';
    }).join('');
  }
  function renderSummary() {
    var box = $('#bkSummary');
    box.classList.toggle('ok', !!(bk.date && bk.slot));
    box.querySelector('b').textContent = bk.date && bk.slot ? fmtDate(bk.date) + ' · ' + fmtSlot(bk.slot) : bk.date ? fmtDate(bk.date) + ' — pick a time' : 'No slot selected yet';
  }
  function icsStamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'; }

  function wireBooking() {
    var now = new Date();
    bk.month = new Date(now.getFullYear(), now.getMonth(), 1);
    var sel = $('#courseSelect');
    FIELDS.forEach(function (f) {
      var g = document.createElement('optgroup'); g.label = f.name;
      COURSES.filter(function (c) { return c.field === f.id; }).forEach(function (c) { g.append(new Option(c.name + ' — ' + c.place, c.id)); });
      sel.append(g);
    });
    sel.append(new Option('Not sure yet — help me choose', 'unsure'));
    renderCal(); renderSummary();

    $('#calPrev').onclick = function () { bk.month = new Date(bk.month.getFullYear(), bk.month.getMonth() - 1, 1); renderCal(); };
    $('#calNext').onclick = function () { bk.month = new Date(bk.month.getFullYear(), bk.month.getMonth() + 1, 1); renderCal(); };
    $('#calGrid').addEventListener('click', function (e) {
      var b = e.target.closest('button.day'); if (!b || b.disabled) return;
      bk.date = new Date(bk.month.getFullYear(), bk.month.getMonth(), +b.getAttribute('data-d'));
      if (bk.slot && !slotOpen(bk.date, bk.slot)) bk.slot = null;
      renderCal(); renderSlots(); renderSummary();
    });
    $('#slots').addEventListener('click', function (e) {
      var b = e.target.closest('.slot'); if (!b || b.disabled) return;
      bk.slot = b.getAttribute('data-s'); renderSlots(); renderSummary();
    });

    var form = $('#bkForm');
    var submitted = false;
    form.addEventListener('input', function (e) { e.target.classList.remove('bad'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#formErr'); err.textContent = '';
      var data = Object.fromEntries(new FormData(form));
      var bad = [];
      if (!data.name.trim()) bad.push('name');
      if (!/^[+\d][\d ]{9,13}$/.test((data.phone || '').trim())) bad.push('phone');
      if (!data.qual) bad.push('qual');
      if (!data.course) bad.push('course');
      bad.forEach(function (n) { form.elements[n].classList.add('bad'); });
      if (!bk.date || !bk.slot) { err.textContent = 'Please pick a date and a time on the calendar.'; return; }
      if (bad.length) { err.textContent = 'Please fill in the highlighted fields.'; form.elements[bad[0]].focus(); return; }

      var course = COURSES.filter(function (c) { return c.id === data.course; })[0];
      var courseLabel = course ? course.name + ' (' + course.place + ')' : 'Not sure yet — help me choose';
      var p = bk.slot.split(':').map(Number);
      var start = new Date(bk.date); start.setHours(p[0], p[1], 0, 0);
      var end = new Date(start); end.setMinutes(end.getMinutes() + 45);
      var ref = 'SEC-' + pad(start.getMonth() + 1) + pad(start.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

      var msg = [
        '🎓 *1:1 Counselling request* — ' + ref,
        '',
        '📅 ' + fmtDate(bk.date) + ', ' + fmtSlot(bk.slot),
        '🎯 Course: ' + courseLabel,
        '👤 Student: ' + data.name.trim(),
        '📞 Phone: ' + data.phone.trim(),
        '📚 Qualification: ' + data.qual,
        data.neet ? '🩺 NEET score: ' + data.neet : '',
        data.city ? '📍 City: ' + data.city : '',
        '💬 Mode: ' + data.mode,
        data.note ? '📝 ' + data.note.trim() : ''
      ].filter(Boolean).join('\n');
      var wa = 'https://wa.me/' + CONTACT.whatsapp + '?text=' + encodeURIComponent(msg);
      if (!submitted) window.open(wa, '_blank', 'noopener');
      submitted = true;

      // Best-effort: also record the request in the CRM so it appears in the
      // admin pipeline. Never blocks the WhatsApp flow if the API is absent.
      try {
        if (location.protocol !== 'file:' && window.fetch) {
          var modeMap = { 'WhatsApp video': 'whatsapp', 'Google Meet': 'video', 'Phone call': 'call' };
          var payload = {
            studentName: data.name.trim(),
            contactNumber: data.phone.trim(),
            email: '',
            courseInterest: courseLabel,
            scheduledAt: start.toISOString(),
            timezone: 'Asia/Kolkata',
            meetingType: modeMap[data.mode] || 'call',
            notes: [data.qual && 'Qualification: ' + data.qual, data.city && 'City: ' + data.city, data.neet && 'NEET: ' + data.neet, data.note && data.note.trim()].filter(Boolean).join(' · ').slice(0, 2000),
            consentStatus: '1'
          };
          fetch('/api/public/appointments', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) }).catch(function () {});
        }
      } catch (e) {}

      var title = 'Counselling session — ' + CONTACT.name;
      var details = 'Ref ' + ref + '\nCourse: ' + courseLabel + '\nMode: ' + data.mode + '\nCall/WhatsApp: ' + CONTACT.phoneDisplay;
      $('#doneGcal').href = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + icsStamp(start) + '/' + icsStamp(end) + '&ctz=Asia/Kolkata&details=' + encodeURIComponent(details);
      $('#doneIcs').onclick = function () {
        var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Symbiosis Education Consultancy//Booking//EN', 'BEGIN:VEVENT',
          'UID:' + ref + '@symbiosis-consultancy', 'DTSTAMP:' + icsStamp(new Date()), 'DTSTART;TZID=Asia/Kolkata:' + icsStamp(start), 'DTEND;TZID=Asia/Kolkata:' + icsStamp(end),
          'SUMMARY:' + title, 'DESCRIPTION:' + details.replace(/\n/g, '\\n'), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = ref + '.ics'; a.click();
      };
      $('#doneWa').href = wa;
      $('#doneRef').textContent = ref;
      $('#doneName').textContent = data.name.trim().split(' ')[0];
      $('#doneText').textContent = fmtDate(bk.date) + ' at ' + fmtSlot(bk.slot) + ' · ' + data.mode + '. WhatsApp has opened with your details — press send and we will confirm your slot.';
      $('.bk-cal').hidden = true; form.hidden = true; $('#bkDone').hidden = false;
      scrollTo('#book');
    });

    $('#doneReset').onclick = function () {
      submitted = false; form.reset(); bk.date = null; bk.slot = null;
      $('.bk-cal').hidden = false; form.hidden = false; $('#bkDone').hidden = true;
      $('#slotsTitle').textContent = 'Choose a date to see times';
      renderCal(); renderSlots(); renderSummary();
    };
  }

  /* ------------------------------------------------------------ enquiry */
  function wireEnquiry() {
    var form = $('#enqForm'); if (!form) return;
    var err = $('#enqErr');
    form.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var data = Object.fromEntries(new FormData(form));
      var bad = [];
      if (!String(data.name || '').trim()) bad.push('name');
      if (!/^[+\d][\d ]{6,15}$/.test(String(data.contact || '').trim())) bad.push('contact');
      if (!String(data.message || '').trim()) bad.push('message');
      bad.forEach(function (n) { if (form.elements[n]) form.elements[n].classList.add('bad'); });
      if (bad.length) { err.textContent = 'Please fill in the highlighted fields.'; if (form.elements[bad[0]]) form.elements[bad[0]].focus(); return; }
      var done = function () { $('#enqFields').hidden = true; $('#enqSummary').hidden = false; };
      if (location.protocol === 'file:' || !window.fetch) { done(); return; }
      fetch('/api/public/enquiries', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: data.name, contact: data.contact, email: data.email, message: data.message, consentStatus: data.consentStatus ? '1' : '', website: data.website || '', sourcePage: 'website#contact' })
      }).then(function (r) {
        if (r.ok) return done();
        return r.json().then(function (j) { throw new Error((j.error && j.error.message) || 'Could not send your message.'); });
      }).catch(function (e2) {
        err.textContent = (e2 && e2.message) || 'Could not send your message. Please try WhatsApp instead.';
      });
    });
  }

  /* -------------------------------------------------------------- popup */
  function wirePopup() {
    var pop = $('#popup'); if (!pop) return;
    var lastFocus = null;
    function open() {
      if (!pop.hidden) return;
      lastFocus = document.activeElement;
      pop.hidden = false;
      document.body.classList.add('pop-open');
      var first = pop.querySelector('#popFields input, .pop-x');
      if (first) first.focus();
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      document.body.classList.remove('pop-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    $$('[data-pop-close]', pop).forEach(function (el) { el.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) close(); });

    var form = $('#popForm'), err = $('#popErr');
    form.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var data = Object.fromEntries(new FormData(form));
      var bad = [];
      if (!String(data.name || '').trim()) bad.push('name');
      if (!/^[+\d][\d ]{6,15}$/.test(String(data.contact || '').trim())) bad.push('contact');
      bad.forEach(function (n) { if (form.elements[n]) form.elements[n].classList.add('bad'); });
      if (bad.length) { err.textContent = 'Please enter your name and a valid phone number.'; if (form.elements[bad[0]]) form.elements[bad[0]].focus(); return; }
      var done = function () { $('#popFields').hidden = true; $('#popSummary').hidden = false; };
      if (location.protocol === 'file:' || !window.fetch) { done(); return; }
      fetch('/api/public/leads', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ studentName: data.name, phone: data.contact, courseInterest: data.course, consentStatus: data.consentStatus ? '1' : '', website: data.website || '' })
      }).then(function (r) {
        if (r.ok) return done();
        return r.json().then(function (j) { throw new Error((j.error && j.error.message) || 'Could not send your details.'); });
      }).catch(function (e2) {
        err.textContent = (e2 && e2.message) || 'Could not send your details. Please try WhatsApp instead.';
      });
    });

    try { if (sessionStorage.getItem('sym_popup_seen')) return; } catch (e) {}
    setTimeout(function () {
      if (!pop.hidden) return;
      try { sessionStorage.setItem('sym_popup_seen', '1'); } catch (e) {}
      open();
    }, 4000);
  }

  /* ------------------------------------------------------------- motion */
  function scrollTo(target) {
    var el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.pageYOffset - 80;
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  }
  function splitWords(el) {
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            var i = document.createElement('span'); i.textContent = part; w.append(i); frag.append(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  }
  function reveal() {
    var els = $$('.reveal');
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .05 });
    els.forEach(function (e) { io.observe(e); });
  }
  function initSplit() {
    $$('.split').forEach(function (el) {
      if (reduced) return;
      splitWords(el);
      el.querySelectorAll('.w > span').forEach(function (s, i) {
        s.style.transform = 'translateY(110%)';
        s.style.opacity = '0';
        s.style.transition = 'transform .9s cubic-bezier(.16,1,.3,1) ' + (i * .04) + 's, opacity .9s ' + (i * .04) + 's';
      });
    });
    if (reduced) return;
    setTimeout(function () {
      $$('.split').forEach(function (el) { el.querySelectorAll('.w > span').forEach(function (s) { s.style.transform = 'none'; s.style.opacity = '1'; }); });
    }, 200);
  }
  function countUps() {
    $$('[data-count]').forEach(function (el) {
      var end = +el.getAttribute('data-count'); if (!end) return;
      if (reduced) { el.textContent = end; return; }
      var start = performance.now();
      var run = function (now) {
        var t = Math.min(1, (now - start) / 1500);
        el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    });
  }

  /* --------------------------------------------------- opening animation */
  function initIntro(done) {
    var el = $('#intro');
    if (!el || reduced) {
      if (el) el.remove();
      document.body.classList.remove('intro-pending');
      done();
      return;
    }
    var finished = false;
    var finish = function () {
      if (finished) return; finished = true;
      el.classList.add('done');
      document.body.classList.remove('intro-pending');
      var cleanup = function () { if (el.parentNode) el.remove(); };
      el.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 1000);
      setTimeout(done, 120);
    };
    var maxWait = setTimeout(finish, 1800);
    window.addEventListener('load', function () { clearTimeout(maxWait); setTimeout(finish, 320); }, { once: true });
  }

  /* ------------------------------------------------------- nav + drawer */
  function wireNav() {
    var nav = $('#nav'), drawer = $('#drawer'), burger = $('.burger'), lastY = 0;
    var onScroll = function () {
      var y = window.pageYOffset;
      nav.classList.toggle('is-light', y > window.innerHeight * .8);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    burger.addEventListener('click', function () {
      var open = !drawer.classList.contains('open');
      drawer.classList.toggle('open', open); burger.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]'); if (!a || a.dataset.field || a.dataset.country) return;
      var target = $(a.getAttribute('href')); if (!target) return;
      e.preventDefault(); drawer.classList.remove('open'); burger.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false'); document.body.style.overflow = '';
      scrollTo(target);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) burger.click(); });
  }

  /* ------------------------------------------------------------- boot */
  function boot() {
    if (!CONTACT || !COURSES) { console.error('Symbiosis: data.js failed to load'); return; }
    $('#heroSession').textContent = CONTACT.session;
    var heroWa = $('#heroWa'); if (heroWa) heroWa.href = 'https://wa.me/' + CONTACT.whatsapp;
    $$('[data-count="courses"]').forEach(function (el) { el.setAttribute('data-count', COURSES.length); el.textContent = COURSES.length; });
    $$('[data-count="fields"]').forEach(function (el) { el.setAttribute('data-count', FIELDS.length); el.textContent = FIELDS.length; });

    renderServices(); renderTrust(); renderBento(); renderPaths(); renderPromises();
    renderChips(); renderCourses(); renderUpdates(); renderFaq();
    wireFinder(); wireBooking(); wireEnquiry(); wireNav(); wirePopup();

    var process = $('#processGrid');
    if (process && 'IntersectionObserver' in window) {
      var pio = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); pio.unobserve(en.target); } }); }, { threshold: .2 });
      pio.observe(process);
    } else if (process) { process.classList.add('in'); }

    initIntro(function () { initSplit(); reveal(); countUps(); });
  }

  /* -------------------------------------------------- live data + fallback */
  /* The static dataset in js/data.js is always present. When the site is
     served by the backend, published content, FAQs and courses from the
     database override it; if the API is unavailable (or the page is opened
     over file://), the verified static dataset is used unchanged. */
  function applySite(data) {
    if (!data) return;
    var st = data.settings || {};
    var ct = data.content || {};
    var pick = function (k) { return st[k] || ct[k]; };
    var c = S.CONTACT || {};
    ['session', 'phone', 'phoneDisplay', 'whatsapp', 'instagram', 'instagramUrl', 'bio', 'tagline'].forEach(function (k) {
      var v = pick('contact.' + k); if (v) c[k] = v;
    });
    S.CONTACT = c;
    if (Array.isArray(data.faqs) && data.faqs.length) {
      S.FAQ = data.faqs.map(function (f) { return [f.question, f.answer]; });
    }
    if (Array.isArray(data.courses) && data.courses.length) S.COURSES = data.courses;
    CONTACT = S.CONTACT; FIELDS = S.FIELDS; COURSES = S.COURSES;
  }

  function start() { boot(); }

  function init() {
    if (location.protocol === 'file:' || !window.fetch) { start(); return; }
    fetch('/api/public/site', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) { if (res && res.ok && res.data) applySite(res.data); })
      .catch(function () {})
      .then(start);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // expose minimal hooks for automated tests
  window.__SYM__ = { filtered: filtered, state: state, COURSES: COURSES, FIELDS: FIELDS, fmtSlot: fmtSlot, slotOpen: slotOpen, applySite: applySite };
})();
