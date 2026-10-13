'use strict';
/* Staff & Roles — server-rendered pages (PRG) and JSON API. Permissions are
   enforced server-side; see src/lib/people.js for the business guards. */
const express = require('express');
const prisma = require('../db');
const people = require('../lib/people');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const { layout, esc } = require('../lib/render');
const { ok, wrapRouter } = require('../lib/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { navFor } = require('./admin');

const router = wrapRouter(express.Router());

const FLASH = {
  created: ['ok', 'Staff member created.'],
  updated: ['ok', 'Staff member updated.'],
  password: ['ok', 'Password reset. That user was signed out everywhere.'],
  status: ['ok', 'Status updated.'],
  deleted: ['ok', 'Staff member removed.'],
  role_saved: ['ok', 'Role permissions saved.'],
  role_created: ['ok', 'Role created.'],
  email_taken: ['error', 'That email is already in use.'],
  weak_password: ['error', 'Password needs at least 10 characters with upper & lower case and a number.'],
  last_super_admin: ['error', 'You cannot remove the last active super administrator.'],
  self_disable: ['error', 'You cannot disable or delete your own account.'],
  self_delete: ['error', 'You cannot delete your own account.'],
  locked_role: ['error', 'The Super Admin role cannot be edited.'],
  validation: ['error', 'Please check the submitted values and try again.'],
  bad_role: ['error', 'That role does not exist.'],
};

function flash(req) {
  const okCode = req.query.ok;
  const errCode = req.query.err;
  if (okCode && FLASH[okCode]) return { kind: FLASH[okCode][0], message: FLASH[okCode][1] };
  if (errCode && FLASH[errCode]) return { kind: FLASH[errCode][0], message: FLASH[errCode][1] };
  if (errCode) return { kind: 'error', message: String(errCode).slice(0, 200) };
  return null;
}

function shell(req, title, active, body, flashOverride) {
  return layout({
    title,
    user: req.user,
    nav: navFor(req.permissions, req.user.role.key),
    active,
    body,
    csrfToken: req.session.csrfToken,
    flash: flashOverride || flash(req),
  });
}

function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
}
function errCode(e) {
  return e && e.code && FLASH[e.code] ? e.code : 'validation';
}

/* ------------------------------------------------------------ staff list */
router.get('/admin/staff', requirePermission('staff:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const roleId = String(req.query.role || '');
  const { total, rows } = await people.listStaff({ q, status, roleId, skip: (page - 1) * size, take: size });
  const roles = await people.listRoles();

  const roleOptions = roles
    .map((r) => `<option value="${esc(r.id)}"${r.id === roleId ? ' selected' : ''}>${esc(r.name)}</option>`)
    .join('');

  const body = rows.length
    ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr>
            <td><a href="/admin/staff/${esc(u.id)}">${esc(u.name)}</a></td>
            <td>${esc(u.email)}</td>
            <td>${esc(u.role.name)}</td>
            <td><span class="badge ${u.status === 'active' ? 'badge-ok' : 'badge-off'}">${esc(u.status)}</span></td>
            <td>${esc(fmtDate(u.lastLoginAt))}</td>
            <td><a class="pg" href="/admin/staff/${esc(u.id)}">Manage</a></td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
    : `<p class="empty">No staff match these filters.</p>`;

  const pages = Math.max(1, Math.ceil(total / size));
  const pageLink = (p) =>
    `/admin/staff?page=${p}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&role=${encodeURIComponent(roleId)}`;
  const pagerHtml = `<div class="pager">
    ${page > 1 ? `<a class="pg" href="${esc(pageLink(page - 1))}">← Prev</a>` : ''}
    <span class="pg-info">Page ${page} of ${pages} · ${total} total</span>
    ${page < pages ? `<a class="pg" href="${esc(pageLink(page + 1))}">Next →</a>` : ''}
  </div>`;

  const content = `
  <section class="panel">
    <div class="panel-head"><h2>Staff</h2>
      <span>
        <a class="btn btn-line" href="/admin/roles">Roles &amp; permissions</a>
        ${req.permissions.has('staff:write') || req.user.role.key === 'super_admin' ? '<a class="btn btn-gold" href="/admin/staff/new">Add staff</a>' : ''}
      </span>
    </div>
    <form class="filters" method="get" action="/admin/staff">
      <input type="search" name="q" placeholder="Search name or email" value="${esc(q)}">
      <select name="role"><option value="">All roles</option>${roleOptions}</select>
      <select name="status">
        <option value="">Any status</option>
        <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
        <option value="disabled"${status === 'disabled' ? ' selected' : ''}>Disabled</option>
      </select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${body}
    ${pagerHtml}
  </section>`;
  res.send(shell(req, 'Staff & Roles', 'staff', content));
});

/* ---------------------------------------------------------- create staff */
async function rolesSelect(selectedId) {
  const roles = await people.listRoles();
  return roles.map((r) => `<option value="${esc(r.id)}"${r.id === selectedId ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
}

function staffForm({ action, user, rolesHtml, isNew, csrfToken }) {
  return `
  <form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken || '')}">
    <label class="field"><span>Full name</span><input name="name" required value="${esc(user.name || '')}"></label>
    <label class="field"><span>Email address</span><input type="email" name="email" required value="${esc(user.email || '')}"></label>
    <label class="field"><span>Role</span><select name="roleId" required>${rolesHtml}</select></label>
    <label class="field"><span>Status</span><select name="status">
      <option value="active"${user.status !== 'disabled' ? ' selected' : ''}>Active</option>
      <option value="disabled"${user.status === 'disabled' ? ' selected' : ''}>Disabled</option>
    </select></label>
    ${isNew ? `<label class="field"><span>Temporary password</span><input type="password" name="password" required minlength="10" autocomplete="new-password"><em class="hint">Min 10 chars, upper &amp; lower case, a number. The user must change it on first sign-in.</em></label>` : ''}
    <div class="form-actions"><button class="btn btn-gold" type="submit">${isNew ? 'Create staff member' : 'Save changes'}</button></div>
  </form>`;
}

router.get('/admin/staff/new', requirePermission('staff:write'), async (req, res) => {
  const rolesHtml = await rolesSelect('');
  const body = `<section class="panel"><div class="panel-head"><h2>Add staff</h2>
    <a class="pg" href="/admin/staff">← Back to staff</a></div>${staffForm({ action: '/admin/staff', user: {}, rolesHtml, isNew: true, csrfToken: req.session.csrfToken })}</section>`;
  res.send(shell(req, 'Add staff', 'staff', body));
});

router.post('/admin/staff', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  const rolesHtml = await rolesSelect(req.body.roleId);
  try {
    const { user } = await people.createStaff(req.body, req.user, req);
    await audit.log({ action: 'staff.create', entity: 'User', entityId: user.id, userId: req.user.id, actorEmail: req.user.email, meta: { email: user.email, role: user.role.key }, req });
    return res.redirect('/admin/staff?ok=created');
  } catch (e) {
    const body = `<section class="panel"><div class="panel-head"><h2>Add staff</h2>
      <a class="pg" href="/admin/staff">← Back to staff</a></div>${staffForm({ action: '/admin/staff', user: req.body, rolesHtml, isNew: true, csrfToken: req.session.csrfToken })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add staff', 'staff', body, { kind: 'error', message: e.message }));
  }
});

/* ----------------------------------------------------------- staff detail */
router.get('/admin/staff/:id', requirePermission('staff:read'), async (req, res) => {
  const user = await people.getStaff(req.params.id);
  if (!user) return res.status(404).send(shell(req, 'Not found', 'staff', '<section class="panel"><p class="empty">Staff member not found.</p></section>'));
  const canWrite = req.permissions.has('staff:write') || req.user.role.key === 'super_admin';
  const rolesHtml = await rolesSelect(user.roleId);

  const edit = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Profile</h2><a class="pg" href="/admin/staff">← Back to staff</a></div>${staffForm({ action: `/admin/staff/${esc(user.id)}`, user, rolesHtml, isNew: false, csrfToken: req.session.csrfToken })}</section>`
    : `<section class="panel"><p class="muted">You have read-only access to staff.</p></section>`;

  const passwordPanel = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Reset password</h2></div>
        <form method="post" action="/admin/staff/${esc(user.id)}/password" class="form-grid" novalidate>
          <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
          <label class="field"><span>New password</span><input type="password" name="password" required minlength="10" autocomplete="new-password"><em class="hint">Min 10 chars, upper &amp; lower case, a number.</em></label>
          <div class="form-actions"><button class="btn btn-line" type="submit">Reset password</button></div>
        </form></section>`
    : '';

  const dangerPanel = canWrite
    ? `<section class="panel"><div class="panel-head"><h2>Access &amp; danger zone</h2></div>
        <div class="danger-row">
          <form method="post" action="/admin/staff/${esc(user.id)}/status">
            <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
            <input type="hidden" name="status" value="${user.status === 'active' ? 'disabled' : 'active'}">
            <button class="btn btn-line" type="submit">${user.status === 'active' ? 'Disable account' : 'Enable account'}</button>
          </form>
          <form method="post" action="/admin/staff/${esc(user.id)}/delete" data-confirm="Delete this staff member?">
            <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
            <button class="btn btn-danger" type="submit">Delete account</button>
          </form>
        </div></section>`
    : '';

  const body = `
    <section class="panel"><div class="panel-head"><h2>${esc(user.name)}</h2>
      <span class="badge ${user.status === 'active' ? 'badge-ok' : 'badge-off'}">${esc(user.status)}</span></div>
      <p class="muted">${esc(user.email)} · ${esc(user.role.name)} · Last login ${esc(fmtDate(user.lastLoginAt))}</p>
    </section>
    ${edit}${passwordPanel}${dangerPanel}`;
  res.send(shell(req, 'Staff member', 'staff', body));
});

router.post('/admin/staff/:id', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await people.updateStaff(req.params.id, req.body, req.user, req);
    await audit.log({ action: 'staff.update', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/staff/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/staff/${req.params.id}?err=${encodeURIComponent(errCode(e))}`);
  }
});

router.post('/admin/staff/:id/password', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await people.setStaffPassword(req.params.id, req.body, req.user, req);
    await audit.log({ action: 'staff.password_reset', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/staff/${req.params.id}?ok=password`);
  } catch (e) {
    return res.redirect(`/admin/staff/${req.params.id}?err=${encodeURIComponent(errCode(e))}`);
  }
});

router.post('/admin/staff/:id/status', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await people.setStaffStatus(req.params.id, req.body.status, req.user, req);
    await audit.log({ action: 'staff.status', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { status: req.body.status }, req });
    return res.redirect(`/admin/staff/${req.params.id}?ok=status`);
  } catch (e) {
    return res.redirect(`/admin/staff/${req.params.id}?err=${encodeURIComponent(errCode(e))}`);
  }
});

router.post('/admin/staff/:id/delete', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await people.deleteStaff(req.params.id, req.user, req);
    await audit.log({ action: 'staff.delete', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/staff?ok=deleted');
  } catch (e) {
    return res.redirect(`/admin/staff/${req.params.id}?err=${encodeURIComponent(errCode(e))}`);
  }
});

/* ---------------------------------------------------------------- roles */
function permissionMatrix(role, permissions, csrfToken) {
  const editable = role.key !== 'super_admin';
  const groups = {};
  permissions.forEach((p) => {
    (groups[p.group] = groups[p.group] || []).push(p);
  });
  const cells = Object.entries(groups)
    .map(
      ([group, perms]) => `<fieldset class="perm-group"><legend>${esc(group)}</legend>${perms
        .map((p) => {
          const checked = role.permissions.includes(p.key) || role.key === 'super_admin';
          return `<label class="perm"><input type="checkbox" name="permissions" value="${esc(p.key)}"${checked ? ' checked' : ''}${editable ? '' : ' disabled'}><span>${esc(p.label)} <code>${esc(p.key)}</code></span></label>`;
        })
        .join('')}</fieldset>`
    )
    .join('');
  return `<form method="post" action="/admin/roles/${esc(role.id)}" class="role-form">
    <input type="hidden" name="_csrf" value="${esc(csrfToken || '')}">
    ${editable ? `<div class="form-grid2">
      <label class="field"><span>Name</span><input name="name" value="${esc(role.name)}"></label>
      <label class="field"><span>Description</span><input name="description" value="${esc(role.description || '')}"></label>
    </div>` : ''}
    <div class="perm-matrix">${cells}</div>
    ${editable ? `<div class="form-actions"><button class="btn btn-gold" type="submit">Save permissions</button></div>` : `<p class="note">Super Admin always holds every permission and cannot be edited.</p>`}
  </form>`;
}

router.get('/admin/roles', requirePermission('staff:read'), async (req, res) => {
  const [roles, permissions] = [await people.listRoles(), people.listPermissions()];
  const cards = roles
    .map(
      (r) => `<section class="panel">
      <div class="panel-head"><h2>${esc(r.name)}</h2>
        <span class="muted">${r.userCount} user${r.userCount === 1 ? '' : 's'}${r.isSystem ? ' · system role' : ''}</span></div>
      <p class="muted">${esc(r.description || '')}</p>
      ${permissionMatrix(r, permissions, req.session.csrfToken)}</section>`
    )
    .join('');
  const newRole = `<section class="panel"><div class="panel-head"><h2>Create a role</h2></div>
    <form method="post" action="/admin/roles" class="form-grid">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <label class="field"><span>Name</span><input name="name" required placeholder="e.g. Front Desk"></label>
      <label class="field"><span>Key (optional)</span><input name="key" placeholder="front_desk"></label>
      <label class="field"><span>Description</span><input name="description"></label>
      <p class="note">Tick permissions on an existing role to grant them, or create the role here then edit it.</p>
      <div class="form-actions"><button class="btn btn-line" type="submit">Create role</button></div>
    </form></section>`;
  res.send(shell(req, 'Roles & Permissions', 'staff', newRole + cards));
});

router.post('/admin/roles', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const role = await people.createRole(req.body, req.user, req);
    await audit.log({ action: 'role.create', entity: 'Role', entityId: role.id, userId: req.user.id, actorEmail: req.user.email, meta: { key: role.key }, req });
    return res.redirect('/admin/roles?ok=role_created');
  } catch (e) {
    return res.redirect(`/admin/roles?err=${encodeURIComponent(errCode(e))}`);
  }
});

router.post('/admin/roles/:id', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  const permissions = [].concat(req.body.permissions || []);
  try {
    await people.saveRole(req.params.id, { name: req.body.name, description: req.body.description, permissions }, req.user, req);
    await audit.log({ action: 'role.update', entity: 'Role', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { permissions }, req });
    return res.redirect('/admin/roles?ok=role_saved');
  } catch (e) {
    return res.redirect(`/admin/roles?err=${encodeURIComponent(errCode(e))}`);
  }
});

/* ------------------------------------------------------------- JSON API */
router.get('/api/admin/staff', requirePermission('staff:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 20);
  const { total, rows } = await people.listStaff({
    q: String(req.query.q || ''),
    status: String(req.query.status || ''),
    roleId: String(req.query.role || ''),
    skip: (page - 1) * size,
    take: size,
  });
  return ok(
    res,
    rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role.key, status: u.status, lastLoginAt: u.lastLoginAt })),
    { page, pageSize: size, total }
  );
});

router.post('/api/admin/staff', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  const { user } = await people.createStaff(req.body, req.user, req);
  await audit.log({ action: 'staff.create', entity: 'User', entityId: user.id, userId: req.user.id, actorEmail: req.user.email, meta: { email: user.email }, req });
  return res.status(201).json({ ok: true, data: { id: user.id, name: user.name, email: user.email, role: user.role.key, status: user.status } });
});

router.patch('/api/admin/staff/:id', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  await people.updateStaff(req.params.id, req.body, req.user, req);
  await audit.log({ action: 'staff.update', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});

router.post('/api/admin/staff/:id/status', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  await people.setStaffStatus(req.params.id, req.body.status, req.user, req);
  await audit.log({ action: 'staff.status', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { status: req.body.status }, req });
  return ok(res, { id: req.params.id, status: req.body.status });
});

router.delete('/api/admin/staff/:id', requirePermission('staff:write'), csrf.requireCsrf, async (req, res) => {
  await people.deleteStaff(req.params.id, req.user, req);
  await audit.log({ action: 'staff.delete', entity: 'User', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

router.get('/api/admin/roles', requirePermission('staff:read'), async (req, res) => ok(res, await people.listRoles()));
router.get('/api/admin/permissions', requirePermission('staff:read'), (req, res) => ok(res, people.listPermissions()));

module.exports = router;
