'use strict';
/* Countries — HTML CRUD, CSV import/export, JSON API. */
const express = require('express');
const prisma = require('../db');
const cat = require('../lib/catalogue');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const csv = require('../lib/csv');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell, errCode } = require('../lib/adminPage');
const { field, textarea, select, pager, STATUS_OPTIONS } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

function countryForm(c, { action, csrfToken }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Name', name: 'name', value: c.name, required: true, placeholder: 'e.g. Georgia' })}
      ${field({ label: 'ISO code', name: 'code', value: c.code, placeholder: 'GE' })}
    </div>
    ${select({ label: 'Status', name: 'status', value: c.status || 'draft', options: STATUS_OPTIONS })}
    ${field({ label: 'Flag image URL', name: 'flagImage', value: c.flagImage })}
    ${field({ label: 'Living cost estimate', name: 'livingCostEstimate', value: c.livingCostEstimate, placeholder: 'e.g. ₹18,000–25,000 / month' })}
    ${textarea({ label: 'Overview', name: 'overview', value: c.overview, rows: 4 })}
    ${textarea({ label: 'Admission guidance', name: 'admissionGuidance', value: c.admissionGuidance, rows: 3 })}
    ${textarea({ label: 'Visa guidance', name: 'visaGuidance', value: c.visaGuidance, rows: 3 })}
    ${textarea({ label: 'Official links', name: 'officialLinks', value: cat.readList(c.officialLinks).join('\n'), rows: 3, hint: 'One URL per line.' })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save country</button></div>
  </form>`;
}

router.get('/admin/countries', requirePermission('countries:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const { total, rows } = await cat.listCountries({ q, status, skip: (page - 1) * size, take: size });
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('countries:write');

  const body = `<section class="panel">
    <div class="panel-head"><h2>Countries</h2><span>
      <a class="btn btn-line" href="/admin/countries/export.csv">Export CSV</a>
      ${canWrite ? '<a class="btn btn-line" href="/admin/countries/import">Import CSV</a><a class="btn btn-gold" href="/admin/countries/new">Add country</a>' : ''}
    </span></div>
    <form class="filters" method="get" action="/admin/countries">
      <input type="search" name="q" placeholder="Search countries" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${STATUS_OPTIONS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Code</th><th>Universities</th><th>Status</th><th></th></tr></thead><tbody>${rows
          .map(
            (c) => `<tr><td><a href="/admin/countries/${esc(c.id)}">${esc(c.name)}</a></td><td>${esc(c.code || '—')}</td><td>${c._count.institutions}</td><td><span class="badge badge-${c.status === 'published' ? 'ok' : 'off'}">${esc(c.status)}</span></td><td><a class="pg" href="/admin/countries/${esc(c.id)}">${canWrite ? 'Edit' : 'View'}</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No countries yet. Add one or import a CSV.</p>'}
    ${pager('/admin/countries', page, total, size)}
  </section>`;
  res.send(shell(req, 'Countries', 'countries', body));
});

router.get('/admin/countries/new', requirePermission('countries:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Add country</h2><a class="pg" href="/admin/countries">← Back</a></div>${countryForm({}, { action: '/admin/countries', csrfToken: req.session.csrfToken })}</section>`;
  res.send(shell(req, 'Add country', 'countries', body));
});

router.post('/admin/countries', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const c = await cat.createCountry(req.body, req.user);
    await audit.log({ action: 'country.create', entity: 'Country', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, meta: { name: c.name }, req });
    return res.redirect('/admin/countries?ok=created');
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>Add country</h2><a class="pg" href="/admin/countries">← Back</a></div>${countryForm(req.body, { action: '/admin/countries', csrfToken: req.session.csrfToken })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add country', 'countries', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/countries/export.csv', requirePermission('countries:read'), async (req, res) => {
  const rows = await cat.listCountries({ take: 10000 });
  const out = [['name', 'code', 'status', 'overview', 'flagImage', 'admissionGuidance', 'livingCostEstimate', 'visaGuidance', 'officialLinks']];
  for (const c of rows.rows) {
    out.push([c.name, c.code, c.status, c.overview, c.flagImage, c.admissionGuidance, c.livingCostEstimate, c.visaGuidance, cat.readList(c.officialLinks).join('|')]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="countries.csv"');
  res.send(csv.stringify(out));
});

router.get('/admin/countries/import', requirePermission('countries:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Import countries</h2><a class="pg" href="/admin/countries">← Back</a></div>
    <p class="note">Columns: <code>name, code, status, overview, flagImage, admissionGuidance, livingCostEstimate, visaGuidance, officialLinks</code>. Rows are matched to existing countries by <b>name</b>. <a class="pg" href="/admin/countries/export.csv">Download a template</a>.</p>
    <form method="post" action="/admin/countries/import" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-csv-file></label>
      ${textarea({ label: 'CSV content', name: 'csv', rows: 10, required: true, hint: 'Pick a file above or paste CSV here.' })}
      <div class="form-actions"><button class="btn btn-gold" type="submit">Import</button></div>
    </form></section>`;
  res.send(shell(req, 'Import countries', 'countries', body));
});

router.post('/admin/countries/import', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const { header, rows } = csv.toObjects(req.body.csv || '');
    if (!header.includes('name')) throw cat.httpError(400, 'bad_csv', 'Missing "name" column.');
    let n = 0;
    for (const r of rows) {
      if (!String(r.name || '').trim()) continue;
      const data = {
        name: cat.str(r.name, 200),
        code: cat.str(r.code, 4) ? cat.str(r.code, 4).toUpperCase() : null,
        status: ['draft', 'published', 'archived'].includes(cat.str(r.status)) ? cat.str(r.status) : 'draft',
        overview: cat.optStr(r.overview),
        flagImage: cat.optStr(r.flagImage, 500),
        admissionGuidance: cat.optStr(r.admissionGuidance),
        livingCostEstimate: cat.optStr(r.livingCostEstimate, 500),
        visaGuidance: cat.optStr(r.visaGuidance),
        officialLinks: cat.parseList(String(r.officialLinks || '').split('|').join('\n')),
      };
      await prismaUpsertCountry(data, req.user);
      n++;
    }
    await audit.log({ action: 'country.import', entity: 'Country', userId: req.user.id, actorEmail: req.user.email, meta: { rows: n }, req });
    return res.redirect('/admin/countries?ok=imported');
  } catch (e) {
    return res.redirect('/admin/countries/import?err=' + encodeURIComponent(errCode(e)));
  }
});

/* import upsert: matched to an existing country by name */
async function prismaUpsertCountry(data, actor) {
  const existing = await prisma.country.findUnique({ where: { name: data.name } });
  if (existing) await prisma.country.update({ where: { id: existing.id }, data: { ...data, updatedById: actor.id } });
  else await prisma.country.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
}

router.get('/admin/countries/:id', requirePermission('countries:read'), async (req, res) => {
  const c = await cat.getCountry(req.params.id);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('countries:write');
  if (!c) return res.status(404).send(shell(req, 'Not found', 'countries', '<section class="panel"><p class="empty">Country not found.</p></section>'));
  const body = `<section class="panel"><div class="panel-head"><h2>${esc(c.name)}</h2><a class="pg" href="/admin/countries">← Back</a></div>
      ${canWrite ? countryForm(c, { action: `/admin/countries/${esc(c.id)}`, csrfToken: req.session.csrfToken }) : '<p class="muted">Read-only.</p>'}
    </section>${canWrite ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div>
      <form method="post" action="/admin/countries/${esc(c.id)}/delete" data-confirm="Delete this country?">
        <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
        <button class="btn btn-danger" type="submit">Delete country</button>
      </form></section>` : ''}`;
  res.send(shell(req, c.name, 'countries', body));
});

router.post('/admin/countries/:id', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.updateCountry(req.params.id, req.body, req.user);
    await audit.log({ action: 'country.update', entity: 'Country', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/countries/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/countries/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/countries/:id/delete', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.deleteCountry(req.params.id);
    await audit.log({ action: 'country.delete', entity: 'Country', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/countries?ok=deleted');
  } catch (e) {
    return res.redirect(`/admin/countries/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

/* ------------------------------------------------------------- JSON API */
router.get('/api/admin/countries', requirePermission('countries:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await cat.listCountries({ q: String(req.query.q || ''), status: String(req.query.status || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((c) => ({ id: c.id, name: c.name, code: c.code, status: c.status, institutions: c._count.institutions })), { page, pageSize: size, total });
});
router.post('/api/admin/countries', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  const c = await cat.createCountry(req.body, req.user);
  await audit.log({ action: 'country.create', entity: 'Country', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: c.id, name: c.name } });
});
router.patch('/api/admin/countries/:id', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  await cat.updateCountry(req.params.id, req.body, req.user);
  await audit.log({ action: 'country.update', entity: 'Country', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.delete('/api/admin/countries/:id', requirePermission('countries:write'), csrf.requireCsrf, async (req, res) => {
  await cat.deleteCountry(req.params.id);
  await audit.log({ action: 'country.delete', entity: 'Country', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

module.exports = router;
