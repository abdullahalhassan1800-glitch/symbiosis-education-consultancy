'use strict';
/* Universities (Institutions) — HTML CRUD, CSV import/export, JSON API. */
const express = require('express');
const prisma = require('../db');
const cat = require('../lib/catalogue');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const csv = require('../lib/csv');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell, errCode } = require('../lib/adminPage');
const { field, textarea, select, pager, fmtDate, STATUS_OPTIONS } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const VERIFY_OPTIONS = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
];

function institutionForm(inst, { action, csrfToken, countryOptions }) {
  const countries = [{ value: '', label: '— none —' }].concat(countryOptions.map((c) => ({ value: c.id, label: c.name })));
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Name', name: 'name', value: inst.name, required: true })}
      ${field({ label: 'Slug', name: 'slug', value: inst.slug, hint: 'Leave blank to auto-generate.' })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Country', name: 'countryId', value: inst.countryId || '', options: countries })}
      ${field({ label: 'City', name: 'city', value: inst.city })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Verification', name: 'verificationStatus', value: inst.verificationStatus || 'unverified', options: VERIFY_OPTIONS })}
      ${select({ label: 'Status', name: 'status', value: inst.status || 'draft', options: STATUS_OPTIONS })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Official website', name: 'officialWebsite', value: inst.officialWebsite, type: 'url' })}
      ${field({ label: 'Logo URL', name: 'logoUrl', value: inst.logoUrl })}
    </div>
    ${field({ label: 'Last verified', name: 'lastVerifiedAt', value: fmtDate(inst.lastVerifiedAt), type: 'date' })}
    ${textarea({ label: 'Description', name: 'description', value: inst.description, rows: 4 })}
    ${textarea({ label: 'Programmes', name: 'programmes', value: inst.programmes, rows: 3 })}
    ${textarea({ label: 'Recognition info', name: 'recognitionInfo', value: inst.recognitionInfo, rows: 3 })}
    ${textarea({ label: 'Source URLs', name: 'sourceUrls', value: cat.readList(inst.sourceUrls).join('\n'), rows: 3, hint: 'One URL per line.' })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save university</button></div>
  </form>`;
}

router.get('/admin/universities', requirePermission('institutions:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const countryId = String(req.query.country || '');
  const status = String(req.query.status || '');
  const [{ total, rows }, countries] = await Promise.all([
    cat.listInstitutions({ q, countryId, status, skip: (page - 1) * size, take: size }),
    cat.countryOptions(),
  ]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('institutions:write');
  const countryFilter = `<option value="">All countries</option>${countries.map((c) => `<option value="${esc(c.id)}"${c.id === countryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`;

  const body = `<section class="panel">
    <div class="panel-head"><h2>Universities</h2><span>
      <a class="btn btn-line" href="/admin/universities/export.csv">Export CSV</a>
      ${canWrite ? '<a class="btn btn-line" href="/admin/universities/import">Import CSV</a><a class="btn btn-gold" href="/admin/universities/new">Add university</a>' : ''}
    </span></div>
    <form class="filters" method="get" action="/admin/universities">
      <input type="search" name="q" placeholder="Search name or city" value="${esc(q)}">
      <select name="country">${countryFilter}</select>
      <select name="status"><option value="">Any status</option>${STATUS_OPTIONS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Country</th><th>City</th><th>Courses</th><th>Verification</th><th>Status</th><th></th></tr></thead><tbody>${rows
          .map(
            (i) => `<tr><td><a href="/admin/universities/${esc(i.id)}">${esc(i.name)}</a></td><td>${esc(i.country ? i.country.name : '—')}</td><td>${esc(i.city || '—')}</td><td>${i._count.courses}</td><td>${esc(i.verificationStatus)}</td><td><span class="badge badge-${i.status === 'published' ? 'ok' : 'off'}">${esc(i.status)}</span></td><td><a class="pg" href="/admin/universities/${esc(i.id)}">${canWrite ? 'Edit' : 'View'}</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No universities yet. Add one or import a CSV.</p>'}
    ${pager('/admin/universities', page, total, size)}
  </section>`;
  res.send(shell(req, 'Universities', 'universities', body));
});

router.get('/admin/universities/new', requirePermission('institutions:write'), async (req, res) => {
  const countryOptions = await cat.countryOptions();
  const body = `<section class="panel"><div class="panel-head"><h2>Add university</h2><a class="pg" href="/admin/universities">← Back</a></div>${institutionForm({}, { action: '/admin/universities', csrfToken: req.session.csrfToken, countryOptions })}</section>`;
  res.send(shell(req, 'Add university', 'universities', body));
});

router.post('/admin/universities', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const i = await cat.createInstitution(req.body, req.user);
    await audit.log({ action: 'institution.create', entity: 'Institution', entityId: i.id, userId: req.user.id, actorEmail: req.user.email, meta: { name: i.name }, req });
    return res.redirect('/admin/universities?ok=created');
  } catch (e) {
    const countryOptions = await cat.countryOptions();
    const body = `<section class="panel"><div class="panel-head"><h2>Add university</h2><a class="pg" href="/admin/universities">← Back</a></div>${institutionForm(req.body, { action: '/admin/universities', csrfToken: req.session.csrfToken, countryOptions })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add university', 'universities', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/universities/export.csv', requirePermission('institutions:read'), async (req, res) => {
  const { rows } = await cat.listInstitutions({ take: 10000 });
  const out = [['name', 'slug', 'country', 'city', 'officialWebsite', 'logoUrl', 'description', 'programmes', 'recognitionInfo', 'sourceUrls', 'verificationStatus', 'status']];
  for (const i of rows) {
    out.push([i.name, i.slug, i.country ? i.country.name : '', i.city, i.officialWebsite, i.logoUrl, i.description, i.programmes, i.recognitionInfo, cat.readList(i.sourceUrls).join('|'), i.verificationStatus, i.status]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="universities.csv"');
  res.send(csv.stringify(out));
});

router.get('/admin/universities/import', requirePermission('institutions:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Import universities</h2><a class="pg" href="/admin/universities">← Back</a></div>
    <p class="note">Columns: <code>name, slug, country, city, officialWebsite, logoUrl, description, programmes, recognitionInfo, sourceUrls, verificationStatus, status</code>. Matched by <b>slug</b>; <b>country</b> references the country name. <a class="pg" href="/admin/universities/export.csv">Download a template</a>.</p>
    <form method="post" action="/admin/universities/import" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-csv-file></label>
      ${textarea({ label: 'CSV content', name: 'csv', rows: 10, required: true, hint: 'Pick a file above or paste CSV here.' })}
      <div class="form-actions"><button class="btn btn-gold" type="submit">Import</button></div>
    </form></section>`;
  res.send(shell(req, 'Import universities', 'universities', body));
});

router.post('/admin/universities/import', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const { header, rows } = csv.toObjects(req.body.csv || '');
    if (!header.includes('name')) throw cat.httpError(400, 'bad_csv', 'Missing "name" column.');
    let n = 0;
    for (const r of rows) {
      if (!String(r.name || '').trim()) continue;
      const countryName = cat.str(r.country, 200);
      const country = countryName ? await prisma.country.findUnique({ where: { name: countryName } }) : null;
      const name = cat.str(r.name, 200);
      const slug = cat.str(r.slug, 100) ? cat.slugify(r.slug) : cat.slugify(name);
      const data = {
        name,
        slug,
        countryId: country ? country.id : null,
        city: cat.optStr(r.city, 120),
        officialWebsite: cat.optStr(r.officialWebsite, 500),
        logoUrl: cat.optStr(r.logoUrl, 500),
        description: cat.optStr(r.description),
        programmes: cat.optStr(r.programmes),
        recognitionInfo: cat.optStr(r.recognitionInfo),
        sourceUrls: cat.parseList(String(r.sourceUrls || '').split('|').join('\n')),
        verificationStatus: ['verified', 'unverified', 'pending'].includes(cat.str(r.verificationStatus)) ? cat.str(r.verificationStatus) : 'unverified',
        status: ['draft', 'published', 'archived'].includes(cat.str(r.status)) ? cat.str(r.status) : 'draft',
      };
      const existing = await prisma.institution.findUnique({ where: { slug } });
      if (existing) await prisma.institution.update({ where: { id: existing.id }, data: { ...data, updatedById: req.user.id } });
      else await prisma.institution.create({ data: { ...data, createdById: req.user.id, updatedById: req.user.id } });
      n++;
    }
    await audit.log({ action: 'institution.import', entity: 'Institution', userId: req.user.id, actorEmail: req.user.email, meta: { rows: n }, req });
    return res.redirect('/admin/universities?ok=imported');
  } catch (e) {
    return res.redirect('/admin/universities/import?err=' + encodeURIComponent(errCode(e)));
  }
});

router.get('/admin/universities/:id', requirePermission('institutions:read'), async (req, res) => {
  const i = await cat.getInstitution(req.params.id);
  const countryOptions = await cat.countryOptions();
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('institutions:write');
  if (!i) return res.status(404).send(shell(req, 'Not found', 'universities', '<section class="panel"><p class="empty">University not found.</p></section>'));
  const body = `<section class="panel"><div class="panel-head"><h2>${esc(i.name)}</h2><a class="pg" href="/admin/universities">← Back</a></div>
      ${canWrite ? institutionForm(i, { action: `/admin/universities/${esc(i.id)}`, csrfToken: req.session.csrfToken, countryOptions }) : '<p class="muted">Read-only.</p>'}
    </section>${canWrite ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div>
      <form method="post" action="/admin/universities/${esc(i.id)}/delete" data-confirm="Delete this university?">
        <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
        <button class="btn btn-danger" type="submit">Delete university</button>
      </form></section>` : ''}`;
  res.send(shell(req, i.name, 'universities', body));
});

router.post('/admin/universities/:id', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.updateInstitution(req.params.id, req.body, req.user);
    await audit.log({ action: 'institution.update', entity: 'Institution', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/universities/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/universities/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/universities/:id/delete', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.deleteInstitution(req.params.id);
    await audit.log({ action: 'institution.delete', entity: 'Institution', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/universities?ok=deleted');
  } catch (e) {
    return res.redirect(`/admin/universities/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

/* ------------------------------------------------------------- JSON API */
router.get('/api/admin/institutions', requirePermission('institutions:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await cat.listInstitutions({ q: String(req.query.q || ''), countryId: String(req.query.country || ''), status: String(req.query.status || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((i) => ({ id: i.id, name: i.name, slug: i.slug, country: i.country ? i.country.name : null, city: i.city, status: i.status })), { page, pageSize: size, total });
});
router.post('/api/admin/institutions', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  const i = await cat.createInstitution(req.body, req.user);
  await audit.log({ action: 'institution.create', entity: 'Institution', entityId: i.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: i.id, name: i.name, slug: i.slug } });
});
router.patch('/api/admin/institutions/:id', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  await cat.updateInstitution(req.params.id, req.body, req.user);
  await audit.log({ action: 'institution.update', entity: 'Institution', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.delete('/api/admin/institutions/:id', requirePermission('institutions:write'), csrf.requireCsrf, async (req, res) => {
  await cat.deleteInstitution(req.params.id);
  await audit.log({ action: 'institution.delete', entity: 'Institution', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

module.exports = router;
