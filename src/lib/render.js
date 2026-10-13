'use strict';
/* Server-rendered admin HTML. All interpolated values are escaped unless passed
   through `raw()` (which is only ever used with markup we build ourselves). */

/* Bump this whenever css/admin.css or js/admin.js changes so browsers refetch. */
const ASSET_VER = '5';

function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
function raw(s) {
  return s;
}

const MARK_SYMBOL = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d77c"/><stop offset=".55" stop-color="#d9a62e"/><stop offset="1" stop-color="#a87412"/></linearGradient>
  <symbol id="mark" viewBox="0 0 64 64">
    <path d="M32 4 58 14 32 24 6 14Z" fill="currentColor"/>
    <path d="M17 18v7c0 3 7 6 15 6s15-3 15-6v-7l-15 6Z" fill="currentColor" opacity=".85"/>
    <path d="M52 16v12" stroke="url(#gGold)" stroke-width="2"/><circle cx="52" cy="30" r="2.4" fill="url(#gGold)"/>
    <path d="M41 28c-3-3-14-4-15 2-1 5 13 5 14 11 1 6-11 8-17 3" fill="none" stroke="url(#gGold)" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M4 44c9-3 19-2 28 6 9-8 19-9 28-6v6c-9-3-19-2-28 6-9-8-19-9-28-6Z" fill="currentColor"/>
    <path d="M10 44c7-1 15 1 22 6 7-5 15-7 22-6" fill="none" stroke="url(#gGold)" stroke-width="1.6"/>
  </symbol>
</defs></svg>`;

/* Lucide-style stroke icons (24×24). No emojis anywhere in the admin chrome. */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  courses: '<path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Z"/><path d="M8 7h6M8 11h6"/>',
  universities: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5"/>',
  countries: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  fees: '<path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.8 5 3.4 5 1.6 5 3.6-2.2 3-5 3-5-1.1-5-3"/>',
  overseas: '<circle cx="12" cy="12" r="9"/><path d="M2 12h20"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  leads: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5h5M16 9h5M16 13h3"/>',
  appointments: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  enquiries: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  content: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  faqs: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.4"/><path d="M12 17h.01"/>',
  testimonials: '<path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17l-5.4 2.6 1.2-6L3.3 9.4l6.1-.8Z"/>',
  media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="8" r="2.6"/><path d="M16 13.6a5 5 0 0 1 5 4.4"/>',
  reports: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
  audit: '<path d="M9 3h6l1 2h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3Z"/><path d="m9 12 2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
  backup: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14a2 2 0 0 0 2-2v-3H3v3a2 2 0 0 0 2 2Z"/>',
  website: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="6.2" cy="6.5" r=".7"/><circle cx="8.4" cy="6.5" r=".7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.4"/><path d="M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  cap: '<path d="M22 9 12 4 2 9l10 5 10-5Z"/><path d="M6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="8" r="2.6"/><path d="M16 13.6a5 5 0 0 1 5 4.4"/>',
  counsellor: '<circle cx="10" cy="8" r="3.2"/><path d="M4 20a6 6 0 0 1 11 0"/><path d="m16 12 2 2 4-4"/>',
  inbox: '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};

function icon(name, cls) {
  const d = ICONS[name] || ICONS.dot;
  return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function initials(name) {
  const parts = String(name || 'A').trim().split(/\s+/);
  return ((parts[0] || '')[0] || 'A').toUpperCase() + (parts[1] ? parts[1][0].toUpperCase() : '');
}

function flashBlock(flash) {
  if (!flash || !flash.message) return '';
  const kind = flash.kind === 'error' ? 'error' : 'ok';
  return `<div class="alert alert-${kind}" role="status">${esc(flash.message)}</div>`;
}

function navHtml(items, active) {
  return items
    .map((n) => {
      if (n.section) return `<p class="nav-section">${esc(n.section)}</p>`;
      return `<a class="nav-item${n.key === active ? ' is-active' : ''}" href="${esc(
        n.href
      )}" data-nav-item title="${esc(n.label)}"><span class="nav-ico">${icon(
        n.icon
      )}</span><span class="label">${esc(n.label)}</span></a>`;
    })
    .join('');
}

const LOGOUT_FORM = (csrfToken) => `<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(
  csrfToken
)}"><button type="submit" class="btn btn-line btn-block">${icon('logout')}<span>Sign out</span></button></form>`;

/* Authenticated admin shell. */
function layout({ title, user, nav = [], active = '', body = '', csrfToken = '', flash = null, sub = '', actions = '' }) {
  const roleName = user && user.role ? user.role.name : '';
  const name = user ? user.name : '';
  const email = user ? user.email : '';
  const initialsTxt = initials(name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Symbiosis Admin</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_VER}">
</head>
<body class="admin">
${MARK_SYMBOL}
<a class="skip" href="#admin-main">Skip to content</a>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="/admin" title="Symbiosis Admin">
      <svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>
      <span class="brand-word"><b>SYMBIOSIS</b><small>Admin console</small></span>
    </a>
    <nav class="nav" aria-label="Admin" id="adminNav">${navHtml(nav, active)}</nav>
    <div class="help-card">
      <b>Need a hand?</b>
      <p>Your signed-in role decides what you can see. Ask a super admin for access.</p>
      <a href="/" target="_blank" rel="noopener">${icon('external')}<span>Visit website</span></a>
    </div>
    <div class="sidebar-foot">${LOGOUT_FORM(csrfToken)}</div>
  </aside>
  <div class="menu-overlay" id="menuOverlay"></div>
  <div class="main">
    <header class="topbar">
      <button class="icon-btn hamburger" type="button" data-toggle-sidebar aria-label="Toggle menu" aria-expanded="false">${icon('menu')}</button>
      <button class="icon-btn" type="button" data-toggle-rail aria-label="Collapse sidebar" title="Collapse sidebar">${icon('panel')}</button>
      <form class="search" role="search" onsubmit="return false">
        ${icon('search')}<input id="navFilter" type="search" placeholder="Search menu…" autocomplete="off" aria-label="Search menu">
      </form>
      <div class="spacer"></div>
      <div class="dropdown" data-dropdown>
        <button class="icon-btn" type="button" data-dropdown-toggle aria-label="Notifications" aria-expanded="false" style="position:relative">${icon('bell')}<span class="badge-dot"></span></button>
        <div class="menu" data-menu>
          <div class="menu-head"><b>Notifications</b><small>New activity will appear here</small></div>
          <p class="empty-note">No new notifications.</p>
        </div>
      </div>
      <div class="dropdown" data-dropdown>
        <button type="button" data-dropdown-toggle aria-expanded="false">
          <span class="avatar">${esc(initialsTxt)}</span>
          <span class="who"><span class="who-name">${esc(name)}</span><span class="who-role">${esc(roleName)}</span></span>
          ${icon('chevron', 'chev')}
        </button>
        <div class="menu" data-menu>
          <div class="menu-head"><b>${esc(name)}</b><small>${esc(email)}</small></div>
          <a href="/" target="_blank" rel="noopener">${icon('external')}<span>View website</span></a>
          <a href="/admin">${icon('dashboard')}<span>Dashboard</span></a>
          ${LOGOUT_FORM(csrfToken).replace('btn-line btn-block', 'btn-ghost')}
        </div>
      </div>
    </header>
    <main class="content" id="admin-main">
      <div class="page-head">
        <div>
          <nav class="crumbs"><a href="/admin">Admin</a><span class="sep">/</span><span>${esc(title)}</span></nav>
          <h1>${esc(title)}</h1>
          ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
        </div>
        ${actions ? `<div class="head-actions">${raw(actions)}</div>` : ''}
      </div>
      ${flashBlock(flash)}
      ${body}
    </main>
  </div>
</div>
<script src="/js/admin.js?v=${ASSET_VER}" defer></script>
</body>
</html>`;
}

/* Unauthenticated split-screen (login / forgot / reset). */
function authLayout({ title, body = '', flash = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Symbiosis Admin</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_VER}">
</head>
<body class="admin admin-auth">
${MARK_SYMBOL}
<aside class="auth-aside">
  <div class="aa-brand">
    <svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>
    <span><b>SYMBIOSIS</b><small>Education Consultancy</small></span>
  </div>
  <div class="aa-hero">
    <p class="eyebrow">Admin console</p>
    <h2>Your Global Education Journey Starts Here</h2>
    <p>Manage courses, universities, student leads, appointments and website content — all from one secure workspace.</p>
    <div class="aa-features">
      <div class="aa-feature">${icon('cap')}<span><b>Top Universities</b><span>India &amp; overseas partners</span></span></div>
      <div class="aa-feature">${icon('globe')}<span><b>Multiple Countries</b><span>MBBS &amp; more</span></span></div>
      <div class="aa-feature">${icon('shield')}<span><b>Trusted Guidance</b><span>Verified information</span></span></div>
      <div class="aa-feature">${icon('counsellor')}<span><b>Expert Counsellors</b><span>Dedicated support</span></span></div>
    </div>
  </div>
  <p class="aa-foot">© ${new Date().getFullYear()} Symbiosis Education Consultancy</p>
</aside>
<main class="auth-panel">
  <div class="auth-wrap">
    <div class="auth-card">
      ${flashBlock(flash)}
      ${body}
    </div>
    <p class="auth-secure">${icon('shield')}<span>Secure sign-in · authorised staff only · activity is logged</span></p>
  </div>
</main>
</body>
</html>`;
}

module.exports = { esc, raw, layout, authLayout, icon, MARK_SYMBOL };
