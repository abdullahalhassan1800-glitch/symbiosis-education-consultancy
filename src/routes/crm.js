'use strict';
/* CRM routes: Student Leads (+ activity timeline), Appointments (+ weekly
   availability), and Contact Enquiries. HTML pages + JSON API. */
const express = require('express');
const crm = require('../lib/crm');
const audit = require('../lib/audit');
const csrf = require('../lib/csrf');
const { ok, wrapRouter } = require('../lib/http');
const { requirePermission } = require('../middleware/auth');
const { shell, errCode } = require('../lib/adminPage');
const { field, textarea, select, checkbox, pager, fmtDateTime } = require('../lib/forms');
const { esc } = require('../lib/render');

const router = wrapRouter(express.Router());

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function opts(list, labels) {
  return list.map((v) => ({ value: v, label: labels ? labels[v] || v : v.replace(/_/g, ' ') }));
}
function userOpts(users, includeUnassigned) {
  const base = includeUnassigned ? [{ value: '', label: 'Unassigned' }] : [{ value: '', label: '— none —' }];
  return base.concat(users.map((u) => ({ value: u.id, label: u.name + ' · ' + u.email })));
}
function dtLocal(d) {
  return d ? new Date(d).toISOString().slice(0, 16) : '';
}
function badge(status) {
  const good = ['published', 'confirmed', 'converted', 'resolved', 'completed', 'qualified'];
  const bad = ['cancelled', 'not_interested', 'closed', 'spam', 'no_show', 'archived'];
  const cls = good.includes(status) ? 'ok' : bad.includes(status) ? 'off' : 'gold';
  return `<span class="badge badge-${cls}">${esc(String(status).replace(/_/g, ' '))}</span>`;
}

/* ============================== LEADS ============================== */
router.get('/admin/leads', requirePermission('leads:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const source = String(req.query.source || '');
  const assignedToId = String(req.query.assigned || '');
  const [{ total, rows }, users] = await Promise.all([
    crm.listLeads({ q, status, source, assignedToId, skip: (page - 1) * size, take: size }),
    crm.userOptions(),
  ]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('leads:write');
  const assignFilter = [{ value: 'unassigned', label: 'Unassigned' }].concat(users.map((u) => ({ value: u.id, label: u.name })));
  const assignSel = `<option value="">Anyone</option>${assignFilter.map((o) => `<option value="${esc(o.value)}"${o.value === assignedToId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}`;

  const body = `<section class="panel">
    <div class="panel-head"><h2>Student leads</h2>${canWrite ? '<a class="btn btn-gold" href="/admin/leads/new">Add lead</a>' : ''}</div>
    <form class="filters" method="get" action="/admin/leads">
      <input type="search" name="q" placeholder="Search name, phone, reference" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${opts(crm.LEAD_STATUS).map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <select name="source"><option value="">Any source</option>${opts(crm.LEAD_SOURCE).map((o) => `<option value="${o.value}"${source === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <select name="assigned">${assignSel}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Student</th><th>Phone</th><th>Interest</th><th>Status</th><th>Assigned</th><th>Created</th></tr></thead><tbody>${rows
          .map(
            (l) => `<tr><td><a href="/admin/leads/${esc(l.id)}"><code>${esc(l.reference)}</code></a></td><td><a href="/admin/leads/${esc(l.id)}">${esc(l.studentName)}</a></td><td>${esc(l.phone)}</td><td>${esc(l.courseInterest || l.countryInterest || '—')}</td><td>${badge(l.status)}</td><td>${esc(l.assignedTo ? l.assignedTo.name : '—')}</td><td>${esc(fmtDateTime(l.createdAt))}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No leads match these filters.</p>'}
    ${pager('/admin/leads', page, total, size)}
  </section>`;
  res.send(shell(req, 'Student Leads', 'leads', body));
});

function leadForm(lead, { action, csrfToken, users, canAssign }) {
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Student name', name: 'studentName', value: lead.studentName, required: true })}
      ${field({ label: 'Phone', name: 'phone', value: lead.phone, required: true })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'WhatsApp', name: 'whatsapp', value: lead.whatsapp })}
      ${field({ label: 'Email', name: 'email', value: lead.email, type: 'email' })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'City', name: 'city', value: lead.city })}
      ${field({ label: 'Qualification', name: 'qualification', value: lead.qualification })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Course interest', name: 'courseInterest', value: lead.courseInterest })}
      ${field({ label: 'Country interest', name: 'countryInterest', value: lead.countryInterest })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'NEET score', name: 'neetScore', value: lead.neetScore })}
      ${select({ label: 'Source', name: 'source', value: lead.source || 'other', options: opts(crm.LEAD_SOURCE) })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Status', name: 'status', value: lead.status || 'new', options: opts(crm.LEAD_STATUS) })}
      ${canAssign ? select({ label: 'Assigned to', name: 'assignedToId', value: lead.assignedToId || '', options: userOpts(users, true) }) : ''}
    </div>
    ${checkbox({ label: 'Consent to contact', name: 'consentStatus', checked: !!lead.consentStatus })}
    ${textarea({ label: 'Notes', name: 'notes', value: lead.notes, rows: 3 })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save lead</button></div>
  </form>`;
}

router.get('/admin/leads/new', requirePermission('leads:write'), async (req, res) => {
  const users = await crm.userOptions();
  const canAssign = req.user.role.key === 'super_admin' || req.permissions.has('leads:assign');
  const body = `<section class="panel"><div class="panel-head"><h2>Add lead</h2><a class="pg" href="/admin/leads">← Back</a></div>${leadForm({ source: 'other', status: 'new' }, { action: '/admin/leads', csrfToken: req.session.csrfToken, users, canAssign })}</section>`;
  res.send(shell(req, 'Add lead', 'leads', body));
});

router.post('/admin/leads', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const l = await crm.createLead(req.body, req.user);
    await audit.log({ action: 'lead.create', entity: 'Lead', entityId: l.id, userId: req.user.id, actorEmail: req.user.email, meta: { reference: l.reference }, req });
    return res.redirect(`/admin/leads/${l.id}?ok=created`);
  } catch (e) {
    const users = await crm.userOptions();
    const canAssign = req.user.role.key === 'super_admin' || req.permissions.has('leads:assign');
    const body = `<section class="panel"><div class="panel-head"><h2>Add lead</h2><a class="pg" href="/admin/leads">← Back</a></div>${leadForm(req.body, { action: '/admin/leads', csrfToken: req.session.csrfToken, users, canAssign })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add lead', 'leads', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/leads/:id', requirePermission('leads:read'), async (req, res) => {
  const lead = await crm.getLead(req.params.id);
  const users = await crm.userOptions();
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('leads:write');
  const canAssign = req.user.role.key === 'super_admin' || req.permissions.has('leads:assign');
  if (!lead) return res.status(404).send(shell(req, 'Not found', 'leads', '<section class="panel"><p class="empty">Lead not found.</p></section>'));
  const csrfToken = req.session.csrfToken;

  const timeline = lead.followUps.length
    ? `<ul class="activity">${lead.followUps
        .map((n) => `<li><span class="dot"></span><div><b>${esc(n.kind)}</b><span>${esc(n.body)}</span><span>${esc(fmtDateTime(n.createdAt))}</span></div></li>`)
        .join('')}</ul>`
    : '<p class="empty">No activity yet.</p>';

  const body = `<section class="panel"><div class="panel-head"><h2>${esc(lead.studentName)}</h2><span><a class="btn btn-line" href="/admin/appointments/new?lead=${esc(lead.id)}">Book appointment</a> <a class="pg" href="/admin/leads">← Back</a></span></div>
      <p class="muted"><code>${esc(lead.reference)}</code> · ${esc(lead.phone)} · ${esc(lead.email || '—')} · Source: ${esc(lead.source || '—')} · Assigned: ${esc(lead.assignedTo ? lead.assignedTo.name : '—')}</p>
      ${canWrite ? leadForm(lead, { action: `/admin/leads/${esc(lead.id)}`, csrfToken, users, canAssign }) : '<p class="muted">Read-only.</p>'}
    </section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Log activity</h2></div>
      <form method="post" action="/admin/leads/${esc(lead.id)}/notes" class="form-grid" novalidate>
        <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
        <div class="form-grid2">
          ${select({ label: 'Type', name: 'kind', value: 'note', options: opts(['note', 'call', 'followup']) })}
          <div></div>
        </div>
        ${textarea({ label: 'What happened?', name: 'body', rows: 3, required: true })}
        <div class="form-actions"><button class="btn btn-line" type="submit">Add to timeline</button></div>
      </form></section>` : ''}
    ${canAssign ? `<section class="panel"><div class="panel-head"><h2>Assignment</h2></div>
      <form method="post" action="/admin/leads/${esc(lead.id)}/assign" class="filters">
        <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
        <select name="assignedToId">${userOpts(users, true).map((o) => `<option value="${esc(o.value)}"${o.value === (lead.assignedToId || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
        <button class="btn btn-line" type="submit">Assign</button>
      </form></section>` : ''}
    <section class="panel"><div class="panel-head"><h2>Activity timeline</h2></div>${timeline}</section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Danger zone</h2></div>
      <form method="post" action="/admin/leads/${esc(lead.id)}/delete" data-confirm="Delete this lead?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete lead</button></form></section>` : ''}`;
  res.send(shell(req, lead.studentName, 'leads', body));
});

router.post('/admin/leads/:id', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const canAssign = req.user.role.key === 'super_admin' || req.permissions.has('leads:assign');
    await crm.updateLead(req.params.id, req.body, req.user, { canAssign });
    await audit.log({ action: 'lead.update', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/leads/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/leads/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/leads/:id/notes', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.addLeadNote(req.params.id, req.body, req.user);
    await audit.log({ action: 'lead.note', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/leads/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/leads/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/leads/:id/status', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.setLeadStatus(req.params.id, req.body.status, req.user);
    await audit.log({ action: 'lead.status', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { status: req.body.status }, req });
    return res.redirect(`/admin/leads/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/leads/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/leads/:id/assign', requirePermission('leads:assign'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.assignLead(req.params.id, req.body.assignedToId, req.user);
    await audit.log({ action: 'lead.assign', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/leads/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/leads/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/leads/:id/delete', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  await crm.deleteLead(req.params.id);
  await audit.log({ action: 'lead.delete', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/leads?ok=deleted');
});

/* ========================== APPOINTMENTS ========================== */
router.get('/admin/appointments', requirePermission('appointments:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const status = String(req.query.status || '');
  const assignedToId = String(req.query.assigned || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const [{ total, rows }, users, slots] = await Promise.all([
    crm.listAppointments({ status, assignedToId, from, to, skip: (page - 1) * size, take: size }),
    crm.userOptions(),
    crm.listSlots(),
  ]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('appointments:write');
  const assignFilter = [{ value: 'unassigned', label: 'Unassigned' }].concat(users.map((u) => ({ value: u.id, label: u.name })));

  const slotRows = slots.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Day</th><th>From</th><th>To</th><th>Active</th><th></th></tr></thead><tbody>${slots
        .map(
          (s) => `<tr><td>${WEEKDAYS[s.weekday]}</td><td>${esc(s.startTime)}</td><td>${esc(s.endTime)}</td><td>${s.active ? 'Yes' : 'No'}</td><td>${
            canWrite ? `<form method="post" action="/admin/availability/${esc(s.id)}/toggle" style="display:inline"><input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}"><button class="pg" type="submit">${s.active ? 'Disable' : 'Enable'}</button></form>
            <form method="post" action="/admin/availability/${esc(s.id)}/delete" style="display:inline" data-confirm="Delete this slot?"><input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}"><button class="pg" type="submit">Delete</button></form>` : ''
          }</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : '<p class="empty">No availability slots.</p>';

  const body = `<section class="panel">
    <div class="panel-head"><h2>Appointments</h2>${canWrite ? '<a class="btn btn-gold" href="/admin/appointments/new">Add appointment</a>' : ''}</div>
    <form class="filters" method="get" action="/admin/appointments">
      <select name="status"><option value="">Any status</option>${opts(crm.APPT_STATUS).map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <select name="assigned"><option value="">Anyone</option>${assignFilter.map((o) => `<option value="${esc(o.value)}"${o.value === assignedToId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <input type="date" name="from" value="${esc(from)}">
      <input type="date" name="to" value="${esc(to)}">
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Student</th><th>When (UTC)</th><th>Type</th><th>Status</th><th>Assigned</th></tr></thead><tbody>${rows
          .map(
            (a) => `<tr><td><a href="/admin/appointments/${esc(a.id)}"><code>${esc(a.reference)}</code></a></td><td><a href="/admin/appointments/${esc(a.id)}">${esc(a.studentName)}</a></td><td>${esc(fmtDateTime(a.scheduledAt))}</td><td>${esc(a.meetingType)}</td><td>${badge(a.status)}</td><td>${esc(a.assignedTo ? a.assignedTo.name : '—')}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No appointments match these filters.</p>'}
    ${pager('/admin/appointments', page, total, size)}
  </section>
  <section class="panel"><div class="panel-head"><h2>Weekly availability</h2></div>
    ${slotRows}
    ${canWrite ? `<form method="post" action="/admin/availability" class="filters">
      <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken)}">
      <select name="weekday">${WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
      <input type="time" name="startTime" value="10:00" required>
      <input type="time" name="endTime" value="10:30" required>
      <button class="btn btn-line" type="submit">Add slot</button>
    </form>` : ''}
  </section>`;
  res.send(shell(req, 'Appointments', 'appointments', body));
});

function apptForm(appt, { action, csrfToken, users, leads }) {
  const leadOpts = [{ value: '', label: '— none —' }].concat(leads.map((l) => ({ value: l.id, label: l.studentName + ' · ' + l.phone })));
  return `<form method="post" action="${esc(action)}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
    <div class="form-grid2">
      ${field({ label: 'Student name', name: 'studentName', value: appt.studentName, required: true })}
      ${field({ label: 'Contact number', name: 'contactNumber', value: appt.contactNumber, required: true })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Email', name: 'email', value: appt.email, type: 'email' })}
      ${field({ label: 'Course interest', name: 'courseInterest', value: appt.courseInterest })}
    </div>
    <div class="form-grid2">
      ${field({ label: 'Date & time (local)', name: 'scheduledAt', value: dtLocal(appt.scheduledAt), type: 'datetime-local', required: true })}
      ${field({ label: 'Timezone', name: 'timezone', value: appt.timezone || 'Asia/Kolkata' })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Meeting type', name: 'meetingType', value: appt.meetingType || 'call', options: opts(crm.MEETING_TYPE) })}
      ${select({ label: 'Status', name: 'status', value: appt.status || 'pending', options: opts(crm.APPT_STATUS) })}
    </div>
    <div class="form-grid2">
      ${select({ label: 'Assigned to', name: 'assignedToId', value: appt.assignedToId || '', options: userOpts(users, true) })}
      ${select({ label: 'Linked lead', name: 'leadId', value: appt.leadId || '', options: leadOpts })}
    </div>
    ${textarea({ label: 'Notes', name: 'notes', value: appt.notes, rows: 3 })}
    <div class="form-actions"><button class="btn btn-gold" type="submit">Save appointment</button></div>
  </form>`;
}

router.get('/admin/appointments/new', requirePermission('appointments:write'), async (req, res) => {
  const [users, leads] = await Promise.all([crm.userOptions(), crm.leadsForPicker()]);
  const preset = {};
  if (req.query.lead) {
    const lead = await crm.getLead(req.query.lead);
    if (lead) Object.assign(preset, { studentName: lead.studentName, contactNumber: lead.phone, email: lead.email, courseInterest: lead.courseInterest, leadId: lead.id });
  }
  const body = `<section class="panel"><div class="panel-head"><h2>Add appointment</h2><a class="pg" href="/admin/appointments">← Back</a></div>${apptForm(preset, { action: '/admin/appointments', csrfToken: req.session.csrfToken, users, leads })}</section>`;
  res.send(shell(req, 'Add appointment', 'appointments', body));
});

router.post('/admin/appointments', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const a = await crm.createAppointment(req.body, req.user);
    await audit.log({ action: 'appointment.create', entity: 'Appointment', entityId: a.id, userId: req.user.id, actorEmail: req.user.email, meta: { reference: a.reference }, req });
    return res.redirect(`/admin/appointments/${a.id}?ok=created`);
  } catch (e) {
    const [users, leads] = await Promise.all([crm.userOptions(), crm.leadsForPicker()]);
    const body = `<section class="panel"><div class="panel-head"><h2>Add appointment</h2><a class="pg" href="/admin/appointments">← Back</a></div>${apptForm(req.body, { action: '/admin/appointments', csrfToken: req.session.csrfToken, users, leads })}</section>`;
    return res.status(e.status || 400).send(shell(req, 'Add appointment', 'appointments', body, { kind: 'error', message: e.message }));
  }
});

router.get('/admin/appointments/:id', requirePermission('appointments:read'), async (req, res) => {
  const appt = await crm.getAppointment(req.params.id);
  const [users, leads] = await Promise.all([crm.userOptions(), crm.leadsForPicker()]);
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('appointments:write');
  if (!appt) return res.status(404).send(shell(req, 'Not found', 'appointments', '<section class="panel"><p class="empty">Appointment not found.</p></section>'));
  const csrfToken = req.session.csrfToken;
  const quick = canWrite
    ? `<div class="danger-row">${['confirmed', 'completed', 'cancelled', 'no_show']
        .map((s) => `<form method="post" action="/admin/appointments/${esc(appt.id)}/status"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><input type="hidden" name="status" value="${s}"><button class="btn btn-line" type="submit">Mark ${s.replace('_', ' ')}</button></form>`)
        .join('')}</div>`
    : '';
  const body = `<section class="panel"><div class="panel-head"><h2>${esc(appt.studentName)}</h2><a class="pg" href="/admin/appointments">← Back</a></div>
      <p class="muted"><code>${esc(appt.reference)}</code> · ${esc(fmtDateTime(appt.scheduledAt))} · ${badge(appt.status)}${appt.lead ? ` · Lead: <a href="/admin/leads/${esc(appt.lead.id)}">${esc(appt.lead.studentName)}</a>` : ''}</p>
      ${canWrite ? apptForm(appt, { action: `/admin/appointments/${esc(appt.id)}`, csrfToken, users, leads }) : '<p class="muted">Read-only.</p>'}
    </section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Quick status</h2></div>${quick}</section>
    <section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><form method="post" action="/admin/appointments/${esc(appt.id)}/delete" data-confirm="Delete this appointment?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete appointment</button></form></section>` : ''}`;
  res.send(shell(req, appt.studentName, 'appointments', body));
});

router.post('/admin/appointments/:id', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.updateAppointment(req.params.id, req.body, req.user);
    await audit.log({ action: 'appointment.update', entity: 'Appointment', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/appointments/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/appointments/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/appointments/:id/status', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.setAppointmentStatus(req.params.id, req.body.status, req.user);
    await audit.log({ action: 'appointment.status', entity: 'Appointment', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { status: req.body.status }, req });
    return res.redirect(`/admin/appointments/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/appointments/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});

router.post('/admin/appointments/:id/delete', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  await crm.deleteAppointment(req.params.id);
  await audit.log({ action: 'appointment.delete', entity: 'Appointment', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/appointments?ok=deleted');
});

/* ----------------------------------------------------------- availability */
router.post('/admin/availability', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  try {
    const s = await crm.addSlot(req.body);
    await audit.log({ action: 'availability.create', entity: 'AvailabilitySlot', entityId: s.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect('/admin/appointments?ok=created');
  } catch (e) {
    return res.redirect('/admin/appointments?err=' + encodeURIComponent(errCode(e)));
  }
});
router.post('/admin/availability/:id/toggle', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  await crm.toggleSlot(req.params.id);
  return res.redirect('/admin/appointments?ok=updated');
});
router.post('/admin/availability/:id/delete', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  await crm.deleteSlot(req.params.id);
  return res.redirect('/admin/appointments?ok=deleted');
});

/* =========================== ENQUIRIES =========================== */
router.get('/admin/enquiries', requirePermission('enquiries:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = 20;
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const { total, rows } = await crm.listEnquiries({ q, status, skip: (page - 1) * size, take: size });
  const body = `<section class="panel">
    <div class="panel-head"><h2>Contact enquiries</h2></div>
    <form class="filters" method="get" action="/admin/enquiries">
      <input type="search" name="q" placeholder="Search name, contact, subject" value="${esc(q)}">
      <select name="status"><option value="">Any status</option>${opts(crm.ENQ_STATUS).map((o) => `<option value="${o.value}"${status === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <button class="btn btn-line" type="submit">Filter</button>
    </form>
    ${rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Subject</th><th>Status</th><th>Assigned</th><th>Received</th></tr></thead><tbody>${rows
          .map(
            (e) => `<tr><td><a href="/admin/enquiries/${esc(e.id)}">${esc(e.name)}</a></td><td>${esc(e.contact)}</td><td>${esc(e.subject || '—')}</td><td>${badge(e.status)}</td><td>${esc(e.assignedTo ? e.assignedTo.name : '—')}</td><td>${esc(fmtDateTime(e.createdAt))}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="empty">No enquiries yet.</p>'}
    ${pager('/admin/enquiries', page, total, size)}
  </section>`;
  res.send(shell(req, 'Contact Enquiries', 'enquiries', body));
});

router.get('/admin/enquiries/:id', requirePermission('enquiries:read'), async (req, res) => {
  const enq = await crm.getEnquiry(req.params.id);
  const users = await crm.userOptions();
  const canWrite = req.user.role.key === 'super_admin' || req.permissions.has('enquiries:write');
  if (!enq) return res.status(404).send(shell(req, 'Not found', 'enquiries', '<section class="panel"><p class="empty">Enquiry not found.</p></section>'));
  const csrfToken = req.session.csrfToken;
  const body = `<section class="panel"><div class="panel-head"><h2>${esc(enq.name)}</h2><a class="pg" href="/admin/enquiries">← Back</a></div>
      <p class="muted">${esc(enq.contact)} · ${esc(enq.email || '—')} · ${esc(fmtDateTime(enq.createdAt))}${enq.sourcePage ? ` · from ${esc(enq.sourcePage)}` : ''}</p>
      <p><b>Subject:</b> ${esc(enq.subject || '—')}</p>
      <p class="quote">${esc(enq.message)}</p>
    </section>
    ${canWrite ? `<section class="panel"><div class="panel-head"><h2>Manage</h2></div>
      <form method="post" action="/admin/enquiries/${esc(enq.id)}" class="form-grid">
        <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
        <div class="form-grid2">
          ${select({ label: 'Status', name: 'status', value: enq.status, options: opts(crm.ENQ_STATUS) })}
          ${select({ label: 'Assigned to', name: 'assignedToId', value: enq.assignedToId || '', options: userOpts(users, true) })}
        </div>
        ${textarea({ label: 'Internal notes', name: 'notes', value: enq.notes, rows: 3 })}
        <div class="form-actions"><button class="btn btn-gold" type="submit">Save</button></div>
      </form></section>
    <section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><form method="post" action="/admin/enquiries/${esc(enq.id)}/delete" data-confirm="Delete this enquiry?"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn btn-danger" type="submit">Delete enquiry</button></form></section>` : ''}`;
  res.send(shell(req, enq.name, 'enquiries', body));
});

router.post('/admin/enquiries/:id', requirePermission('enquiries:write'), csrf.requireCsrf, async (req, res) => {
  try {
    await crm.updateEnquiry(req.params.id, req.body, req.user);
    await audit.log({ action: 'enquiry.update', entity: 'ContactEnquiry', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
    return res.redirect(`/admin/enquiries/${req.params.id}?ok=updated`);
  } catch (e) {
    return res.redirect(`/admin/enquiries/${req.params.id}?err=` + encodeURIComponent(errCode(e)));
  }
});
router.post('/admin/enquiries/:id/delete', requirePermission('enquiries:write'), csrf.requireCsrf, async (req, res) => {
  await crm.deleteEnquiry(req.params.id);
  await audit.log({ action: 'enquiry.delete', entity: 'ContactEnquiry', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.redirect('/admin/enquiries?ok=deleted');
});

/* ============================ JSON API ============================ */
router.get('/api/admin/leads', requirePermission('leads:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await crm.listLeads({ q: String(req.query.q || ''), status: String(req.query.status || ''), source: String(req.query.source || ''), assignedToId: String(req.query.assigned || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((l) => ({ id: l.id, reference: l.reference, studentName: l.studentName, phone: l.phone, status: l.status, source: l.source, assignedTo: l.assignedTo ? l.assignedTo.name : null, createdAt: l.createdAt })), { page, pageSize: size, total });
});
router.post('/api/admin/leads', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  const l = await crm.createLead(req.body, req.user);
  await audit.log({ action: 'lead.create', entity: 'Lead', entityId: l.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: l.id, reference: l.reference } });
});
router.get('/api/admin/leads/:id', requirePermission('leads:read'), async (req, res) => {
  const l = await crm.getLead(req.params.id);
  if (!l) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Lead not found.' } });
  return ok(res, { id: l.id, reference: l.reference, studentName: l.studentName, status: l.status, notes: l.followUps.map((n) => ({ kind: n.kind, body: n.body, at: n.createdAt })) });
});
router.patch('/api/admin/leads/:id', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  const canAssign = req.user.role.key === 'super_admin' || req.permissions.has('leads:assign');
  await crm.updateLead(req.params.id, req.body, req.user, { canAssign });
  await audit.log({ action: 'lead.update', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.post('/api/admin/leads/:id/status', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  await crm.setLeadStatus(req.params.id, req.body.status, req.user);
  await audit.log({ action: 'lead.status', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, meta: { status: req.body.status }, req });
  return ok(res, { id: req.params.id, status: req.body.status });
});
router.post('/api/admin/leads/:id/assign', requirePermission('leads:assign'), csrf.requireCsrf, async (req, res) => {
  await crm.assignLead(req.params.id, req.body.assignedToId, req.user);
  await audit.log({ action: 'lead.assign', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.delete('/api/admin/leads/:id', requirePermission('leads:write'), csrf.requireCsrf, async (req, res) => {
  await crm.deleteLead(req.params.id);
  await audit.log({ action: 'lead.delete', entity: 'Lead', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { deleted: true });
});

router.get('/api/admin/appointments', requirePermission('appointments:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await crm.listAppointments({ status: String(req.query.status || ''), assignedToId: String(req.query.assigned || ''), from: String(req.query.from || ''), to: String(req.query.to || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((a) => ({ id: a.id, reference: a.reference, studentName: a.studentName, scheduledAt: a.scheduledAt, status: a.status, meetingType: a.meetingType })), { page, pageSize: size, total });
});
router.post('/api/admin/appointments', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  const a = await crm.createAppointment(req.body, req.user);
  await audit.log({ action: 'appointment.create', entity: 'Appointment', entityId: a.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: a.id, reference: a.reference } });
});
router.patch('/api/admin/appointments/:id', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  await crm.updateAppointment(req.params.id, req.body, req.user);
  await audit.log({ action: 'appointment.update', entity: 'Appointment', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});
router.post('/api/admin/appointments/:id/status', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  await crm.setAppointmentStatus(req.params.id, req.body.status, req.user);
  await audit.log({ action: 'appointment.status', entity: 'Appointment', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id, status: req.body.status });
});
router.get('/api/admin/availability', requirePermission('appointments:read'), async (req, res) => {
  const slots = await crm.listSlots();
  return ok(res, slots.map((s) => ({ id: s.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, active: s.active })));
});
router.post('/api/admin/availability', requirePermission('appointments:write'), csrf.requireCsrf, async (req, res) => {
  const s = await crm.addSlot(req.body);
  await audit.log({ action: 'availability.create', entity: 'AvailabilitySlot', entityId: s.id, userId: req.user.id, actorEmail: req.user.email, req });
  return res.status(201).json({ ok: true, data: { id: s.id } });
});

router.get('/api/admin/enquiries', requirePermission('enquiries:read'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, parseInt(req.query.pageSize, 10) || 50);
  const { total, rows } = await crm.listEnquiries({ q: String(req.query.q || ''), status: String(req.query.status || ''), skip: (page - 1) * size, take: size });
  return ok(res, rows.map((e) => ({ id: e.id, name: e.name, contact: e.contact, subject: e.subject, status: e.status, createdAt: e.createdAt })), { page, pageSize: size, total });
});
router.get('/api/admin/enquiries/:id', requirePermission('enquiries:read'), async (req, res) => {
  const e = await crm.getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Enquiry not found.' } });
  return ok(res, { id: e.id, name: e.name, message: e.message, status: e.status });
});
router.patch('/api/admin/enquiries/:id', requirePermission('enquiries:write'), csrf.requireCsrf, async (req, res) => {
  await crm.updateEnquiry(req.params.id, req.body, req.user);
  await audit.log({ action: 'enquiry.update', entity: 'ContactEnquiry', entityId: req.params.id, userId: req.user.id, actorEmail: req.user.email, req });
  return ok(res, { id: req.params.id });
});

module.exports = router;
