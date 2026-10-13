'use strict';
/* ============================================================================
   Backend integration tests (Phase 1: auth, sessions, RBAC, protected routes).
   Runs against an isolated SQLite test database — never the dev database.
   Zero test-framework dependencies: uses the built-in fetch + node:assert.
   Run: npm run test:backend
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const assert = require('assert');

// --- isolate the database BEFORE loading config/db -------------------------
const ROOT = path.resolve(__dirname, '..');
const TEST_DB_FILE = path.join(ROOT, 'prisma', 'test.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.SESSION_COOKIE_NAME = 'sym_admin_sid';
process.env.LOGIN_MAX_FAILURES = '3';
process.env.COOKIE_SECURE = '0';
process.env.SHEETS_SYNC_KEY = 'test-sheets-key';

// --- stand-in for the Google Apps Script push webhook ----------------------
const webhookHits = [];
const hookServer = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    try { webhookHits.push({ url: req.url, body: JSON.parse(b) }); }
    catch { webhookHits.push({ url: req.url, body: b }); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
hookServer.listen(45999);
process.env.SHEETS_WEBHOOK_URL = 'http://127.0.0.1:45999/hook';

for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-journal']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
console.log('Preparing test database…');
execSync('npx prisma migrate deploy', { cwd: ROOT, stdio: 'ignore', env: process.env });

const prisma = require('../src/db');
const { createApp } = require('../src/server');
const { syncRbac } = require('../src/lib/seed');
const { hashPassword } = require('../src/lib/password');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, 'PASS', '']);
  } catch (e) {
    results.push([name, 'FAIL', String(e.message || e).replace(/[\r\n]+/g, ' ')]);
  }
}

/* ---------------------------------------------------------------- http jar */
function newJar() {
  return new Map();
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res, jar) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0, i);
    const val = pair.slice(i + 1);
    if (val === '') jar.delete(name);
    else jar.set(name, val);
  }
}
async function call(base, method, p, { form, json, headers = {}, jar } = {}) {
  const h = { ...headers };
  if (jar) h.cookie = cookieHeader(jar);
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    h['content-type'] = 'application/x-www-form-urlencoded';
  } else if (json) {
    body = JSON.stringify(json);
    h['content-type'] = 'application/json';
  }
  const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
  if (jar) storeCookies(res, jar);
  return res;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

/* ------------------------------------------------------------------ setup */
let server;
let base;

async function bootstrap() {
  await syncRbac(prisma);
  const su = await prisma.role.findUnique({ where: { key: 'super_admin' } });
  const cm = await prisma.role.findUnique({ where: { key: 'content_manager' } });
  await prisma.user.create({
    data: { email: 'admin@test.local', name: 'Test Super', passwordHash: await hashPassword('Sup3rSecret!'), roleId: su.id, status: 'active' },
  });
  await prisma.user.create({
    data: { email: 'content@test.local', name: 'Test Content', passwordHash: await hashPassword('Cont3ntPass!'), roleId: cm.id, status: 'active' },
  });
  await prisma.user.create({
    data: { email: 'disabled@test.local', name: 'Disabled', passwordHash: await hashPassword('Sup3rSecret!'), roleId: su.id, status: 'disabled' },
  });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = 'http://127.0.0.1:' + server.address().port;

  // helper: log a user in through the JSON API and return { jar, csrf, user }
  async function login(email, password) {
    const jar = newJar();
    const page = await call(base, 'GET', '/admin/login', { jar });
    const csrf = csrfFrom(await page.text());
    const res = await call(base, 'POST', '/api/admin/auth/login', {
      jar,
      json: { email, password },
      headers: { 'x-csrf-token': csrf, accept: 'application/json' },
    });
    let sessionCsrf = csrf;
    try {
      const body = await res.clone().json();
      if (body && body.data && body.data.csrfToken) sessionCsrf = body.data.csrfToken;
    } catch {}
    return { jar, csrf: sessionCsrf, res };
  }
  return { login };
}

async function run() {
  const { login } = await bootstrap();

  /* ---- protected routes ---- */
  await test('unauthenticated GET /admin redirects to login', async () => {
    const res = await call(base, 'GET', '/admin');
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location') || '', /\/admin\/login/);
  });

  await test('unauthenticated API request returns 401 (not a page)', async () => {
    const res = await call(base, 'GET', '/api/admin/me', { headers: { accept: 'application/json' } });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, 'unauthenticated');
  });

  /* ---- login validation ---- */
  await test('login page renders with CSRF token and branding', async () => {
    const res = await call(base, 'GET', '/admin/login');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /SYMBIOSIS/);
    assert.match(html, /name="_csrf"/);
    assert.match(html, /Forgot password/);
  });

  await test('invalid credentials returns generic 401 (no user enumeration)', async () => {
    const a = await login('admin@test.local', 'wrong-password');
    assert.strictEqual(a.res.status, 401);
    const body = await a.res.json();
    assert.strictEqual(body.error.message, 'Invalid email or password.');

    const b = await login('nobody@test.local', 'whatever');
    assert.strictEqual(b.res.status, 401);
    const body2 = await b.res.json();
    assert.strictEqual(body2.error.message, 'Invalid email or password.');
  });

  await test('disabled account cannot sign in', async () => {
    const a = await login('disabled@test.local', 'Sup3rSecret!');
    assert.strictEqual(a.res.status, 401);
  });

  await test('missing CSRF token is rejected with 403', async () => {
    const jar = newJar();
    await call(base, 'GET', '/admin/login', { jar });
    const res = await call(base, 'POST', '/api/admin/auth/login', {
      jar,
      json: { email: 'admin@test.local', password: 'Sup3rSecret!' },
      headers: { accept: 'application/json' },
    });
    assert.strictEqual(res.status, 403);
  });

  /* ---- successful login + session ---- */
  let adminSession;
  await test('valid credentials create a session and reach the dashboard', async () => {
    adminSession = await login('admin@test.local', 'Sup3rSecret!');
    assert.strictEqual(adminSession.res.status, 200);

    const dash = await call(base, 'GET', '/admin', { jar: adminSession.jar });
    assert.strictEqual(dash.status, 200);
    const html = await dash.text();
    assert.match(html, /Dashboard/);
    assert.match(html, /Recent activity/);
  });

  await test('session cookie is HTTP-only', async () => {
    const jar = newJar();
    await call(base, 'GET', '/admin/login', { jar });
    const res = await call(base, 'POST', '/admin/login', {
      jar,
      form: { _csrf: 'x' }, // will fail, but we read cookie flags from a fresh GET below
    });
    // Inspect the Set-Cookie flags on a real login instead:
    const loginRes = await login('admin@test.local', 'Sup3rSecret!');
    const raw = (loginRes.res.headers.getSetCookie ? loginRes.res.headers.getSetCookie() : []).join('\n');
    assert.match(raw, /HttpOnly/);
  });

  await test('password is stored hashed, never plaintext', async () => {
    const u = await prisma.user.findUnique({ where: { email: 'admin@test.local' } });
    assert.ok(u.passwordHash.startsWith('scrypt$'), 'not scrypt');
    assert.notStrictEqual(u.passwordHash, 'Sup3rSecret!');
  });

  /* ---- RBAC ---- */
  await test('super admin can read audit API; content manager is forbidden (403)', async () => {
    const okRes = await call(base, 'GET', '/api/admin/audit', { jar: adminSession.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(okRes.status, 200);

    const cm = await login('content@test.local', 'Cont3ntPass!');
    assert.strictEqual(cm.res.status, 200);
    const forbidden = await call(base, 'GET', '/api/admin/audit', { jar: cm.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(forbidden.status, 403);
    const body = await forbidden.json();
    assert.strictEqual(body.error.code, 'forbidden');
  });

  await test('content manager cannot open /admin/audit page (403)', async () => {
    const cm = await login('content@test.local', 'Cont3ntPass!');
    const res = await call(base, 'GET', '/admin/audit', { jar: cm.jar });
    assert.strictEqual(res.status, 403);
  });

  await test('me API reports the role and its permissions', async () => {
    const res = await call(base, 'GET', '/api/admin/me', { jar: adminSession.jar, headers: { accept: 'application/json' } });
    const body = await res.json();
    assert.strictEqual(body.data.role, 'super_admin');
    assert.ok(Array.isArray(body.data.permissions) && body.data.permissions.length > 0);
  });

  /* ---- session expiry + logout ---- */
  await test('expired session is rejected', async () => {
    const s = await login('admin@test.local', 'Sup3rSecret!');
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await call(base, 'GET', '/admin', { jar: s.jar });
    assert.strictEqual(res.status, 302);
    await prisma.session.deleteMany({});
  });

  await test('logout revokes the session and clears the cookie', async () => {
    const s = await login('admin@test.local', 'Sup3rSecret!');
    const out = await call(base, 'POST', '/admin/logout', { jar: s.jar, form: { _csrf: s.csrf }, headers: { accept: 'application/json' } });
    assert.strictEqual(out.status, 200);
    const after = await call(base, 'GET', '/admin', { jar: s.jar });
    assert.strictEqual(after.status, 302);
  });

  /* ---- brute force lock ---- */
  await test('repeated failures lock further attempts (429)', async () => {
    let last;
    for (let i = 0; i < 3; i++) last = await login('lockme@test.local', 'nope');
    const locked = await login('lockme@test.local', 'nope');
    assert.strictEqual(locked.res.status, 429);
  });

  /* ---- audit trail ---- */
  await test('a successful login is recorded in the audit log', async () => {
    const row = await prisma.auditLog.findFirst({ where: { action: 'auth.login' } });
    assert.ok(row, 'no auth.login audit entry');
  });

  /* ================= Phase 2: Staff & Roles ================= */
  adminSession = await login('admin@test.local', 'Sup3rSecret!');
  assert.strictEqual(adminSession.res.status, 200, 'phase 2 admin login failed');
  const admin = await prisma.user.findUnique({ where: { email: 'admin@test.local' } });
  const counsellorRole = await prisma.role.findUnique({ where: { key: 'counsellor' } });

  await test('super admin can list staff via the JSON API', async () => {
    const res = await call(base, 'GET', '/api/admin/staff', { jar: adminSession.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data) && body.data.length >= 3);
    assert.ok(body.pagination && body.pagination.total >= 3);
  });

  await test('content manager is forbidden from staff (API 403 + page 403)', async () => {
    const cm = await login('content@test.local', 'Cont3ntPass!');
    const api = await call(base, 'GET', '/api/admin/staff', { jar: cm.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(api.status, 403);
    const page = await call(base, 'GET', '/admin/staff', { jar: cm.jar });
    assert.strictEqual(page.status, 403);
  });

  let createdId;
  await test('super admin creates a staff member (hashed, must-change, audited)', async () => {
    const res = await call(base, 'POST', '/api/admin/staff', {
      jar: adminSession.jar,
      json: { name: 'New Counsellor', email: 'newstaff@test.local', roleId: counsellorRole.id, password: 'Str0ngPass!' },
      headers: { 'x-csrf-token': adminSession.csrf, accept: 'application/json' },
    });
    assert.strictEqual(res.status, 201);
    createdId = (await res.json()).data.id;
    const u = await prisma.user.findUnique({ where: { id: createdId } });
    assert.ok(u.passwordHash.startsWith('scrypt$'));
    assert.strictEqual(u.mustChangePassword, true);
    const entry = await prisma.auditLog.findFirst({ where: { action: 'staff.create', entityId: createdId } });
    assert.ok(entry, 'no staff.create audit entry');
  });

  await test('duplicate email is rejected with 409 email_taken', async () => {
    const res = await call(base, 'POST', '/api/admin/staff', {
      jar: adminSession.jar,
      json: { name: 'Dup', email: 'newstaff@test.local', roleId: counsellorRole.id, password: 'Str0ngPass!' },
      headers: { 'x-csrf-token': adminSession.csrf, accept: 'application/json' },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error.code, 'email_taken');
  });

  await test('weak password is rejected with 400 weak_password', async () => {
    const res = await call(base, 'POST', '/api/admin/staff', {
      jar: adminSession.jar,
      json: { name: 'Weak', email: 'weak@test.local', roleId: counsellorRole.id, password: 'short' },
      headers: { 'x-csrf-token': adminSession.csrf, accept: 'application/json' },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error.code, 'weak_password');
  });

  await test('a user cannot disable their own account (409 self_disable)', async () => {
    const res = await call(base, 'POST', `/api/admin/staff/${admin.id}/status`, {
      jar: adminSession.jar,
      json: { status: 'disabled' },
      headers: { 'x-csrf-token': adminSession.csrf, accept: 'application/json' },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error.code, 'self_disable');
  });

  await test('staff.create role can be created and its permissions edited', async () => {
    const create = await call(base, 'POST', '/admin/roles', {
      jar: adminSession.jar,
      form: { _csrf: adminSession.csrf, name: 'Front Desk', key: 'front_desk' },
    });
    assert.strictEqual(create.status, 302);
    assert.match(create.headers.get('location') || '', /ok=role_created/);
    const role = await prisma.role.findUnique({ where: { key: 'front_desk' } });
    assert.ok(role, 'role not created');

    const save = await call(base, 'POST', `/admin/roles/${role.id}`, {
      jar: adminSession.jar,
      form: [
        ['_csrf', adminSession.csrf],
        ['name', 'Front Desk'],
        ['permissions', 'staff:read'],
        ['permissions', 'staff:write'],
      ],
    });
    assert.strictEqual(save.status, 302);
    const perms = await prisma.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
    assert.deepStrictEqual(perms.map((p) => p.permission.key).sort(), ['staff:read', 'staff:write']);
  });

  await test('the last active super admin cannot be disabled by another user', async () => {
    const fd = await prisma.role.findUnique({ where: { key: 'front_desk' } });
    await prisma.user.create({
      data: { email: 'ops@test.local', name: 'Ops', passwordHash: await hashPassword('OpsPassw0rd!'), roleId: fd.id, status: 'active' },
    });
    const ops = await login('ops@test.local', 'OpsPassw0rd!');
    assert.strictEqual(ops.res.status, 200);
    const res = await call(base, 'POST', `/api/admin/staff/${admin.id}/status`, {
      jar: ops.jar,
      json: { status: 'disabled' },
      headers: { 'x-csrf-token': ops.csrf, accept: 'application/json' },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error.code, 'last_super_admin');
  });

  await test('staff, roles and add-staff pages render for a super admin', async () => {
    const listPage = await call(base, 'GET', '/admin/staff', { jar: adminSession.jar });
    assert.strictEqual(listPage.status, 200);
    assert.match(await listPage.text(), /Add staff/);

    const rolesPage = await call(base, 'GET', '/admin/roles', { jar: adminSession.jar });
    assert.strictEqual(rolesPage.status, 200);
    const rolesHtml = await rolesPage.text();
    assert.match(rolesHtml, /Super Admin/);
    assert.match(rolesHtml, /Create a role/);

    const newPage = await call(base, 'GET', '/admin/staff/new', { jar: adminSession.jar });
    assert.strictEqual(newPage.status, 200);
    assert.match(await newPage.text(), /Temporary password/);
  });

  await test('the Super Admin role always holds every permission', async () => {
    const su = await prisma.role.findUnique({ where: { key: 'super_admin' }, include: { permissions: true } });
    const all = require('../src/lib/rbac').ALL_KEYS.length;
    assert.strictEqual(su.permissions.length, all);
  });

  /* ================= Phase 3: Catalogue ================= */
  const H = { 'x-csrf-token': adminSession.csrf, accept: 'application/json' };

  await test('super admin can create a country (and duplicates are blocked)', async () => {
    const res = await call(base, 'POST', '/api/admin/countries', { jar: adminSession.jar, json: { name: 'Georgia', code: 'GE', status: 'published' }, headers: H });
    assert.strictEqual(res.status, 201);
    const dup = await call(base, 'POST', '/api/admin/countries', { jar: adminSession.jar, json: { name: 'Georgia', code: 'GE' }, headers: H });
    assert.strictEqual(dup.status, 409);
  });

  let countryId;
  await test('countries list + CSV export work', async () => {
    const list = await call(base, 'GET', '/api/admin/countries', { jar: adminSession.jar, headers: H });
    const body = await list.json();
    const georgia = body.data.find((c) => c.name === 'Georgia');
    assert.ok(georgia, 'Georgia not listed');
    countryId = georgia.id;

    const exp = await call(base, 'GET', '/admin/countries/export.csv', { jar: adminSession.jar });
    assert.strictEqual(exp.status, 200);
    assert.match(exp.headers.get('content-type') || '', /text\/csv/);
    assert.match(await exp.text(), /Georgia/);
  });

  let institutionId;
  await test('super admin can create a university linked to a country', async () => {
    const res = await call(base, 'POST', '/api/admin/institutions', {
      jar: adminSession.jar,
      json: { name: 'Batumi Shota Rustaveli State University', city: 'Batumi', countryId, status: 'published' },
      headers: H,
    });
    assert.strictEqual(res.status, 201);
    institutionId = (await res.json()).data.id;
  });

  let courseId;
  await test('super admin can create a course and publish it', async () => {
    const res = await call(base, 'POST', '/api/admin/courses', {
      jar: adminSession.jar,
      json: { name: 'MBBS Georgia', publicId: 'mbbs-georgia', institutionId, country: 'Georgia', city: 'Batumi', tuitionFee: 350000, duration: '6 years', status: 'draft' },
      headers: H,
    });
    assert.strictEqual(res.status, 201);
    courseId = (await res.json()).data.id;

    const pub = await call(base, 'POST', `/api/admin/courses/${courseId}/publish`, { jar: adminSession.jar, json: {}, headers: H });
    assert.strictEqual(pub.status, 200);
    const c = await prisma.course.findUnique({ where: { id: courseId } });
    assert.strictEqual(c.status, 'published');
  });

  await test('course appears in the list with its fee', async () => {
    const list = await call(base, 'GET', '/api/admin/courses?q=MBBS', { jar: adminSession.jar, headers: H });
    const body = await list.json();
    assert.ok(body.data.find((c) => c.id === courseId && c.tuitionFee === 350000));
  });

  let feeId;
  await test('a fee record can be added and edits are versioned', async () => {
    const add = await call(base, 'POST', `/admin/courses/${courseId}/fees`, {
      jar: adminSession.jar,
      form: { _csrf: adminSession.csrf, label: 'Tuition (Year 1)', amount: '350000', kind: 'tuition', status: 'published', currency: 'INR' },
    });
    assert.strictEqual(add.status, 302);
    const fee = await prisma.feeRecord.findFirst({ where: { courseId, label: 'Tuition (Year 1)' } });
    assert.ok(fee, 'fee not created');
    feeId = fee.id;

    const upd = await call(base, 'POST', `/admin/fees/${feeId}`, {
      jar: adminSession.jar,
      form: { _csrf: adminSession.csrf, label: 'Tuition (Year 1)', amount: '375000', kind: 'tuition', status: 'published', currency: 'INR' },
    });
    assert.strictEqual(upd.status, 302);
    const change = await prisma.feeChange.findFirst({ where: { feeRecordId: feeId, newAmount: 375000 } });
    assert.ok(change && change.oldAmount === 350000, 'fee change not versioned');
  });

  await test('countries CSV import creates new rows', async () => {
    const csvText = 'name,code,status\nKazakhstan,KZ,published\nUzbekistan,UZ,draft\n';
    const res = await call(base, 'POST', '/admin/countries/import', { jar: adminSession.jar, form: { _csrf: adminSession.csrf, csv: csvText } });
    assert.strictEqual(res.status, 302);
    assert.ok(await prisma.country.findUnique({ where: { name: 'Kazakhstan' } }));
    assert.ok(await prisma.country.findUnique({ where: { name: 'Uzbekistan' } }));
  });

  await test('counsellor can read courses but not write (403)', async () => {
    const counsellorRole = await prisma.role.findUnique({ where: { key: 'counsellor' } });
    await prisma.user.create({ data: { email: 'counsellor@test.local', name: 'Counsellor', passwordHash: await hashPassword('Couns3llor!'), roleId: counsellorRole.id, status: 'active' } });
    const c = await login('counsellor@test.local', 'Couns3llor!');
    assert.strictEqual(c.res.status, 200);
    const read = await call(base, 'GET', '/api/admin/courses', { jar: c.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(read.status, 200);
    const write = await call(base, 'POST', '/api/admin/courses', { jar: c.jar, json: { name: 'Nope' }, headers: { 'x-csrf-token': c.csrf, accept: 'application/json' } });
    assert.strictEqual(write.status, 403);
  });

  await test('deleting a course soft-deletes it (hidden from the list)', async () => {
    const del = await call(base, 'DELETE', `/api/admin/courses/${courseId}`, { jar: adminSession.jar, headers: H });
    assert.strictEqual(del.status, 200);
    const c = await prisma.course.findUnique({ where: { id: courseId } });
    assert.ok(c.deletedAt, 'not soft-deleted');
    const list = await call(base, 'GET', '/api/admin/courses?q=MBBS', { jar: adminSession.jar, headers: H });
    const body = await list.json();
    assert.ok(!body.data.find((x) => x.id === courseId), 'deleted course still listed');
  });

  await test('catalogue admin pages render (courses, universities, countries, fees)', async () => {
    for (const p of ['/admin/courses', '/admin/universities', '/admin/countries', '/admin/fees', '/admin/courses/new', '/admin/countries/import']) {
      const r = await call(base, 'GET', p, { jar: adminSession.jar });
      assert.strictEqual(r.status, 200, p + ' did not render');
    }
  });

  /* ================= Phase 4: CRM ================= */
  let leadId;
  await test('a lead can be created and listed', async () => {
    const res = await call(base, 'POST', '/api/admin/leads', { jar: adminSession.jar, json: { studentName: 'Ravi Kumar', phone: '8200691036', source: 'website', status: 'new', courseInterest: 'MBBS' }, headers: H });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    leadId = body.data.id;
    assert.match(body.data.reference, /.+/);

    const list = await call(base, 'GET', '/api/admin/leads?q=Ravi', { jar: adminSession.jar, headers: H });
    const listed = (await list.json()).data.find((l) => l.id === leadId);
    assert.ok(listed, 'lead not listed');
  });

  await test('a lead note is recorded on the activity timeline', async () => {
    const res = await call(base, 'POST', `/admin/leads/${leadId}/notes`, { jar: adminSession.jar, form: { _csrf: adminSession.csrf, kind: 'call', body: 'Called the student — interested in Georgia.' } });
    assert.strictEqual(res.status, 302);
    const note = await prisma.leadNote.findFirst({ where: { leadId, kind: 'call' } });
    assert.ok(note, 'note not recorded');
  });

  await test('changing lead status writes a status_change entry', async () => {
    const res = await call(base, 'POST', `/api/admin/leads/${leadId}/status`, { jar: adminSession.jar, json: { status: 'contacted' }, headers: H });
    assert.strictEqual(res.status, 200);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    assert.strictEqual(lead.status, 'contacted');
    const changes = await prisma.leadNote.count({ where: { leadId, kind: 'status_change' } });
    assert.ok(changes >= 2, 'expected created + status change entries');
  });

  await test('lead assignment needs leads:assign (counsellor 403, super admin 200)', async () => {
    const counsellor = await login('counsellor@test.local', 'Couns3llor!');
    const denied = await call(base, 'POST', `/api/admin/leads/${leadId}/assign`, { jar: counsellor.jar, json: { assignedToId: null }, headers: { 'x-csrf-token': counsellor.csrf, accept: 'application/json' } });
    assert.strictEqual(denied.status, 403);

    const assignee = await prisma.user.findUnique({ where: { email: 'counsellor@test.local' } });
    const okRes = await call(base, 'POST', `/api/admin/leads/${leadId}/assign`, { jar: adminSession.jar, json: { assignedToId: assignee.id }, headers: H });
    assert.strictEqual(okRes.status, 200);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    assert.strictEqual(lead.assignedToId, assignee.id);
  });

  await test('counsellor can create a lead (has leads:write)', async () => {
    const counsellor = await login('counsellor@test.local', 'Couns3llor!');
    const res = await call(base, 'POST', '/api/admin/leads', { jar: counsellor.jar, json: { studentName: 'Aarti Singh', phone: '9998887776', source: 'referral' }, headers: { 'x-csrf-token': counsellor.csrf, accept: 'application/json' } });
    assert.strictEqual(res.status, 201);
  });

  let apptId;
  await test('an appointment can be created and its status changed', async () => {
    const res = await call(base, 'POST', '/api/admin/appointments', { jar: adminSession.jar, json: { studentName: 'Ravi Kumar', contactNumber: '8200691036', scheduledAt: '2026-11-01T10:00', meetingType: 'call', leadId }, headers: H });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    apptId = body.data.id;
    assert.match(body.data.reference, /^APT-/);
    const upd = await call(base, 'POST', `/api/admin/appointments/${apptId}/status`, { jar: adminSession.jar, json: { status: 'confirmed' }, headers: H });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual((await prisma.appointment.findUnique({ where: { id: apptId } })).status, 'confirmed');
  });

  await test('availability slots can be added and duplicates are rejected', async () => {
    const a = await call(base, 'POST', '/api/admin/availability', { jar: adminSession.jar, json: { weekday: 2, startTime: '15:00', endTime: '15:30' }, headers: H });
    assert.strictEqual(a.status, 201);
    const dup = await call(base, 'POST', '/api/admin/availability', { jar: adminSession.jar, json: { weekday: 2, startTime: '15:00', endTime: '15:30' }, headers: H });
    assert.strictEqual(dup.status, 409);
  });

  await test('enquiries are readable by staff with enquiries:read (content manager 403)', async () => {
    await prisma.contactEnquiry.create({ data: { name: 'Meena', contact: 'meena@example.com', subject: 'Fees', message: 'What is the MBBS fee?', status: 'new' } });
    const list = await call(base, 'GET', '/api/admin/enquiries', { jar: adminSession.jar, headers: H });
    assert.strictEqual(list.status, 200);
    assert.ok((await list.json()).pagination.total >= 1);

    const cm = await login('content@test.local', 'Cont3ntPass!');
    const forbidden = await call(base, 'GET', '/api/admin/enquiries', { jar: cm.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(forbidden.status, 403);
  });

  await test('CRM admin pages render (leads, appointments, enquiries + detail)', async () => {
    for (const p of ['/admin/leads', '/admin/leads/new', `/admin/leads/${leadId}`, '/admin/appointments', '/admin/appointments/new', `/admin/appointments/${apptId}`, '/admin/enquiries']) {
      const r = await call(base, 'GET', p, { jar: adminSession.jar });
      assert.strictEqual(r.status, 200, p + ' did not render');
    }
  });

  /* ============================ PHASE 5: CMS + PUBLIC SITE ============================ */

  await test('public site payload is served without authentication', async () => {
    const res = await call(base, 'GET', '/api/public/site', { headers: { accept: 'application/json' } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data.courses));
    assert.ok(Array.isArray(body.data.faqs));
    assert.ok(Array.isArray(body.data.availability));
    assert.ok(body.data.content && typeof body.data.content === 'object');
    assert.ok(body.data.settings && typeof body.data.settings === 'object');
  });

  await test('public availability returns only well-formed active slots', async () => {
    await prisma.availabilitySlot.updateMany({ data: { active: true } });
    const res = await call(base, 'GET', '/api/public/availability', { headers: { accept: 'application/json' } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data) && body.data.length >= 1);
    assert.ok(body.data.every((s) => s.weekday >= 0 && s.weekday <= 6 && /^\d\d:\d\d$/.test(s.startTime)));
  });

  await test('website lead intake stores a website lead and ignores the honeypot', async () => {
    const before = await prisma.lead.count({ where: { source: 'website' } });
    const bot = await call(base, 'POST', '/api/public/leads', { json: { studentName: 'Bot', phone: '9999999999', website: 'http://spam' }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(bot.status, 200);
    const res = await call(base, 'POST', '/api/public/leads', { json: { studentName: 'Web Lead', phone: '9812345670', courseInterest: 'B.Pharm' }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(res.status, 201);
    assert.match((await res.json()).data.reference, /[A-Za-z0-9]/);
    assert.strictEqual(await prisma.lead.count({ where: { source: 'website' } }), before + 1);
    assert.strictEqual(await prisma.lead.count({ where: { studentName: 'Bot' } }), 0);
  });

  await test('website enquiry intake validates input and records the client IP', async () => {
    const bad = await call(base, 'POST', '/api/public/enquiries', { json: { name: 'X' }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(bad.status, 400);
    const res = await call(base, 'POST', '/api/public/enquiries', { json: { name: 'Neha', contact: '9812345671', message: 'Please share BPT fees.' }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(res.status, 201);
    const enq = await prisma.contactEnquiry.findFirst({ where: { name: 'Neha' } });
    assert.ok(enq && enq.status === 'new');
    assert.ok(enq.ip && enq.ip.length > 0);
  });

  await test('website booking creates an appointment and links/creates a lead', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const res = await call(base, 'POST', '/api/public/appointments', { json: { studentName: 'Imran', contactNumber: '9812345672', courseInterest: 'MBBS in Georgia', scheduledAt: future, meetingType: 'whatsapp' }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(res.status, 201);
    const ref = (await res.json()).data.reference;
    assert.match(ref, /^APT-/);
    const appt = await prisma.appointment.findFirst({ where: { reference: ref } });
    assert.ok(appt.leadId, 'appointment was not linked to a lead');
    const lead = await prisma.lead.findUnique({ where: { id: appt.leadId } });
    assert.strictEqual(lead.phone, '9812345672');
    assert.strictEqual(lead.status, 'counselling_scheduled');
  });

  await test('website booking rejects a past date', async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await call(base, 'POST', '/api/public/appointments', { json: { studentName: 'Late', contactNumber: '9812345673', scheduledAt: past }, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.strictEqual(res.status, 400);
  });

  let contentId;
  await test('super admin publishes a content entry that appears on the public site', async () => {
    const res = await call(base, 'POST', '/api/admin/content', { jar: adminSession.jar, json: { key: 'contact.session', value: '2027–28', type: 'text', status: 'published' }, headers: H });
    assert.strictEqual(res.status, 201);
    contentId = (await res.json()).data.id;
    const site = await (await call(base, 'GET', '/api/public/site', { headers: { accept: 'application/json' } })).json();
    assert.strictEqual(site.data.content['contact.session'], '2027–28');
  });

  await test('a draft content entry is never exposed publicly', async () => {
    const res = await call(base, 'POST', '/api/admin/content', { jar: adminSession.jar, json: { key: 'secret.draft', value: 'nope', status: 'draft' }, headers: H });
    assert.strictEqual(res.status, 201);
    const site = await (await call(base, 'GET', '/api/public/site', { headers: { accept: 'application/json' } })).json();
    assert.ok(!('secret.draft' in site.data.content));
  });

  await test('content API requires CSRF, and content:read for access', async () => {
    const noCsrf = await call(base, 'POST', '/api/admin/content', { jar: adminSession.jar, json: { key: 'x', value: 'y' }, headers: { accept: 'application/json' } });
    assert.strictEqual(noCsrf.status, 403);
    const counsellor = await login('counsellor@test.local', 'Couns3llor!');
    const forbidden = await call(base, 'GET', '/api/admin/content', { jar: counsellor.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(forbidden.status, 403);
  });

  await test('published FAQs are served publicly and can be reordered', async () => {
    const a = await call(base, 'POST', '/api/admin/faqs', { jar: adminSession.jar, json: { question: 'Is NEET required for BPT?', answer: 'Rules vary by university — we verify them before admission.', status: 'published' }, headers: H });
    assert.strictEqual(a.status, 201);
    const faqId = (await a.json()).data.id;
    const site = await (await call(base, 'GET', '/api/public/site', { headers: { accept: 'application/json' } })).json();
    assert.ok(site.data.faqs.some((f) => f.question === 'Is NEET required for BPT?'));
    const moved = await call(base, 'POST', `/admin/faqs/${faqId}/move`, { jar: adminSession.jar, form: { _csrf: adminSession.csrf, dir: 'up' } });
    assert.ok([302, 303].includes(moved.status));
  });

  await test('media can be registered by URL, listed, then deleted', async () => {
    const add = await call(base, 'POST', '/api/admin/media', { jar: adminSession.jar, json: { path: '/assets/photos/graduates-band.jpg', filename: 'graduates-band.jpg', altText: 'Graduates' }, headers: H });
    assert.strictEqual(add.status, 201);
    const id = (await add.json()).data.id;
    const list = await call(base, 'GET', '/api/admin/media', { jar: adminSession.jar, headers: H });
    assert.ok((await list.json()).data.some((m) => m.id === id));
    const del = await call(base, 'DELETE', `/api/admin/media/${id}`, { jar: adminSession.jar, headers: H });
    assert.strictEqual(del.status, 200);
  });

  await test('settings update is reflected publicly and needs settings:write', async () => {
    const put = await call(base, 'PUT', '/api/admin/settings', { jar: adminSession.jar, json: { 'contact.whatsapp': '917284913204' }, headers: H });
    assert.strictEqual(put.status, 200);
    const site = await (await call(base, 'GET', '/api/public/site', { headers: { accept: 'application/json' } })).json();
    assert.strictEqual(site.data.settings['contact.whatsapp'], '917284913204');
    const cm = await login('content@test.local', 'Cont3ntPass!');
    const forbidden = await call(base, 'GET', '/api/admin/settings', { jar: cm.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(forbidden.status, 403);
  });

  await test('CMS admin pages render for a super admin', async () => {
    for (const p of ['/admin/content', '/admin/content/new', `/admin/content/${contentId}`, '/admin/faqs', '/admin/faqs/new', '/admin/media', '/admin/settings']) {
      const r = await call(base, 'GET', p, { jar: adminSession.jar });
      assert.strictEqual(r.status, 200, p + ' did not render');
    }
  });

  /* =============================== PHASE 6: REPORTS =============================== */

  await test('reports API needs reports:view (counsellor 403, admin 200) and returns a summary', async () => {
    const c = await login('counsellor@test.local', 'Couns3llor!');
    const denied = await call(base, 'GET', '/api/admin/reports', { jar: c.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(denied.status, 403);
    const res = await call(base, 'GET', '/api/admin/reports', { jar: adminSession.jar, headers: H });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()).data;
    assert.ok(body.leads && typeof body.leads.total === 'number');
    assert.ok(body.appointments && body.enquiries && body.catalogue && body.funnel);
    assert.ok(body.leads.byStatus && 'converted' in body.leads.byStatus);
    assert.ok(Array.isArray(body.leads.daily));
    assert.ok(typeof body.funnel.conversionRate === 'number');
  });

  await test('reports respects the from/to range filter', async () => {
    const empty = await call(base, 'GET', '/api/admin/reports?from=2000-01-01&to=2000-01-31', { jar: adminSession.jar, headers: H });
    assert.strictEqual(empty.status, 200);
    assert.strictEqual((await empty.json()).data.leads.total, 0);
    const now = await call(base, 'GET', '/api/admin/reports', { jar: adminSession.jar, headers: H });
    assert.ok((await now.json()).data.leads.total >= 1);
  });

  await test('reports CSV export returns a CSV attachment', async () => {
    const res = await call(base, 'GET', '/admin/reports/export.csv', { jar: adminSession.jar });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/csv/);
    const text = await res.text();
    assert.match(text, /section,metric,value/);
    assert.match(text, /funnel,conversion_rate_pct/);
  });

  await test('reports page renders for admin and is forbidden to a content manager', async () => {
    const r = await call(base, 'GET', '/admin/reports', { jar: adminSession.jar });
    assert.strictEqual(r.status, 200);
    assert.match(await r.text(), /Conversion funnel/);
    const cm = await login('content@test.local', 'Cont3ntPass!');
    const forbidden = await call(base, 'GET', '/admin/reports', { jar: cm.jar });
    assert.strictEqual(forbidden.status, 403);
  });

  /* ============================= PHASE 6b: OVERSEAS ============================= */

  let overseasId;
  await test('overseas MBBS view lists category "overseas" courses grouped by country', async () => {
    const created = await prisma.course.create({
      data: { name: 'MBBS in Georgia (Overseas)', slug: 'mbbs-georgia-overseas', category: 'overseas', country: 'Georgia', city: 'Tbilisi', duration: '6 years', status: 'published', tuitionFee: 4200000 },
    });
    overseasId = created.id;

    const api = await call(base, 'GET', '/api/admin/overseas', { jar: adminSession.jar, headers: H });
    assert.strictEqual(api.status, 200);
    const items = (await api.json()).data;
    assert.ok(items.some((c) => c.id === overseasId && c.country === 'Georgia'));

    const page = await call(base, 'GET', '/admin/overseas', { jar: adminSession.jar });
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /Overseas MBBS/);
    assert.match(html, /MBBS in Georgia \(Overseas\)/);
  });

  await test('overseas view is readable by a counsellor (courses:read)', async () => {
    const c = await login('counsellor@test.local', 'Couns3llor!');
    const res = await call(base, 'GET', '/api/admin/overseas', { jar: c.jar, headers: { accept: 'application/json' } });
    assert.strictEqual(res.status, 200);
  });

  /* =========================== PHASE 6c: INTEGRATIONS =========================== */

  await test('integration API rejects missing and wrong keys', async () => {
    const none = await call(base, 'GET', '/api/integrations/records', { headers: { accept: 'application/json' } });
    assert.strictEqual(none.status, 401);
    const wrong = await call(base, 'GET', '/api/integrations/records', { headers: { 'x-api-key': 'nope', accept: 'application/json' } });
    assert.strictEqual(wrong.status, 401);
    const pingNone = await call(base, 'GET', '/api/integrations/ping', { headers: { accept: 'application/json' } });
    assert.strictEqual(pingNone.status, 401);
  });

  await test('integration API returns CRM records for a valid key', async () => {
    const key = { 'x-api-key': 'test-sheets-key', accept: 'application/json' };
    const ping = await call(base, 'GET', '/api/integrations/ping', { headers: key });
    assert.strictEqual(ping.status, 200);
    assert.strictEqual((await ping.json()).data.service, 'symbiosis-integrations');

    const res = await call(base, 'GET', '/api/integrations/records', { headers: key });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()).data;
    assert.ok(Array.isArray(data.leads) && data.leads.length >= 1);
    assert.ok(Array.isArray(data.appointments) && data.appointments.length >= 1);
    assert.ok(Array.isArray(data.enquiries) && data.enquiries.length >= 1);
    assert.ok('reference' in data.leads[0] && 'studentName' in data.leads[0]);
    assert.ok(data.generatedAt);
  });

  await test('integration records supports an incremental since filter', async () => {
    const key = { 'x-api-key': 'test-sheets-key', accept: 'application/json' };
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const res = await call(base, 'GET', '/api/integrations/records?since=' + encodeURIComponent(future), { headers: key });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()).data;
    assert.strictEqual(data.leads.length, 0);
    assert.strictEqual(data.appointments.length, 0);
    assert.strictEqual(data.enquiries.length, 0);
  });

  await test('a new website lead is pushed to the Google Sheets webhook', async () => {
    const before = webhookHits.length;
    const res = await call(base, 'POST', '/api/public/leads', {
      json: { studentName: 'Webhook Lead', phone: '9812345699', courseInterest: 'B.Sc Nursing' },
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    assert.strictEqual(res.status, 201);
    for (let i = 0; i < 40 && webhookHits.length === before; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(webhookHits.length > before, 'the webhook never received the lead');
    const hit = webhookHits[webhookHits.length - 1];
    assert.strictEqual(hit.body.kind, 'lead');
    assert.strictEqual(hit.body.record.phone, '9812345699');
    assert.strictEqual(hit.body.record.studentName, 'Webhook Lead');
    assert.match(hit.url, /[?&]key=test-sheets-key/);
  });

  await test('a website enquiry is pushed to the Google Sheets webhook', async () => {
    const before = webhookHits.length;
    const res = await call(base, 'POST', '/api/public/enquiries', {
      json: { name: 'Hook Enq', contact: '9812345688', message: 'Need hostel details.' },
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    assert.strictEqual(res.status, 201);
    for (let i = 0; i < 40 && webhookHits.length === before; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(webhookHits.length > before, 'the webhook never received the enquiry');
    const hit = webhookHits[webhookHits.length - 1];
    assert.strictEqual(hit.body.kind, 'enquiry');
    assert.strictEqual(hit.body.record.name, 'Hook Enq');
  });
}

run()
  .catch((e) => {
    results.push(['suite', 'FAIL', String(e.stack || e)]);
  })
  .finally(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (hookServer) await new Promise((r) => hookServer.close(r));
    try {
      await prisma.$disconnect();
    } catch {}
    for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-journal']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    const pass = results.filter((r) => r[1] === 'PASS').length;
    const fail = results.length - pass;
    console.log('\nSymbiosis — backend tests\n' + '='.repeat(40));
    for (const [name, status, msg] of results)
      console.log((status === 'PASS' ? '  \u2713 ' : '  \u2717 ') + name + (msg ? '  \u2192 ' + msg : ''));
    console.log('='.repeat(40) + `\n${pass} passed, ${fail} failed, ${results.length} total\n`);

    const csv = ['test,status,detail']
      .concat(results.map((r) => [r[0], r[1], '"' + r[2].replace(/"/g, "'") + '"'].join(',')))
      .join('\n');
    fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs/backend_test_results.csv'), csv + '\n');
    process.exit(fail ? 1 : 0);
  });
