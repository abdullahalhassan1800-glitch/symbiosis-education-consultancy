'use strict';
/* Courses + Fee records — HTML CRUD, publish workflow, CSV import/export,
   JSON API. Fee changes are versioned in FeeChange. */
const express = require('express');
const prisma = require('../db');
const cat = require('../lib/catalogue');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const csv = require('../lib/csv');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell, errCode } = require('../lib/adminPage');
const { field, textarea, select, checkbox, pager, fmtDate, fmtDateTime, STATUS_OPTIONS } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const FEE_KINDS = [
  { value: 'tuition', label: 'Tuition' },
  { value: 'additional', label: 'Additional' },
  { value: 'other', label: 'Other' },
];
const FEE_STATUS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

function money(amount, currency) {
  return amount == null ? '—' : `₹${Number(amount).toLocaleString('en-IN')}` + (currency && currency !== 'INR' ? ` ${currency}` : '');
}

function courseForm(course, { action, csrfToken, institutionOptions, categoryOptions }) {
  const insts = [{ value: '', label: '— none —' }].concat(institutionOptions.map((i) => ({ value: i.id, label: i.name + (i.city ? ' · ' + i.city : '') })));
  const cats = categoryOptions.slice();
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Name', name: 'name', value: course.name, required: true })}
      ${field({ label: 'Public id', name: 'publicId', value: course.publicId, hint: 'e.g. mbbs-georgia' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Slug', name: 'slug', value: course.slug, hint: 'Leave blank to auto-generate.' })}
      ${field({ label: 'Category (field)', name: 'category', value: course.category, attrs: cats.length ? `list="catList"` : '' })}
    </div>
    ${cats.length ? `<datalist id="catList">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>` : ''}
    <div class="form-grid2">
      ${select({ label: 'University', name: 'institutionId', value: course.institutionId || '', options: insts })}
      ${field({ label: 'Country', name: 'country', value: course.country })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'City', name: 'city', value: course.city })}
      ${field({ label: 'Duration', name: 'duration', value: course.duration, placeholder: 'e.g. 5.5 years' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Tuition fee', name: 'tuitionFee', value: course.tuitionFee, type: 'number', attrs: 'min="0" step="1"' })}
      ${field({ label: 'Additional charges', name: 'additionalCharges', value: course.additionalCharges, type: 'number', attrs: 'min="0" step="1"' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Currency', name: 'currency', value: course.currency || 'INR', placeholder: 'INR' })}
      ${field({ label: 'Academic year', name: 'academicYear', value: course.academicYear, placeholder: '2026-27' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Application deadline', name: 'applicationDeadline', value: fmtDate(course.applicationDeadline), type: 'date' })}
      ${field({ label: 'Last verified', name: 'lastVerifiedAt', value: fmtDate(course.lastVerifiedAt), type: 'date' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Entrance exam', name: 'entranceExam', value: course.entranceExam })}
      ${field({ label: 'Official source URL', name: 'officialSourceUrl', value: course.officialSourceUrl, type: 'url' })}
    </div>
    ${textarea({ label: 'Eligibility', name: 'eligibility', value: course.eligibility, rows: 3 })}
    ${textarea({ label: 'Description', name: 'description', value: course.description, rows: 4 })}
    <div class="form-grid2">
      ${select({ label: 'Status', name: 'status', value: course.status || 'draft', options: STATUS_OPTIONS })}
      ${checkbox({ label: 'Featured on the website', name: 'featured', checked: !!course.featured })}
    </div>
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save course</button></div>
  </form>`;
}

/* -------------------------------------------------------------- course list */
router.get('/admin/courses', requirePermission('courses:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const category = String(req.query.category || '');
  const institutionId = String(req.query.institution || '');
  const featured = String(req.query.featured || '');
  const [{ total, rows }, institutionOptions] = await Promise.all([
    cat.listCourses({ q, status, category, institutionId, featured, skip: (page - 1) * size, take: size }),
    cat.institutionOptions(),
  ]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('courses:write');
  const instFilter = `<option value="">All universities</option>${institutionOptions.map((i) => `<option value="${esc(i.id)}"${i.id === institutionId ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}`;

  const body = `<section class="panel">
    <div class="panel-head"><h2>Courses</h2><span>
      <a class="btn btn-line" href="/admin/courses/export.csv">Export CSV</a>
      ${canWrite ? '<a class="btn btn-line" href="/admin/courses/import">Import CSV</a><a class="btn btn-gold" href="/admin/courses/new">Add course</a>' : ''}
    </span></div>
    <form class="filters" method="get" action="/admin/courses">
      <input type="search" name="q" placeholder="Search name, id or city" value="${esc(q)}">
      <select name="institution">${instFilter}</select>
      <select name="status"><option value="">Any status</option>${STATUS_OPTIONS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="featured" value="1"${featured === '1' ? ' checked' : ''}><span>Featured only</span></label>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>University</th><th>Fee</th><th>Fees</th><th>Status</th><th></th></tr></thead><tbody>${rows
          .map(
            (c) => `<tr><td><a href="/admin/courses/${esc(c.id)}">${esc(c.name)}</a>${c.featured ? ' <span class="badge badge-gold">★</span>' : ''}</td><td>${esc(c.institution ? c.institution.name : c.country || '—')}</td><td>${esc(money(c.tuitionFee, c.currency))}</td><td>${c._count.fees}</td><td><span class="badge badge-${c.status === 'published' ? 'ok' : 'off'}">${esc(c.status)}</span></td><td><a class="pg" href="/admin/courses/${esc(c.id)}">${canWrite ? 'Edit' : 'View'}</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No courses yet. Add one or import a CSV.</p>'}
    ${pager('/admin/courses', page, total, size)}
  </section>`;
  res.send(shell(req, 'Courses', 'courses', body));
});

router.get('/admin/courses/new', requirePermission('courses:write'), async (req, res) => {
  const [institutionOptions, categoryOptions] = await Promise.all([cat.institutionOptions(), cat.categoryOptions()]);
  const body = `<section class="panel"><div class="panel-head"><h2>Add course</h2><a class="pg" href="/admin/courses">← Back</a></div>${courseForm({}, { action: '/admin/courses', csrfToken: req.session.csrfToken, institutionOptions, categoryOptions })}</section>`;
  res.send(shell(req, 'Add course', 'courses', body));
});

router.post('/admin/courses', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('courses:publish');
    if (req.body.status === 'published' && !canPublish) throw cat.httpError(403, 'forbidden', 'You do not have permission to publish courses.');
    const c = await cat.createCourse(req.body, req.user);
    await audit.log({ action: 'course.create', entity: 'Course', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, meta: { name: c.name }, req });
    return res.redirect('/admin/courses?ok=created');
  } catch (e) {
    const [institutionOptions, categoryOptions] = await Promise.all([cat.institutionOptions(), cat.categoryOptions()]);
    const body = `<section class="panel"><div class="panel-head"><h2>Add course</h2><a class="pg" href="/admin/courses">← Back</a></div>${courseForm(req.body, { action: '/admin/courses', csrfToken: req.session.csrfToken, institutionOptions, categoryOptions })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add course', 'courses', body, { kind: 'error', message: e.message }));
  }
});

/* --------------------------------------------------------------- CSV export */
router.get('/admin/courses/export.csv', requirePermission('courses:read'), async (req, res) => {
  const { rows } = await cat.listCourses({ take: 10000 });
  const out = [['publicId', 'name', 'slug', 'category', 'institution', 'country', 'city', 'duration', 'eligibility', 'entranceExam', 'tuitionFee', 'additionalCharges', 'currency', 'academicYear', 'officialSourceUrl', 'status', 'featured', 'lastVerifiedAt']];
  for (const c of rows) {
    out.push([c.publicId, c.name, c.slug, c.category, c.institution ? c.institution.name : '', c.country, c.city, c.duration, c.eligibility, c.entranceExam, c.tuitionFee, c.additionalCharges, c.currency, c.academicYear, c.officialSourceUrl, c.status, c.featured ? '1' : '0', fmtDate(c.lastVerifiedAt)]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="courses.csv"');
  res.send(csv.stringify(out));
});

router.get('/admin/fees/export.csv', requirePermission('fees:read'), async (req, res) => {
  const { rows } = await cat.listFees({ take: 10000 });
  const out = [['courseSlug', 'label', 'amount', 'currency', 'academicYear', 'kind', 'status']];
  for (const f of rows) out.push([f.course ? f.course.slug : '', f.label, f.amount, f.currency, f.academicYear, f.kind, f.status]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fees.csv"');
  res.send(csv.stringify(out));
});

/* --------------------------------------------------------------- CSV import */
router.get('/admin/courses/import', requirePermission('courses:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Import courses</h2><a class="pg" href="/admin/courses">← Back</a></div>
    <p class="note">Columns: <code>publicId, name, slug, category, institution, country, city, duration, eligibility, entranceExam, tuitionFee, additionalCharges, currency, academicYear, officialSourceUrl, status, featured, lastVerifiedAt</code>. Matched by <b>slug</b> (or <b>publicId</b>); <b>institution</b> references a university name. <a class="pg" href="/admin/courses/export.csv">Download a template</a>.</p>
    <form method="post" action="/admin/courses/import" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-csv-file></label>
      ${textarea({ label: 'CSV content', name: 'csv', rows: 10, required: true, hint: 'Pick a file above or paste CSV here.' })}
      <div class="form-actions"><button class="btn btn-gold" type="submit">Import</button></div>
    </form></section>`;
  res.send(shell(req, 'Import courses', 'courses', body));
});

router.post('/admin/courses/import', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const { header, rows } = csv.toObjects(req.body.csv || '');
    if (!header.includes('name')) throw cat.httpError(400, 'bad_csv', 'Missing "name" column.');
    let n = 0;
    for (const r of rows) {
      if (!String(r.name || '').trim()) continue;
      const name = cat.str(r.name, 200);
      const publicId = cat.optStr(r.publicId, 80);
      let slug = cat.str(r.slug, 100) ? cat.slugify(r.slug) : cat.slugify(publicId || name);
      const instName = cat.str(r.institution, 200);
      const inst = instName ? await prisma.institution.findFirst({ where: { name: instName } }) : null;
      const data = {
        name, publicId, slug,
        category: cat.optStr(r.category, 60),
        institutionId: inst ? inst.id : null,
        country: cat.optStr(r.country, 120),
        city: cat.optStr(r.city, 120),
        duration: cat.optStr(r.duration, 120),
        eligibility: cat.optStr(r.eligibility, 2000),
        entranceExam: cat.optStr(r.entranceExam, 200),
        tuitionFee: cat.parseMoney(r.tuitionFee),
        additionalCharges: cat.parseMoney(r.additionalCharges),
        currency: cat.str(r.currency, 8) || 'INR',
        academicYear: cat.optStr(r.academicYear, 20),
        officialSourceUrl: cat.optStr(r.officialSourceUrl, 500),
        status: ['draft', 'published', 'archived'].includes(cat.str(r.status)) ? cat.str(r.status) : 'draft',
        featured: cat.parseBool(r.featured),
        lastVerifiedAt: cat.parseDate(r.lastVerifiedAt),
      };
      let existing = await prisma.course.findUnique({ where: { slug } });
      if (!existing && publicId) existing = await prisma.course.findUnique({ where: { publicId } });
      if (existing) await prisma.course.update({ where: { id: existing.id }, data: { ...data, updatedById: req.user.id } });
      else await prisma.course.create({ data: { ...data, createdById: req.user.id, updatedById: req.user.id } });
      n++;
    }
    await audit.log({ action: 'course.import', entity: 'Course', userId: req.user.id, actorEmail: req.user.email, meta: { rows: n }, req });
    return res.redirect('/admin/courses?ok=imported');
  } catch (e) {
    return res.redirect('/admin/courses/import?err=' + encodeURIComponent(errCode(e)));
  }
});

router.get('/admin/fees/import', requirePermission('fees:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Import fees</h2><a class="pg" href="/admin/fees">← Back</a></div>
    <p class="note">Columns: <code>courseSlug, label, amount, currency, academicYear, kind, status</code>. Matched by <b>courseSlug</b> + <b>label</b>. <a class="pg" href="/admin/fees/export.csv">Download a template</a>.</p>
    <form method="post" action="/admin/fees/import" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-csv-file></label>
      ${textarea({ label: 'CSV content', name: 'csv', rows: 10, required: true, hint: 'Pick a file above or paste CSV here.' })}
      <div class="form-actions"><button class="btn btn-gold" type="submit">Import</button></div>
    </form></section>`;
  res.send(shell(req, 'Import fees', 'fees', body));
});

router.post('/admin/fees/import', requirePermission('fees:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const { header, rows } = csv.toObjects(req.body.csv || '');
    if (!header.includes('courseSlug') || !header.includes('label')) throw cat.httpError(400, 'bad_csv', 'Missing "courseSlug" or "label" column.');
    let n = 0;
    for (const r of rows) {
      const slug = cat.slugify(r.courseSlug);
      const label = cat.str(r.label, 200);
      if (!slug || !label) continue;
      const course = await prisma.course.findUnique({ where: { slug } });
      if (!course) continue;
      const data = {
        label,
        amount: cat.parseMoney(r.amount),
        currency: cat.str(r.currency, 8) || 'INR',
        academicYear: cat.optStr(r.academicYear, 20),
        kind: ['tuition', 'additional', 'other'].includes(cat.str(r.kind)) ? cat.str(r.kind) : 'tuition',
        status: ['draft', 'published'].includes(cat.str(r.status)) ? cat.str(r.status) : 'draft',
      };
      const existing = await prisma.feeRecord.findFirst({ where: { courseId: course.id, label } });
      if (existing) await prisma.feeRecord.update({ where: { id: existing.id }, data: { ...data, updatedById: req.user.id } });
      else await prisma.feeRecord.create({ data: { ...data, courseId: course.id, createdById: req.user.id, updatedById: req.user.id } });
      n++;
    }
    await audit.log({ action: 'fee.import', entity: 'FeeRecord', userId: req.user.id, actorEmail: req.user.email, meta: { rows: n }, req });
    return res.redirect('/admin/fees?ok=imported');
  } catch (e) {
    return res.redirect('/admin/fees/import?err=' + encodeURIComponent(errCode(e)));
  }
});

/* ----------------------------------------------------------- course detail */
async function feeRows(fees) {
  if (!fees.length) return '<p class="empty">No fee records yet.</p>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Label</th><th>Amount</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>${fees
    .map(
      (f) => `<tr><td><a href="/admin/fees/${esc(f.id)}">${esc(f.label)}</a></td><td>${esc(money(f.amount, f.currency))}</td><td>${esc(f.kind)}</td><td><span class="badge badge-${f.status === 'published' ? 'ok' : 'off'}">${esc(f.status)}</span></td>
        <td><form method="post" action="/admin/fees/${esc(f.id)}/delete" data-confirm="Delete this fee record?"><input type="hidden" name="_csrf" value="${esc(f._csrf || '')}"><button class="pg" type="submit">Delete</button></form></td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

router.get('/admin/courses/:id', requirePermission('courses:read'), async (req, res) => {
  const c = await cat.getCourse(req.params.id);
  const [institutionOptions, categoryOptions] = await Promise.all([cat.institutionOptions(), cat.categoryOptions()]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('courses:write');
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('courses:publish');
  const canFees = req.user.role.key === 'super_admin' || req.permissions.has('fees:write');
  if (!c) return res.status(404).send(shell(req, 'Not found', 'courses', '<section class="panel"><p class="empty">Course not found.</p></section>'));
  const csrfToken = req.session.csrfToken;

  const publishPanel = canPublish
    ? `<section class="panel"><div class="panel-head"><h2>Publishing</h2></div>
        <p class="muted">Current status: <b>${esc(c.status)}</b></p>
        <div class="danger-row">
          <form method="post" action="/admin/courses/${esc(c.id)}/publish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-gold" type="submit">Publish</button></form>
          <form method="post" action="/admin/courses/${esc(c.id)}/unpublish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-line" type="submit">Move to draft</button></form>
        </div></section>`
    : '';

  const feesPanel = `<section class="panel"><div class="panel-head"><h2>Fee records</h2></div>
    ${(await feeRows(c.fees.map((f) => ({ ...f, _csrf: csrfToken }))))}
    ${canFees ? `<form method="post" action="/admin/courses/${esc(c.id)}/fees" class="form-grid" novalidate>
      <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
      <div class="form-grid2">
        ${field({ label: 'Label', name: 'label', required: true, placeholder: 'e.g. Tuition (Year 1)' })}
        ${field({ label: 'Amount', name: 'amount', type: 'number', attrs: 'min="0" step="1"' })}
      </div>
      <div class="form-grid2">
        ${select({ label: 'Kind', name: 'kind', value: 'tuition', options: FEE_KINDS })}
        ${select({ label: 'Status', name: 'status', value: 'draft', options: FEE_STATUS })}
      </div>
      <div class="form-actions"><button class="btn btn-line" type="submit">Add fee record</button></div>
    </form>` : ''}</section>`;

  const body = `<section class="panel"><div class="panel-head"><h2>${esc(c.name)}</h2><a class="pg" href="/admin/courses">← Back</a></div>
      ${canWrite ? courseForm(c, { action: `/admin/courses/${esc(c.id)}`, csrfToken, institutionOptions, categoryOptions }) : '<p class="muted">Read-only.</p>'}
    </section>
    ${publishPanel}
    ${feesPanel}
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div>
      <form method="post" action="/admin/courses/${esc(c.id)}/delete" data-confirm="Delete this course?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete course</button></form></section>` : ''}`;
  res.send(shell(req, c.name, 'courses', body));
});

router.post('/admin/courses/:id', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('courses:publish');
    if (req.body.status === 'published' && !canPublish) throw cat.httpError(403, 'forbidden', 'You do not have permission to publish courses.');
    await cat.updateCourse(req.params.id, req.body, req.user);
    await audit.log({ action: 'course.update', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/courses/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/courses/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/courses/:id/publish', requirePermission('courses:publish'), csrf.requireCsrf, async (req, res) => {
  await cat.setCourseStatus(req.params.id, 'published', req.user);
  await audit.log({ action: 'course.publish', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/courses/${req.params.id}?ok=published`);
});
router.post('/admin/courses/:id/unpublish', requirePermission('courses:publish'), csrf.requireCsrf, async (req, res) => {
  await cat.setCourseStatus(req.params.id, 'draft', req.user);
  await audit.log({ action: 'course.unpublish', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/courses/${req.params.id}?ok=unpublished`);
});
router.post('/admin/courses/:id/delete', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  await cat.deleteCourse(req.params.id);
  await audit.log({ action: 'course.delete', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/courses?ok=deleted');
});

/* -------------------------------------------------------------- fee records */
router.post('/admin/courses/:id/fees', requirePermission('fees:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.addFee(req.params.id, req.body, req.user);
    await audit.log({ action: 'fee.create', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/courses/${req.params.id}?ok=created`);
  } catch (e) {
    return res.redirect(`/admin/courses/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

function feeForm(fee, { action, csrfToken }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Label', name: 'label', value: fee.label, required: true })}
      ${field({ label: 'Amount', name: 'amount', value: fee.amount, type: 'number', attrs: 'min="0" step="1"' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Currency', name: 'currency', value: fee.currency || 'INR' })}
      ${field({ label: 'Academic year', name: 'academicYear', value: fee.academicYear })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Kind', name: 'kind', value: fee.kind || 'tuition', options: FEE_KINDS })}
      ${select({ label: 'Status', name: 'status', value: fee.status || 'draft', options: FEE_STATUS })}
    </div>
    ${field({ label: 'Source URL', name: 'sourceUrl', value: fee.sourceUrl, type: 'url' })}
    ${field({ label: 'Verified', name: 'verifiedAt', value: fmtDate(fee.verifiedAt), type: 'date' })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save fee record</button></div>
  </form>`;
}

router.get('/admin/fees', requirePermission('fees:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 25;
  const q = String(req.query.q || '').trim();
  const { total, rows } = await cat.listFees({ q, skip: (page - 1) * size, take: size });
  const canFees = req.user.role.key === 'super_admin' || req.permissions.has('fees:write');
  const body = `<section class="panel">
    <div class="panel-head"><h2>Fee records</h2><span>
      <a class="btn btn-line" href="/admin/fees/export.csv">Export CSV</a>
      ${canFees ? '<a class="btn btn-line" href="/admin/fees/import">Import CSV</a>' : ''}
    </span></div>
    <form class="filters" method="get" action="/admin/fees"><input type="search" name="q" placeholder="Search label" value="${esc(q)}"><button class="btn btn-line" type="submit">Search</button></form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Label</th><th>Amount</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>${rows
          .map(
            (f) => `<tr><td>${f.course ? `<a href="/admin/courses/${esc(f.courseId)}">${esc(f.course.name)}</a>` : '—'}</td><td><a href="/admin/fees/${esc(f.id)}">${esc(f.label)}</a></td><td>${esc(money(f.amount, f.currency))}</td><td>${esc(f.kind)}</td><td><span class="badge badge-${f.status === 'published' ? 'ok' : 'off'}">${esc(f.status)}</span></td><td><a class="pg" href="/admin/fees/${esc(f.id)}">${canFees ? 'Edit' : 'View'}</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No fee records yet.</p>'}
    ${pager('/admin/fees', page, total, size)}
  </section>`;
  res.send(shell(req, 'Fees & Eligibility', 'fees', body));
});

router.get('/admin/fees/:id', requirePermission('fees:read'), async (req, res) => {
  const fee = await prisma.feeRecord.findUnique({ where: { id: req.params.id }, include: { course: true } });
  if (!fee) return res.status(404).send(shell(req, 'Not found', 'fees', '<section class="panel"><p class="empty">Fee record not found.</p></section>'));
  const canFees = req.user.role.key === 'super_admin' || req.permissions.has('fees:write');
  const changes = await cat.listFeeChanges(fee.id);
  const history = changes.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Label</th><th>Amount</th><th>Note</th></tr></thead><tbody>${changes
        .map((h) => `<tr><td>${esc(fmtDateTime(h.createdAt))}</td><td>${esc((h.oldLabel || '—') + ' → ' + (h.newLabel || '—'))}</td><td>${esc((h.oldAmount == null ? '—' : h.oldAmount) + ' → ' + (h.newAmount == null ? '—' : h.newAmount))}</td><td>${esc(h.note || '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="empty">No changes recorded.</p>';
  const body = `<section class="panel"><div class="panel-head"><h2>${esc(fee.label)}</h2><a class="pg" href="/admin/fees">← Back</a></div>
      <p class="muted">Course: ${fee.course ? `<a href="/admin/courses/${esc(fee.courseId)}">${esc(fee.course.name)}</a>` : '—'}</p>
      ${canFees ? feeForm(fee, { action: `/admin/fees/${esc(fee.id)}`, csrfToken: req.session.csrfToken }) : '<p class="muted">Read-only.</p>'}
    </section>
    <section class="panel"><div class="panel-head"><h2>Change history</h2></div>${history}</section>
    ${canFees ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><form method="post" action="/admin/fees/${esc(fee.id)}/delete" data-confirm="Delete this fee record?"><input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}"><button class="btn btn-danger" type="submit">Delete fee record</button></form></section>` : ''}`;
  res.send(shell(req, fee.label, 'fees', body));
});

router.post('/admin/fees/:id', requirePermission('fees:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cat.updateFee(req.params.id, req.body, req.user);
    await audit.log({ action: 'fee.update', entity: 'FeeRecord', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/fees/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/fees/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/fees/:id/delete', requirePermission('fees:write'), csrf.requireCsrf, async (req, res) => {
  const fee = await prisma.feeRecord.findUnique({ where: { id: req.params.id } });
  const courseId = fee ? fee.courseId : null;
  await cat.deleteFee(req.params.id);
  await audit.log({ action: 'fee.delete', entity: 'FeeRecord', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(courseId ? `/admin/courses/${courseId}?ok=deleted` : '/admin/fees?ok=deleted');
});

/* ------------------------------------------------------------- JSON API */
router.get('/api/admin/courses', requirePermission('courses:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await cat.listCourses({ q: String(req.query.q || ''), status: String(req.query.status || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, status: c.status, tuitionFee: c.tuitionFee, currency: c.currency })), { page, pageSize: size, total });
});
router.post('/api/admin/courses', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('courses:publish');
  if (req.body.status === 'published' && !canPublish) throw cat.httpError(403, 'forbidden', 'You do not have permission to publish courses.');
  const c = await cat.createCourse(req.body, req.user);
  await audit.log({ action: 'course.create', entity: 'Course', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: c.id, name: c.name, slug: c.slug } });
});
router.patch('/api/admin/courses/:id', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('courses:publish');
  if (req.body.status === 'published' && !canPublish) throw cat.httpError(403, 'forbidden', 'You do not have permission to publish courses.');
  await cat.updateCourse(req.params.id, req.body, req.user);
  await audit.log({ action: 'course.update', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.post('/api/admin/courses/:id/publish', requirePermission('courses:publish'), csrf.requireCsrf, async (req, res) => {
  await cat.setCourseStatus(req.params.id, 'published', req.user);
  await audit.log({ action: 'course.publish', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id, status: 'published' });
});
router.delete('/api/admin/courses/:id', requirePermission('courses:write'), csrf.requireCsrf, async (req, res) => {
  await cat.deleteCourse(req.params.id);
  await audit.log({ action: 'course.delete', entity: 'Course', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});
router.get('/api/admin/fees', requirePermission('fees:read'), async (req, res) => {
  const { total, rows } = await cat.listFees({ q: String(req.query.q || ''), courseId: String(req.query.course || ''), take: 100 });
  return ok(res, rows.map((f) => ({ id: f.id, courseId: f.courseId, label: f.label, amount: f.amount, currency: f.currency, kind: f.kind, status: f.status })), { total });
});

module.exports = router;
