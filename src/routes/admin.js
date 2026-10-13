'use strict';
const express = require('express');
const prisma = require('../db');
const { layout, esc, icon } = require('../lib/render');
const { ok, wrapRouter } = require('../lib/http');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = wrapRouter(express.Router());

/* Full navigation (19 modules). Items appear once the module is implemented AND
   the signed-in role holds the required permission. Entries flagged
   `ready: false` render an honest "not configured" state rather than mock CRUD. */
const NAV = [
  { section: 'Overview' },
  { key: 'dashboard', label: 'Dashboard', href: '/admin', icon: 'dashboard', perm: 'dashboard:view' },
  { section: 'Catalogue' },
  { key: 'courses', label: 'Courses', href: '/admin/courses', icon: 'courses', perm: 'courses:read', ready: true },
  { key: 'universities', label: 'Universities', href: '/admin/universities', icon: 'universities', perm: 'institutions:read', ready: true },
  { key: 'countries', label: 'Countries', href: '/admin/countries', icon: 'countries', perm: 'countries:read', ready: true },
  { key: 'fees', label: 'Fees & Eligibility', href: '/admin/fees-eligibility', icon: 'fees', perm: 'fees:read', ready: true },
  { key: 'overseas', label: 'Overseas MBBS', href: '/admin/overseas-mbbs', icon: 'overseas', perm: 'courses:read', ready: true },
  { section: 'CRM' },
  { key: 'leads', label: 'Student Leads', href: '/admin/leads', icon: 'leads', perm: 'leads:read', ready: true },
  { key: 'appointments', label: 'Appointments', href: '/admin/appointments', icon: 'appointments', perm: 'appointments:read', ready: true },
  { key: 'enquiries', label: 'Contact Enquiries', href: '/admin/enquiries', icon: 'enquiries', perm: 'enquiries:read', ready: true },
  { section: 'Website' },
  { key: 'content', label: 'Website Content', href: '/admin/content', icon: 'content', perm: 'content:read', ready: true },
  { key: 'faqs', label: 'FAQs', href: '/admin/faqs', icon: 'faqs', perm: 'faqs:read', ready: true },
  { key: 'testimonials', label: 'Testimonials', href: '/admin/testimonials', icon: 'testimonials', perm: 'content:read', ready: true },
  { key: 'media', label: 'Media Library', href: '/admin/media', icon: 'media', perm: 'media:read', ready: true },
  { section: 'Administration' },
  { key: 'staff', label: 'Staff & Roles', href: '/admin/staff', icon: 'staff', perm: 'staff:read', ready: true },
  { key: 'reports', label: 'Reports & Analytics', href: '/admin/reports', icon: 'reports', perm: 'reports:view', ready: true },
  { key: 'audit', label: 'Audit Logs', href: '/admin/audit-logs', icon: 'audit', perm: 'audit:view', ready: true },
  { key: 'settings', label: 'System Settings', href: '/admin/settings', icon: 'settings', perm: 'settings:write', ready: true },
  { key: 'backup', label: 'Backup & Data', href: '/admin/backup', icon: 'backup', perm: 'settings:write', ready: true },
  { key: 'website-settings', label: 'Website Settings', href: '/admin/website-settings', icon: 'website', perm: 'settings:write', ready: true },
];

function navFor(permissions, roleKey) {
  const can = (p) => roleKey === 'super_admin' || (p && permissions.has(p));
  return NAV.filter((n) => n.section || (n.ready !== false && can(n.perm)));
}

function paginate(query, defaultSize = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(100, Math.max(5, parseInt(query.pageSize, 10) || defaultSize));
  return { page, size, skip: (page - 1) * size, take: size };
}

function pager(base, { page, size }, total) {
  const pages = Math.max(1, Math.ceil(total / size));
  const link = (p) => `${base}${base.includes('?') ? '&' : '?'}page=${p}`;
  const parts = [];
  if (page > 1) parts.push(`<a class="pg" href="${esc(link(page - 1))}">← Prev</a>`);
  parts.push(`<span class="pg-info">Page ${page} of ${pages} · ${total} total</span>`);
  if (page < pages) parts.push(`<a class="pg" href="${esc(link(page + 1))}">Next →</a>`);
  return `<div class="pager">${parts.join('')}</div>`;
}

function metricCard(label, value, hint, href) {
  const inner = `<span class="m-label">${esc(label)}</span><b class="m-value">${esc(value)}</b>${
    hint ? `<span class="m-hint">${esc(hint)}</span>` : ''
  }`;
  return href ? `<a class="metric" href="${esc(href)}">${inner}</a>` : `<div class="metric">${inner}</div>`;
}

/* ------------------------------------------------------------- chart helpers */
const STATUS_COLORS = {
  new: '#155eef', contacted: '#2563eb', qualified: '#6d4df0',
  counselling_scheduled: '#f59e0b', follow_up: '#f59e0b', converted: '#16a34a',
  not_interested: '#94a3b8', closed: '#64748b',
  pending: '#f59e0b', confirmed: '#155eef', rescheduled: '#6d4df0',
  cancelled: '#dc2626', completed: '#16a34a', no_show: '#94a3b8',
};
const statusColor = (s) => STATUS_COLORS[s] || '#94a3b8';
const titleCase = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function statCard({ label, value, hint, iconName, variant, href }) {
  const inner = `<span class="stat-ico${variant ? ' v-' + variant : ''}">${icon(iconName)}</span>
    <div class="stat-body"><span class="stat-label">${esc(label)}</span><b class="stat-value">${esc(value)}</b>${
      hint ? `<span class="stat-hint">${esc(hint)}</span>` : ''
    }</div>`;
  return href ? `<a class="stat" href="${esc(href)}">${inner}</a>` : `<div class="stat">${inner}</div>`;
}

/* Area chart of 7 daily buckets. Pure SVG, no external libraries. */
function areaChart(points) {
  const w = 640, h = 220, pl = 16, pr = 16, pt = 20, pb = 34;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const iw = w - pl - pr, ih = h - pt - pb;
  const X = (i) => (n <= 1 ? pl + iw / 2 : pl + (i * iw) / (n - 1));
  const Y = (v) => pt + ih - (v / max) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${X(n - 1).toFixed(1)} ${(pt + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(pt + ih).toFixed(1)} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = (pt + ih - f * ih).toFixed(1);
      return `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="#e8eff9" stroke-width="1"/>`;
    })
    .join('');
  const dots = points
    .map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="4" fill="#fff" stroke="#155eef" stroke-width="2.5"/>`)
    .join('');
  const labels = points
    .map((p, i) => `<text x="${X(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="11" fill="#64748b" font-family="Public Sans, sans-serif">${esc(p.label)}</text>`)
    .join('');
  return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Leads created over the last 7 days">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#155eef" stop-opacity=".26"/><stop offset="1" stop-color="#155eef" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#areaGrad)"/>
    <path d="${line}" fill="none" stroke="#155eef" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}</svg></div>`;
}

function donut(segments, label) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  if (!total) {
    return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 150 150" role="img" aria-label="${esc(label)}">
      <circle cx="75" cy="75" r="54" fill="none" stroke="#e8eff9" stroke-width="16"/>
      <text x="75" y="74" text-anchor="middle" font-size="24" font-weight="700" fill="#102a56" font-family="Public Sans, sans-serif">0</text>
      <text x="75" y="92" text-anchor="middle" font-size="11" fill="#64748b" font-family="Public Sans, sans-serif">total</text></svg>
      <p class="muted" style="margin:0">${esc(label)} — no records yet.</p></div>`;
  }
  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total) * c;
      const el = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 75 75)"/>`;
      acc += len;
      return el;
    })
    .join('');
  const legend = segments
    .map((s) => `<li><span class="k"><i style="background:${s.color}"></i>${esc(s.label)}</span><span class="v">${s.value}</span></li>`)
    .join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 150 150" role="img" aria-label="${esc(label)}">
    <circle cx="75" cy="75" r="54" fill="none" stroke="#e8eff9" stroke-width="16"/>${arcs}
    <text x="75" y="74" text-anchor="middle" font-size="24" font-weight="700" fill="#102a56" font-family="Public Sans, sans-serif">${total}</text>
    <text x="75" y="92" text-anchor="middle" font-size="11" fill="#64748b" font-family="Public Sans, sans-serif">total</text></svg>
    <ul class="donut-legend">${legend}</ul></div>`;
}

/* --------------------------------------------------------------- dashboard */
router.get('/admin', requirePermission('dashboard:view'), async (req, res) => {
  const since = new Date(Date.now() - 6 * 86400000);
  since.setHours(0, 0, 0, 0);

  const [
    publishedCourses,
    institutions,
    newLeads,
    pendingAppointments,
    confirmedAppointments,
    followUpLeads,
    convertedLeads,
    recent,
    recentLeads,
    leads7,
    leadGroups,
    apptGroups,
  ] = await Promise.all([
    prisma.course.count({ where: { status: 'published', deletedAt: null } }),
    prisma.institution.count(),
    prisma.lead.count({ where: { status: 'new', deletedAt: null } }),
    prisma.appointment.count({ where: { status: 'pending' } }),
    prisma.appointment.count({ where: { status: 'confirmed' } }),
    prisma.lead.count({ where: { status: 'follow_up', deletedAt: null } }),
    prisma.lead.count({ where: { status: 'converted', deletedAt: null } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.lead.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, studentName: true, phone: true, courseInterest: true, status: true, createdAt: true } }),
    prisma.lead.findMany({ where: { deletedAt: null, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true }, where: { deletedAt: null } }),
    prisma.appointment.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  // 7-day daily buckets (local time).
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ start: d.getTime(), label: d.toLocaleDateString('en-US', { weekday: 'short' }), value: 0 });
  }
  leads7.forEach((l) => {
    const idx = Math.floor((l.createdAt.getTime() - days[0].start) / 86400000);
    if (idx >= 0 && idx < 7) days[idx].value++;
  });
  const weekTotal = days.reduce((s, d) => s + d.value, 0);

  const leadSegments = leadGroups
    .map((g) => ({ label: titleCase(g.status), value: g._count._all, color: statusColor(g.status) }))
    .sort((a, b) => b.value - a.value);
  const apptSegments = apptGroups
    .map((g) => ({ label: titleCase(g.status), value: g._count._all, color: statusColor(g.status) }))
    .sort((a, b) => b.value - a.value);

  const can = (p) => req.user.role.key === 'super_admin' || req.permissions.has(p);
  const quick = [
    can('leads:read') && ['/admin/leads', 'leads', 'Student leads'],
    can('appointments:read') && ['/admin/appointments', 'appointments', 'Appointments'],
    can('content:read') && ['/admin/content', 'content', 'Website content'],
    can('courses:read') && ['/admin/courses', 'courses', 'Courses'],
    can('reports:view') && ['/admin/reports', 'reports', 'Reports'],
  ].filter(Boolean);

  const recentLeadsTable = recentLeads.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Phone</th><th>Interest</th><th>Status</th><th>Created</th></tr></thead><tbody>${recentLeads
        .map(
          (l) => `<tr><td><a href="/admin/leads/${esc(l.id)}">${esc(l.studentName)}</a></td><td>${esc(l.phone)}</td><td>${esc(l.courseInterest || '—')}</td><td><span class="badge badge-info">${esc(titleCase(l.status))}</span></td><td>${esc(l.createdAt.toISOString().slice(0, 10))}</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : `<p class="empty">No student leads yet. Submissions from the website will appear here.</p>`;

  const activity = recent.length
    ? `<ul class="activity">${recent
        .map(
          (a) => `<li><span class="dot"></span><div><b>${esc(a.action)}</b><span>${esc(a.actorEmail || 'system')} · ${esc(a.createdAt.toISOString().slice(0, 16).replace('T', ' '))}</span></div></li>`
        )
        .join('')}</ul>`
    : `<p class="empty">No activity recorded yet.</p>`;

  const body = `
  <div class="dash">
    <section class="stats stats-4">
      ${statCard({ label: 'New leads', value: newLeads, hint: 'Awaiting first contact', iconName: 'leads', href: '/admin/leads?status=new' })}
      ${statCard({ label: 'Published courses', value: publishedCourses, hint: 'Live on the website', iconName: 'courses', variant: 'violet', href: '/admin/courses' })}
      ${statCard({ label: 'Pending appointments', value: pendingAppointments, hint: 'Awaiting confirmation', iconName: 'appointments', variant: 'amber', href: '/admin/appointments?status=pending' })}
      ${statCard({ label: 'Converted leads', value: convertedLeads, hint: 'Enrolled students', iconName: 'counsellor', variant: 'green', href: '/admin/leads?status=converted' })}
    </section>

    <div class="dash-split">
      <section class="panel">
        <div class="panel-head"><h2>Leads — last 7 days</h2><span class="muted">${weekTotal} total</span></div>
        ${areaChart(days)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Quick actions</h2></div>
        <div class="quick">${quick
          .map(([href, ic, lab]) => `<a href="${esc(href)}">${icon(ic)}<span>${esc(lab)}</span></a>`)
          .join('')}</div>
      </section>
    </div>

    <div class="dash-cols">
      <section class="panel"><div class="panel-head"><h2>Lead pipeline</h2></div>${donut(leadSegments, 'Leads')}</section>
      <section class="panel"><div class="panel-head"><h2>Appointments</h2></div>${donut(apptSegments, 'Appointments')}</section>
    </div>

    <section class="stats stats-3">
      ${metricCard('Institutions', institutions, 'Partner universities', '/admin/universities')}
      ${metricCard('Confirmed appointments', confirmedAppointments, 'Scheduled & confirmed', '/admin/appointments')}
      ${metricCard('Leads needing follow-up', followUpLeads, 'Marked follow-up', '/admin/leads')}
    </section>

    <div class="dash-split">
      <section class="panel">
        <div class="panel-head"><h2>Recent leads</h2><a class="pg" href="/admin/leads">View all</a></div>
        ${recentLeadsTable}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Recent activity</h2><a class="pg" href="/admin/audit-logs">View all</a></div>
        ${activity}
      </section>
    </div>

    <p class="note">All figures are read live from the database. Empty tables show 0 — no placeholder values are used.</p>
  </div>`;

  res.send(
    layout({
      title: 'Dashboard',
      user: req.user,
      nav: navFor(req.permissions, req.user.role.key),
      active: 'dashboard',
      body,
      csrfToken: req.session.csrfToken,
      sub: `Welcome back, ${req.user.name}. Here is what needs your attention today.`,
    })
  );
});

/* -------------------------------------------------------------- audit logs */
router.get('/admin/audit', requirePermission('audit:view'), async (req, res) => {
  const pg = paginate(req.query, 25);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
  ]);

  const table = rows.length
    ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Time (UTC)</th><th>Action</th><th>Actor</th><th>Entity</th><th>IP</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
            <td>${esc(r.createdAt.toISOString().slice(0, 19).replace('T', ' '))}</td>
            <td><code>${esc(r.action)}</code></td>
            <td>${esc(r.actorEmail || '—')}</td>
            <td>${esc(r.entity ? r.entity + (r.entityId ? '#' + r.entityId : '') : '—')}</td>
            <td>${esc(r.ip || '—')}</td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
    : `<p class="empty">No audit entries yet.</p>`;

  const body = `<section class="panel"><div class="panel-head"><h2>Audit log</h2>
    <span class="muted">Immutable record of administrative actions</span></div>
    ${table}${pager('/admin/audit', pg, total)}</section>`;

  res.send(
    layout({ title: 'Audit Logs', user: req.user, nav: navFor(req.permissions, req.user.role.key), active: 'audit', body, csrfToken: req.session.csrfToken })
  );
});

/* ------------------------------------------------ pretty URL aliases (301) */
router.get('/admin/fees-eligibility', requirePermission('fees:read'), (req, res) => res.redirect(301, '/admin/fees'));
router.get('/admin/overseas-mbbs', requirePermission('courses:read'), (req, res) => res.redirect(301, '/admin/overseas'));
router.get('/admin/audit-logs', requirePermission('audit:view'), (req, res) => res.redirect(301, '/admin/audit'));

/* -------------------------------------------- honest "not configured" pages */
function unconfigured(ic, heading, lines, backHref, backLabel) {
  return `<section class="panel"><div class="uc">
    <span class="uc-ico">${icon(ic)}</span>
    <h3>${esc(heading)}</h3>
    ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${backHref ? `<a class="btn btn-line" href="${esc(backHref)}">${esc(backLabel || 'Go back')}</a>` : ''}
  </div></section>`;
}

router.get('/admin/backup', requirePermission('settings:write'), (req, res) => {
  const body = unconfigured(
    'backup',
    'Backup & Data tools are not configured',
    [
      'Automated backups and data export are not enabled in this deployment.',
      'On the managed database, backups are handled by the hosting provider. No export runs from this page yet — nothing is simulated.',
    ],
    '/admin/settings',
    'Open System Settings'
  );
  res.send(layout({ title: 'Backup & Data', user: req.user, nav: navFor(req.permissions, req.user.role.key), active: 'backup', body, csrfToken: req.session.csrfToken }));
});

router.get('/admin/website-settings', requirePermission('settings:write'), (req, res) => {
  const body = unconfigured(
    'website',
    'Website Settings are managed under System Settings',
    [
      'Public site details such as contact numbers, address and social links are edited in the Settings module.',
      'This page is a placeholder for future website-specific options and holds no separate configuration yet.',
    ],
    '/admin/settings',
    'Open System Settings'
  );
  res.send(layout({ title: 'Website Settings', user: req.user, nav: navFor(req.permissions, req.user.role.key), active: 'website-settings', body, csrfToken: req.session.csrfToken }));
});

/* ---------------------------------------------------------- JSON API (core) */
router.get('/api/admin/me', requireAuth, (req, res) =>
  ok(res, {
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role.key,
    permissions: [...req.permissions].sort(),
  })
);

router.get('/api/admin/audit', requirePermission('audit:view'), async (req, res) => {
  const pg = paginate(req.query, 25);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
  ]);
  return ok(
    res,
    rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorEmail: r.actorEmail,
      entity: r.entity,
      entityId: r.entityId,
      ip: r.ip,
      createdAt: r.createdAt,
    })),
    { page: pg.page, pageSize: pg.size, total }
  );
});

module.exports = router;
module.exports.navFor = navFor;
