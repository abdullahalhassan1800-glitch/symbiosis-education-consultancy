'use strict';
/* Testimonials module: student success stories shown on the website.
   Full CRUD, gated by the CMS permissions (content:read / content:write /
   content:publish). Unpublished rows are never served publicly. */
const express = require('express');
const prisma = require('../db');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell } = require('../lib/adminPage');
const { field, textarea, select, checkbox, pager, fmtDateTime } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];
const RATING_OPTIONS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n + ' ★' }));
const MAX_RATING = 5;

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}
const str = (v, max = 2000) => (v == null ? '' : String(v).trim().slice(0, max));
const optStr = (v, max = 2000) => str(v, max) || null;

function badge(status) {
  const cls = status === 'published' ? 'ok' : 'off';
  return `<span class="badge badge-${cls}">${esc(status)}</span>`;
}
function stars(n) {
  const r = Math.max(0, Math.min(MAX_RATING, Number(n) || 0));
  return '<span class="stars" aria-label="' + r + ' out of 5">' + '★'.repeat(r) + '<span class="stars-off">' + '★'.repeat(MAX_RATING - r) + '</span></span>';
}

function input(body) {
  const rating = Math.max(1, Math.min(MAX_RATING, parseInt(body.rating, 10) || MAX_RATING));
  const status = body.status === 'published' ? 'published' : 'draft';
  return {
    name: str(body.name, 120),
    course: optStr(body.course, 160),
    city: optStr(body.city, 120),
    message: str(body.message, 4000),
    rating,
    avatarUrl: optStr(body.avatarUrl, 1000),
    consentStatus: body.consent === '1' || body.consent === 'on' || body.consentStatus === 'true',
    position: parseInt(body.position, 10) || 0,
    status,
  };
}

function validate(data) {
  if (data.name.length < 2) throw httpError(400, 'validation', 'A student name is required.');
  if (data.message.length < 10) throw httpError(400, 'validation', 'The testimonial text is required (at least 10 characters).');
  return data;
}

function form(t, { action, csrfToken, isNew }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Student name', name: 'name', value: t.name, required: true, placeholder: 'e.g. Ananya Sharma' })}
      ${field({ label: 'Course / programme', name: 'course', value: t.course, placeholder: 'e.g. MBBS — Georgia' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'City', name: 'city', value: t.city, placeholder: 'e.g. Bhopal' })}
      ${select({ label: 'Rating', name: 'rating', value: String(t.rating || 5), options: RATING_OPTIONS })}
    </div>
    ${textarea({ label: 'Testimonial', name: 'message', value: t.message, rows: 5, required: true, hint: 'Published exactly as written — keep it genuine and consent-approved.' })}
    <div class="form-grid2">
      ${field({ label: 'Avatar image URL (optional)', name: 'avatarUrl', value: t.avatarUrl, type: 'url', placeholder: 'https://…' })}
      ${field({ label: 'Sort position', name: 'position', value: String(t.position == null ? 0 : t.position), type: 'number', hint: 'Lower shows first.' })}
    </div>
    ${select({ label: 'Status', name: 'status', value: t.status || 'draft', options: STATUS_OPTIONS })}
    ${checkbox({ label: 'I have this student\u2019s consent to publish their words and name.', name: 'consent', checked: !!t.consentStatus })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">${isNew ? 'Create testimonial' : 'Save changes'}</button></div>
  </form>`;
}

/* --------------------------------------------------------------- list page */
router.get('/admin/testimonials', requirePermission('content:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = str(req.query.q, 120);
  const status = str(req.query.status, 20);
  const where = { deletedAt: null };
  if (q) where.OR = [{ name: { contains: q } }, { course: { contains: q } }, { message: { contains: q } }];
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.testimonial.count({ where }),
    prisma.testimonial.findMany({ where, orderBy: [{ position: 'asc' }, { createdAt: 'desc' }], skip: (page - 1) * size, take: size }),
  ]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('content:write');

  const table = rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Course</th><th>City</th><th>Rating</th><th>Consent</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr>
          <td><a href="/admin/testimonials/${esc(r.id)}">${esc(r.name)}</a></td>
          <td>${esc(r.course || '—')}</td>
          <td>${esc(r.city || '—')}</td>
          <td>${stars(r.rating)}</td>
          <td>${r.consentStatus ? '<span class="badge badge-ok">Yes</span>' : '<span class="badge badge-gold">No</span>'}</td>
          <td>${badge(r.status)}</td>
          <td>${esc(fmtDateTime(r.updatedAt))}</td>
          <td><a class="pg" href="/admin/testimonials/${esc(r.id)}">${canWrite ? 'Edit' : 'View'}</a></td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
    : '<p class="empty">No testimonials yet. Add the first one, or run <code>npm run db:demo</code> to load demo data.</p>';

  const body = `<section class="panel">
    <div class="panel-head"><h2>Testimonials</h2>${canWrite ? '<a class="btn btn-gold" href="/admin/testimonials/new">Add testimonial</a>' : ''}</div>
    <p class="note">Only <b>published</b> and <b>consent-approved</b> testimonials are shown on the public website. Nothing here is auto-generated.</p>
    <form class="filters" method="get" action="/admin/testimonials">
      <input type="search" name="q" placeholder="Search name, course or text" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${STATUS_OPTIONS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${table}
    ${pager('/admin/testimonials', page, total, size)}
  </section>`;
  res.send(shell(req, 'Testimonials', 'testimonials', body));
});

/* ------------------------------------------------------------- create page */
router.get('/admin/testimonials/new', requirePermission('content:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Add testimonial</h2><a class="pg" href="/admin/testimonials">← Back</a></div>${form({ rating: 5, status: 'draft', position: 0 }, { action: '/admin/testimonials', csrfToken: req.session.csrfToken, isNew: true })}</section>`;
  res.send(shell(req, 'Add testimonial', 'testimonials', body));
});

router.post('/admin/testimonials', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
  try {
    const data = validate(input(req.body));
    if (data.status === 'published' && !canPublish) throw httpError(403, 'forbidden', 'You do not have permission to publish testimonials.');
    const created = await prisma.testimonial.create({ data: { ...data, createdById: req.user.id, updatedById: req.user.id } });
    await audit.log({ action: 'testimonial.create', entity: 'Testimonial', entityId: created.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/testimonials?ok=created');
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>Add testimonial</h2><a class="pg" href="/admin/testimonials">← Back</a></div>${form(req.body, { action: '/admin/testimonials', csrfToken: req.session.csrfToken, isNew: true })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add testimonial', 'testimonials', body, { kind: 'error', message: e.message }));
  }
});

/* --------------------------------------------------------------- edit page */
router.get('/admin/testimonials/:id', requirePermission('content:read'), async (req, res) => {
  const t = await prisma.testimonial.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!t) return res.status(404).send(shell(req, 'Not found', 'testimonials', '<section class="panel"><p class="empty">Testimonial not found.</p></section>'));
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('content:write');
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
  const csrfToken = req.session.csrfToken;

  const publishPanel = canPublish
    ? `<section class="panel"><div class="panel-head"><h2>Publishing</h2></div>
        <p class="muted">Current status: <b>${esc(t.status)}</b>${t.consentStatus ? '' : ' — ⚠ consent not recorded'}</p>
        <div class="danger-row">
          <form method="post" action="/admin/testimonials/${esc(t.id)}/status"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><input type="hidden" name="status" value="published"><button class="btn btn-gold" type="submit">Publish</button></form>
          <form method="post" action="/admin/testimonials/${esc(t.id)}/status"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><input type="hidden" name="status" value="draft"><button class="btn btn-line" type="submit">Move to draft</button></form>
        </div></section>`
    : '';
  const deletePanel = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div>
        <form method="post" action="/admin/testimonials/${esc(t.id)}/delete" data-confirm="Delete this testimonial?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete testimonial</button></form></section>`
    : '';

  const body = `<section class="panel"><div class="panel-head"><h2>${esc(t.name)}</h2><a class="pg" href="/admin/testimonials">← Back</a></div>
      ${canWrite ? form(t, { action: `/admin/testimonials/${esc(t.id)}`, csrfToken }) : `<blockquote class="quote">${esc(t.message)}</blockquote><p class="muted">Read-only.</p>`}
    </section>
    ${publishPanel}
    ${deletePanel}`;
  res.send(shell(req, 'Edit testimonial', 'testimonials', body));
});

router.post('/admin/testimonials/:id', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
  const existing = await prisma.testimonial.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).send(shell(req, 'Not found', 'testimonials', '<section class="panel"><p class="empty">Testimonial not found.</p></section>'));
  try {
    const data = validate(input(req.body));
    if (data.status === 'published' && !canPublish) throw httpError(403, 'forbidden', 'You do not have permission to publish testimonials.');
    await prisma.testimonial.update({ where: { id: existing.id }, data: { ...data, updatedById: req.user.id } });
    await audit.log({ action: 'testimonial.update', entity: 'Testimonial', entityId: existing.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/testimonials/${existing.id}?ok=updated`);
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>${esc(existing.name)}</h2><a class="pg" href="/admin/testimonials">← Back</a></div>${form(req.body, { action: `/admin/testimonials/${esc(existing.id)}`, csrfToken: req.session.csrfToken })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Edit testimonial', 'testimonials', body, { kind: 'error', message: e.message }));
  }
});

router.post('/admin/testimonials/:id/status', requirePermission('content:publish'), csrf.requireCsrf, async (req, res) => {
  const status = req.body.status === 'published' ? 'published' : 'draft';
  const existing = await prisma.testimonial.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).send(shell(req, 'Not found', 'testimonials', '<section class="panel"><p class="empty">Testimonial not found.</p></section>'));
  await prisma.testimonial.update({ where: { id: existing.id }, data: { status, updatedById: req.user.id } });
  await audit.log({ action: status === 'published' ? 'testimonial.publish' : 'testimonial.unpublish', entity: 'Testimonial', entityId: existing.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/testimonials/${existing.id}?ok=${status === 'published' ? 'published' : 'unpublished'}`);
});

router.post('/admin/testimonials/:id/delete', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  const existing = await prisma.testimonial.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (existing) {
    await prisma.testimonial.update({ where: { id: existing.id }, data: { deletedAt: new Date(), updatedById: req.user.id } });
    await audit.log({ action: 'testimonial.delete', entity: 'Testimonial', entityId: existing.id, userId: req.user.id, actorEmail: req.user.email, req });
  }
  return res.redirect('/admin/testimonials?ok=deleted');
});

/* --------------------------------------------------------------- JSON API */
router.get('/api/admin/testimonials', requirePermission('content:read'), async (req, res) => {
  const status = str(req.query.status, 20);
  const where = { deletedAt: null };
  if (status) where.status = status;
  const rows = await prisma.testimonial.findMany({ where, orderBy: [{ position: 'asc' }, { createdAt: 'desc' }] });
  return ok(res, rows.map((r) => ({ id: r.id, name: r.name, course: r.course, city: r.city, message: r.message, rating: r.rating, avatarUrl: r.avatarUrl, consentStatus: r.consentStatus, status: r.status, position: r.position, updatedAt: r.updatedAt })));
});

module.exports = router;
