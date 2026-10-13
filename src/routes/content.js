'use strict';
/* Website CMS routes: editable site content (with revision history), FAQs,
   media library and settings. HTML pages + JSON API. */
const express = require('express');
const config = require('../config');
const cm = require('../lib/content');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const { ok, fail, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell, errCode } = require('../lib/adminPage');
const { field, textarea, select, pager, fmtDateTime, STATUS_OPTIONS } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const CONTENT_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'html', label: 'HTML' },
  { value: 'url', label: 'URL' },
  { value: 'list', label: 'List (one per line)' },
];
const PUBLISH_STATUS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];
function badge(status) {
  const cls = status === 'published' ? 'ok' : 'off';
  return `<span class="badge badge-${cls}">${esc(status)}</span>`;
}
function bytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* ========================================================= WEBSITE CONTENT */
function contentForm(entry, { action, csrfToken, isNew }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Key', name: 'key', value: entry.key, required: true, attrs: 'list="keyList"', hint: 'e.g. home.hero.title' })}
      ${select({ label: 'Type', name: 'type', value: entry.type || 'text', options: CONTENT_TYPES })}
    </div>
    <datalist id="keyList">${cm.CONTENT_KEYS.map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist>
    ${textarea({ label: 'Value', name: 'value', value: entry.value, rows: 6, hint: 'For a list, enter one item per line.' })}
    ${select({ label: 'Status', name: 'status', value: entry.status || 'draft', options: PUBLISH_STATUS })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">${isNew ? 'Create entry' : 'Save changes'}</button></div>
  </form>`;
}

router.get('/admin/content', requirePermission('content:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 25;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const { total, rows } = await cm.listContent({ q, status, skip: (page - 1) * size, take: size });
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('content:write');
  const body = `<section class="panel">
    <div class="panel-head"><h2>Website content</h2>${canWrite ? '<a class="btn btn-gold" href="/admin/content/new">Add entry</a>' : ''}</div>
    <p class="note">Published entries are served to the public website via <code>/api/public/site</code>. Unpublished entries stay private.</p>
    <form class="filters" method="get" action="/admin/content">
      <input type="search" name="q" placeholder="Search key or value" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${PUBLISH_STATUS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Key</th><th>Value</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rows
          .map(
            (r) => `<tr><td><a href="/admin/content/${esc(r.id)}"><code>${esc(r.key)}</code></a></td><td>${esc(String(r.value).slice(0, 80))}</td><td>${esc(r.type)}</td><td>${badge(r.status)}</td><td>${esc(fmtDateTime(r.updatedAt))}</td><td><a class="pg" href="/admin/content/${esc(r.id)}">${canWrite ? 'Edit' : 'View'}</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No content entries yet. Add one to override text on the website.</p>'}
    ${pager('/admin/content', page, total, size)}
  </section>`;
  res.send(shell(req, 'Website Content', 'content', body));
});

router.get('/admin/content/new', requirePermission('content:write'), async (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Add content entry</h2><a class="pg" href="/admin/content">← Back</a></div>${contentForm({ type: 'text', status: 'draft' }, { action: '/admin/content', csrfToken: req.session.csrfToken, isNew: true })}</section>`;
  res.send(shell(req, 'Add content', 'content', body));
});

router.post('/admin/content', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
    if (req.body.status === 'published' && !canPublish) throw cm.httpError(403, 'forbidden', 'You do not have permission to publish content.');
    const c = await cm.saveContent(req.body, req.user);
    await audit.log({ action: 'content.create', entity: 'WebsiteContent', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, meta: { key: c.key }, req });
    return res.redirect('/admin/content?ok=created');
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>Add content entry</h2><a class="pg" href="/admin/content">← Back</a></div>${contentForm(req.body, { action: '/admin/content', csrfToken: req.session.csrfToken, isNew: true })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add content', 'content', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/content/:id', requirePermission('content:read'), async (req, res) => {
  const c = await cm.getContent(req.params.id);
  if (!c) return res.status(404).send(shell(req, 'Not found', 'content', '<section class="panel"><p class="empty">Content entry not found.</p></section>'));
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('content:write');
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
  const csrfToken = req.session.csrfToken;
  const revisions = c.revisions.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Previous value</th><th>Status</th></tr></thead><tbody>${c.revisions
        .map((r) => `<tr><td>${esc(fmtDateTime(r.createdAt))}</td><td>${esc(String(r.value).slice(0, 120))}</td><td>${badge(r.status)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="empty">No revisions yet.</p>';
  const publishPanel = canPublish
    ? `<section class="panel"><div class="panel-head"><h2>Publishing</h2></div>
        <p class="muted">Current status: <b>${esc(c.status)}</b></p>
        <div class="danger-row">
          <form method="post" action="/admin/content/${esc(c.id)}/publish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-gold" type="submit">Publish</button></form>
          <form method="post" action="/admin/content/${esc(c.id)}/unpublish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-line" type="submit">Move to draft</button></form>
        </div></section>`
    : '';
  const body = `<section class="panel"><div class="panel-head"><h2><code>${esc(c.key)}</code></h2><a class="pg" href="/admin/content">← Back</a></div>
      ${canWrite ? contentForm(c, { action: `/admin/content/${esc(c.id)}`, csrfToken }) : '<p class="muted">Read-only.</p>'}
    </section>
    ${publishPanel}
    <section class="panel"><div class="panel-head"><h2>Revision history</h2></div>${revisions}</section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><form method="post" action="/admin/content/${esc(c.id)}/delete" data-confirm="Delete this content entry?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete entry</button></form></section>` : ''}`;
  res.send(shell(req, c.key, 'content', body));
});

router.post('/admin/content/:id', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
    if (req.body.status === 'published' && !canPublish) throw cm.httpError(403, 'forbidden', 'You do not have permission to publish content.');
    await cm.updateContent(req.params.id, req.body, req.user);
    await audit.log({ action: 'content.update', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/content/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/content/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/content/:id/publish', requirePermission('content:publish'), csrf.requireCsrf, async (req, res) => {
  await cm.setContentStatus(req.params.id, 'published', req.user);
  await audit.log({ action: 'content.publish', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/content/${req.params.id}?ok=published`);
});
router.post('/admin/content/:id/unpublish', requirePermission('content:publish'), csrf.requireCsrf, async (req, res) => {
  await cm.setContentStatus(req.params.id, 'draft', req.user);
  await audit.log({ action: 'content.unpublish', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/content/${req.params.id}?ok=unpublished`);
});
router.post('/admin/content/:id/delete', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  await cm.deleteContent(req.params.id);
  await audit.log({ action: 'content.delete', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/content?ok=deleted');
});

/* ==================================================================== FAQs */
function faqForm(faq, { action, csrfToken }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    ${field({ label: 'Question', name: 'question', value: faq.question, required: true })}
    ${textarea({ label: 'Answer', name: 'answer', value: faq.answer, rows: 4, required: true })}
    <div class="form-grid2">
      ${field({ label: 'Category', name: 'category', value: faq.category, hint: 'Optional — e.g. Fees' })}
      ${select({ label: 'Status', name: 'status', value: faq.status || 'draft', options: PUBLISH_STATUS })}
    </div>
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save FAQ</button></div>
  </form>`;
}

router.get('/admin/faqs', requirePermission('faqs:read'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const { total, rows } = await cm.listFaqs({ q, status, take: 200 });
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('faqs:write');
  const csrfToken = req.session.csrfToken;
  const table = rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Question</th><th>Status</th><th></th></tr></thead><tbody>${rows
        .map(
          (f, i) => `<tr><td>${i + 1}</td><td><a href="/admin/faqs/${esc(f.id)}">${esc(f.question)}</a></td><td>${badge(f.status)}</td><td>${
            canWrite
              ? `<form method="post" action="/admin/faqs/${esc(f.id)}/move" class="inline"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><input type="hidden" name="dir" value="up"><button class="pg" type="submit">↑</button></form>
                 <form method="post" action="/admin/faqs/${esc(f.id)}/move" class="inline"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><input type="hidden" name="dir" value="down"><button class="pg" type="submit">↓</button></form>`
              : ''
          }<a class="pg" href="/admin/faqs/${esc(f.id)}">${canWrite ? 'Edit' : 'View'}</a></td></tr>`
        )
        .join('')}</tbody></table></div>`
    : '<p class="empty">No FAQs yet. Published FAQs appear in the website FAQ section.</p>';
  const body = `<section class="panel">
    <div class="panel-head"><h2>FAQs</h2>${canWrite ? '<a class="btn btn-gold" href="/admin/faqs/new">Add FAQ</a>' : ''}</div>
    <form class="filters" method="get" action="/admin/faqs">
      <input type="search" name="q" placeholder="Search questions" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${PUBLISH_STATUS.map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${table}
  </section>`;
  res.send(shell(req, 'FAQs', 'faqs', body));
});

router.get('/admin/faqs/new', requirePermission('faqs:write'), (req, res) => {
  const body = `<section class="panel"><div class="panel-head"><h2>Add FAQ</h2><a class="pg" href="/admin/faqs">← Back</a></div>${faqForm({ status: 'draft' }, { action: '/admin/faqs', csrfToken: req.session.csrfToken })}</section>`;
  res.send(shell(req, 'Add FAQ', 'faqs', body));
});

router.post('/admin/faqs', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('faqs:write');
    if (req.body.status === 'published' && !canPublish) throw cm.httpError(403, 'forbidden', 'Not permitted.');
    const f = await cm.createFaq(req.body, req.user);
    await audit.log({ action: 'faq.create', entity: 'Faq', entityId: f.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/faqs?ok=created');
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>Add FAQ</h2><a class="pg" href="/admin/faqs">← Back</a></div>${faqForm(req.body, { action: '/admin/faqs', csrfToken: req.session.csrfToken })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add FAQ', 'faqs', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/faqs/:id', requirePermission('faqs:read'), async (req, res) => {
  const f = await cm.getFaq(req.params.id);
  if (!f) return res.status(404).send(shell(req, 'Not found', 'faqs', '<section class="panel"><p class="empty">FAQ not found.</p></section>'));
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('faqs:write');
  const csrfToken = req.session.csrfToken;
  const body = `<section class="panel"><div class="panel-head"><h2>FAQ</h2><a class="pg" href="/admin/faqs">← Back</a></div>
      ${canWrite ? faqForm(f, { action: `/admin/faqs/${esc(f.id)}`, csrfToken }) : `<p class="muted"><b>${esc(f.question)}</b><br>${esc(f.answer)}</p>`}
    </section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Publishing &amp; ordering</h2></div>
      <div class="danger-row">
        <form method="post" action="/admin/faqs/${esc(f.id)}/publish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-gold" type="submit">Publish</button></form>
        <form method="post" action="/admin/faqs/${esc(f.id)}/unpublish"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-line" type="submit">Move to draft</button></form>
      </div></section>
    <section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><form method="post" action="/admin/faqs/${esc(f.id)}/delete" data-confirm="Delete this FAQ?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete FAQ</button></form></section>` : ''}`;
  res.send(shell(req, 'FAQ', 'faqs', body));
});

router.post('/admin/faqs/:id', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cm.updateFaq(req.params.id, req.body, req.user);
    await audit.log({ action: 'faq.update', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/faqs/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/faqs/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});
router.post('/admin/faqs/:id/publish', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.setFaqStatus(req.params.id, 'published', req.user);
  await audit.log({ action: 'faq.publish', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/faqs/${req.params.id}?ok=published`);
});
router.post('/admin/faqs/:id/unpublish', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.setFaqStatus(req.params.id, 'draft', req.user);
  await audit.log({ action: 'faq.unpublish', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect(`/admin/faqs/${req.params.id}?ok=unpublished`);
});
router.post('/admin/faqs/:id/move', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.moveFaq(req.params.id, req.body.dir === 'up' ? 'up' : 'down');
  return res.redirect('/admin/faqs?ok=updated');
});
router.post('/admin/faqs/:id/delete', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.deleteFaq(req.params.id);
  await audit.log({ action: 'faq.delete', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/faqs?ok=deleted');
});

/* ============================================================ MEDIA LIBRARY */
function mediaCard(m, canWrite, csrfToken) {
  const thumb = /^image\//.test(m.mimeType) || /\.(png|jpe?g|webp|gif|svg)$/i.test(m.path)
    ? `<img class="media-thumb" src="${esc(m.path)}" alt="${esc(m.altText || m.filename)}" loading="lazy">`
    : `<div class="media-thumb media-thumb-file">${esc((m.mimeType || '').split('/').pop().slice(0, 4).toUpperCase() || 'FILE')}</div>`;
  return `<figure class="media-card">${thumb}
    <figcaption><a href="${esc(m.path)}" target="_blank" rel="noopener">${esc(m.filename)}</a>
    <small>${esc(m.mimeType)} · ${esc(bytes(m.size))}</small></figcaption>
    ${canWrite ? `<form method="post" action="/admin/media/${esc(m.id)}/delete" data-confirm="Delete this media asset?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger btn-sm" type="submit">Delete</button></form>` : ''}</figure>`;
}

router.get('/admin/media', requirePermission('media:read'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { total, rows } = await cm.listMedia({ q, take: 96 });
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('media:write');
  const csrfToken = req.session.csrfToken;
  const uploadPanel = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Upload media</h2><span class="muted">PNG, JPEG, WEBP, GIF, SVG or PDF · up to ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB</span></div>
      <form data-media-upload method="post" action="/admin/media/upload" class="form-grid" enctype="multipart/form-data">
        <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
        ${field({ label: 'File', name: 'file', type: 'file', attrs: 'accept="image/*,application/pdf"' })}
        ${field({ label: 'Alt text', name: 'altText', hint: 'Describe the image for screen readers and SEO.' })}
        <div class="form-actions"><button class="btn btn-gold" type="submit">Upload</button></div>
      </form>
      <p class="note">On static/serverless hosting the filesystem is read-only — use “Add by URL” below instead.</p></section>`
    : '';
  const urlPanel = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Add by URL</h2></div>
      <form method="post" action="/admin/media/url" class="form-grid">
        <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
        ${field({ label: 'Path or URL', name: 'path', required: true, placeholder: '/assets/photos/example.jpg or https://…' })}
        <div class="form-grid2">
          ${field({ label: 'Display name', name: 'filename' })}
          ${field({ label: 'Alt text', name: 'altText' })}
        </div>
        <div class="form-actions"><button class="btn btn-line" type="submit">Add reference</button></div>
      </form></section>`
    : '';
  const body = `${uploadPanel}${urlPanel}
  <section class="panel"><div class="panel-head"><h2>Library</h2><span class="muted">${total} asset(s)</span></div>
    <form class="filters" method="get" action="/admin/media"><input type="search" name="q" placeholder="Search filename or alt text" value="${esc(q)}"><button class="btn btn-line" type="submit">Search</button></form>
    ${rows.length ? `<div class="media-grid">${rows.map((m) => mediaCard(m, canWrite, csrfToken)).join('')}</div>` : '<p class="empty">No media yet.</p>'}
  </section>`;
  res.send(shell(req, 'Media Library', 'media', body));
});

router.post(
  '/admin/media/upload',
  requirePermission('media:write'),
  express.raw({ type: () => true, limit: config.maxUploadBytes + 1024 }),
  csrf.requireCsrf,
  async (req, res) => {
    try {
      const ctype = String(req.headers['content-type'] || '');
      if (/multipart\/form-data/i.test(ctype)) {
        return fail(res, 400, 'no_js', 'JavaScript is required to upload files.');
      }
      const filename = decodeURIComponent(req.headers['x-filename'] || '') || 'upload';
      const altText = req.headers['x-alt-text'] || '';
      const asset = await cm.saveUpload({ buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), mimeType: req.headers['content-type'], filename, altText, actor: req.user });
      await audit.log({ action: 'media.upload', entity: 'MediaAsset', entityId: asset.id, userId: req.user.id, actorEmail: req.user.email, meta: { path: asset.path }, req });
      return res.status(201).json({ ok: true, data: { id: asset.id, path: asset.path } });
    } catch (e) {
      return res.status(e.status || 400).json({ ok: false, error: { code: e.code || 'error', message: e.message } });
    }
  }
);

router.post('/admin/media/url', requirePermission('media:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const asset = await cm.createMediaUrl(req.body, req.user);
    await audit.log({ action: 'media.add', entity: 'MediaAsset', entityId: asset.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/media?ok=created');
  } catch (e) {
    return res.redirect('/admin/media?err=' + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/media/:id/delete', requirePermission('media:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await cm.deleteMedia(req.params.id);
    await audit.log({ action: 'media.delete', entity: 'MediaAsset', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/media?ok=deleted');
  } catch (e) {
    return res.redirect('/admin/media?err=' + encodeURIComponent(errCode(e)));
  }
});

/* ================================================================ SETTINGS */
router.get('/admin/settings', requirePermission('settings:write'), async (req, res) => {
  const values = await cm.getSettings();
  const body = `<section class="panel"><div class="panel-head"><h2>Contact &amp; business settings</h2></div>
    <p class="note">These override the built-in defaults on the public website. Leave a field blank to use the value shipped in <code>js/data.js</code>.</p>
    <form method="post" action="/admin/settings" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      ${cm.SETTING_KEYS.map((s) => field({ label: s.label, name: s.key, value: values[s.key] || '' })).join('')}
      <div class="form-actions"><button class="btn btn-gold" type="submit">Save settings</button></div>
    </form></section>`;
  res.send(shell(req, 'Settings', 'settings', body));
});

router.post('/admin/settings', requirePermission('settings:write'), csrf.requireCsrf, async (req, res) => {
  await cm.setSettings(req.body, req.user);
  await audit.log({ action: 'settings.update', entity: 'Setting', userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/settings?ok=updated');
});

/* =============================================================== JSON API */
router.get('/api/admin/content', requirePermission('content:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await cm.listContent({ q: String(req.query.q || ''), status: String(req.query.status || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((r) => ({ id: r.id, key: r.key, value: r.value, type: r.type, status: r.status })), { page, pageSize: size, total });
});
router.post('/api/admin/content', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  const canPublish = req.user.role.key === 'super_admin' || req.permissions.has('content:publish');
  if (req.body.status === 'published' && !canPublish) throw cm.httpError(403, 'forbidden', 'You do not have permission to publish content.');
  const c = await cm.saveContent(req.body, req.user);
  await audit.log({ action: 'content.create', entity: 'WebsiteContent', entityId: c.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: c.id, key: c.key } });
});
router.patch('/api/admin/content/:id', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  await cm.updateContent(req.params.id, { ...req.body, key: req.body.key }, req.user);
  await audit.log({ action: 'content.update', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.delete('/api/admin/content/:id', requirePermission('content:write'), csrf.requireCsrf, async (req, res) => {
  await cm.deleteContent(req.params.id);
  await audit.log({ action: 'content.delete', entity: 'WebsiteContent', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

router.get('/api/admin/faqs', requirePermission('faqs:read'), async (req, res) => {
  const { total, rows } = await cm.listFaqs({ q: String(req.query.q || ''), status: String(req.query.status || ''), take: 200 });
  return ok(res, rows.map((f) => ({ id: f.id, question: f.question, answer: f.answer, status: f.status, position: f.position })), { total });
});
router.post('/api/admin/faqs', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  const f = await cm.createFaq(req.body, req.user);
  await audit.log({ action: 'faq.create', entity: 'Faq', entityId: f.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: f.id } });
});
router.patch('/api/admin/faqs/:id', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.updateFaq(req.params.id, req.body, req.user);
  await audit.log({ action: 'faq.update', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.delete('/api/admin/faqs/:id', requirePermission('faqs:write'), csrf.requireCsrf, async (req, res) => {
  await cm.deleteFaq(req.params.id);
  await audit.log({ action: 'faq.delete', entity: 'Faq', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

router.get('/api/admin/media', requirePermission('media:read'), async (req, res) => {
  const { total, rows } = await cm.listMedia({ q: String(req.query.q || ''), take: 200 });
  return ok(res, rows.map((m) => ({ id: m.id, filename: m.filename, mimeType: m.mimeType, size: m.size, path: m.path, altText: m.altText })), { total });
});
router.post('/api/admin/media', requirePermission('media:write'), csrf.requireCsrf, async (req, res) => {
  const asset = await cm.createMediaUrl(req.body, req.user);
  await audit.log({ action: 'media.add', entity: 'MediaAsset', entityId: asset.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: asset.id, path: asset.path } });
});
router.delete('/api/admin/media/:id', requirePermission('media:write'), csrf.requireCsrf, async (req, res) => {
  await cm.deleteMedia(req.params.id);
  await audit.log({ action: 'media.delete', entity: 'MediaAsset', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

router.get('/api/admin/settings', requirePermission('settings:write'), async (req, res) => {
  return ok(res, await cm.getSettings());
});
router.put('/api/admin/settings', requirePermission('settings:write'), csrf.requireCsrf, async (req, res) => {
  const values = await cm.setSettings(req.body, req.user);
  await audit.log({ action: 'settings.update', entity: 'Setting', userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, values);
});

module.exports = router;
