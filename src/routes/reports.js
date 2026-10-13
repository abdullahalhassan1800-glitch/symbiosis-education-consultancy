'use strict';
/* Reports — live analytics for leads, appointments, enquiries and the
   catalogue. Server-rendered HTML, CSV export and a JSON API. Read-only. */
const express = require('express');
const reports = require('../lib/reports');
const csv = require('../lib/csv');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell } = require('../lib/adminPage');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

function metricCard(label, value, hint) {
  return `<div class="metric"><span class="m-label">${esc(label)}</span><b class="m-value">${esc(
    value
  )}</b>${hint ? `<span class="m-hint">${esc(hint)}</span>` : ''}</div>`;
}

function barRow(label, value, max) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="rep-row"><span class="rep-key">${esc(label)}</span>
    <span class="rep-bar"><span class="rep-bar-fill" style="width:${pct}%"></span></span>
    <b class="rep-val">${esc(value)}</b></div>`;
}

function breakdown(title, map) {
  const entries = Object.entries(map);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  const rows = entries.length
    ? entries.map(([k, v]) => barRow(k.replace(/_/g, ' '), v, max)).join('')
    : '<p class="empty">No data.</p>';
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div>${rows}</section>`;
}

function fmtRange(q) {
  const r = reports.parseRange(q);
  return { from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------------- page */
router.get('/admin/reports', requirePermission('reports:view'), async (req, res) => {
  const range = fmtRange(req.query);
  const s = await reports.getSummary(reports.parseRange(req.query));
  const qs = `from=${esc(range.from)}&to=${esc(range.to)}`;

  const body = `
  <section class="panel">
    <form class="filters" method="get" action="/admin/reports">
      <label class="field-inline"><span>From</span><input type="date" name="from" value="${esc(range.from)}"></label>
      <label class="field-inline"><span>To</span><input type="date" name="to" value="${esc(range.to)}"></label>
      <button class="btn btn-line" type="submit">Apply</button>
      <a class="btn btn-line" href="/admin/reports/export.csv?${qs}">Export CSV</a>
    </form>
    <p class="note">Showing activity created between <b>${esc(range.from)}</b> and <b>${esc(
    range.to
  )}</b> (UTC). Figures are computed live — empty tables show 0.</p>
  </section>

  <section class="metrics">
    ${metricCard('Leads (period)', s.leads.total)}
    ${metricCard('Converted leads', s.leads.byStatus.converted, s.funnel.conversionRate + '% of period')}
    ${metricCard('Appointments (period)', s.appointments.total)}
    ${metricCard('Upcoming appointments', s.appointments.upcoming, 'pending or confirmed')}
    ${metricCard('Enquiries (period)', s.enquiries.total)}
    ${metricCard('Published courses', s.catalogue.coursesByStatus.published)}
    ${metricCard('Institutions', s.catalogue.institutions)}
    ${metricCard('Countries', s.catalogue.countries)}
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Conversion funnel</h2><span class="muted">All-time lead pipeline</span></div>
    ${Object.entries(s.funnel.overall)
      .map(([k, v]) => barRow(k.replace(/_/g, ' '), v, Math.max(1, ...Object.values(s.funnel.overall))))
      .join('')}
  </section>

  <div class="grid-2">
    ${breakdown('Leads by status', s.leads.byStatus)}
    ${breakdown('Leads by source', s.leads.bySource)}
    ${breakdown('Appointments by status', s.appointments.byStatus)}
    ${breakdown('Enquiries by status', s.enquiries.byStatus)}
    ${breakdown('Courses by status', s.catalogue.coursesByStatus)}
  </div>`;

  res.send(shell(req, 'Reports', 'reports', body));
});

/* -------------------------------------------------------------- CSV export */
router.get('/admin/reports/export.csv', requirePermission('reports:view'), async (req, res) => {
  const s = await reports.getSummary(reports.parseRange(req.query));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="symbiosis-reports.csv"');
  res.send(csv.stringify(reports.toCsvRows(s)));
});

/* --------------------------------------------------------------- JSON API */
router.get('/api/admin/reports', requirePermission('reports:view'), async (req, res) => {
  const s = await reports.getSummary(reports.parseRange(req.query));
  return ok(res, s);
});

module.exports = router;
