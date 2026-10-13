'use strict';
/* Overseas MBBS — a focused, read-only convenience view over the courses whose
   category is "overseas" (the same records managed under Courses). It groups
   them by destination country so the overseas pipeline is easy to scan. */
const express = require('express');
const cat = require('../lib/catalogue');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell } = require('../lib/adminPage');
const { pager } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const OVERSEAS_CATEGORY = 'overseas';

function money(amount, currency) {
  return amount == null ? '—' : `₹${Number(amount).toLocaleString('en-IN')}` + (currency && currency !== 'INR' ? ` ${currency}` : '');
}

function groupByCountry(rows) {
  const groups = new Map();
  for (const c of rows) {
    const key = c.country || 'Unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

router.get('/admin/overseas', requirePermission('courses:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 50;
  const q = String(req.query.q || '').trim();
  const { total, rows } = await cat.listCourses({ category: OVERSEAS_CATEGORY, q, skip: (page - 1) * size, take: size });

  const groups = groupByCountry(rows);
  const panels = groups.length
    ? groups
        .map(
          ([country, list]) => `<section class="panel">
        <div class="panel-head"><h2>${esc(country)}</h2><span class="muted">${list.length} programme(s)</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Programme</th><th>University</th><th>Duration</th><th>Tuition</th><th>Status</th><th></th></tr></thead>
          <tbody>${list
            .map(
              (c) => `<tr>
              <td>${esc(c.name)}</td>
              <td>${esc(c.institution ? c.institution.name : '—')}</td>
              <td>${esc(c.duration || '—')}</td>
              <td>${esc(money(c.tuitionFee, c.currency))}</td>
              <td><span class="badge badge-${c.status === 'published' ? 'ok' : 'off'}">${esc(c.status)}</span></td>
              <td><a class="pg" href="/admin/courses/${esc(c.id)}">Manage</a></td>
            </tr>`
            )
            .join('')}</tbody></table></div>
      </section>`
        )
        .join('')
    : '<section class="panel"><p class="empty">No overseas programmes yet. Add one from <a class="pg" href="/admin/courses">Courses</a> with the category “overseas”.</p></section>';

  const body = `<section class="panel">
    <div class="panel-head"><h2>Overseas MBBS</h2><span class="muted">Read-only view of category “overseas”</span></div>
    <form class="filters" method="get" action="/admin/overseas">
      <input type="search" name="q" placeholder="Search overseas programmes" value="${esc(q)}">
      <button class="btn btn-line" type="submit">Search</button>
      <a class="btn btn-line" href="/admin/courses/new">Add overseas course</a>
    </form>
    <p class="note">These are the same records managed under <a class="pg" href="/admin/courses">Courses</a> — edit them there. Grouped by destination country.</p>
    ${pager('/admin/overseas', page, total, size)}
  </section>${panels}`;

  res.send(shell(req, 'Overseas MBBS', 'overseas', body));
});

/* JSON API: the same list, flat. */
router.get('/api/admin/overseas', requirePermission('courses:read'), async (req, res) => {
  const { rows } = await cat.listCourses({ category: OVERSEAS_CATEGORY, q: String(req.query.q || ''), take: 200 });
  return ok(
    res,
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      city: c.city,
      university: c.institution ? c.institution.name : null,
      duration: c.duration,
      tuitionFee: c.tuitionFee,
      currency: c.currency,
      status: c.status,
      featured: c.featured,
    }))
  );
});

module.exports = router;
