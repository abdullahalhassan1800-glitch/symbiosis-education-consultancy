'use strict';
const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { hashPassword, verifyPassword, checkPasswordPolicy } = require('../lib/password');
const { randomToken, sha256 } = require('../lib/tokens');
const sessionLib = require('../lib/session');
const csrf = require('../lib/csrf');
const audit = require('../lib/audit');
const mailer = require('../lib/mail');
const { loginLockState, recordLoginAttempt } = require('../lib/ratelimit');
const { fail, wantsJson, clientIp, wrapRouter } = require('../lib/http');
const { authLayout, esc } = require('../lib/render');
const { requireAuth } = require('../middleware/auth');

const router = wrapRouter(express.Router());

function safeNext(v) {
  const s = String(v || '');
  return s.startsWith('/admin') ? s : '/admin';
}

function loginCard({ csrfToken, next, email, error }) {
  return authLayout({
    title: 'Sign in',
    flash: error ? { kind: 'error', message: error } : null,
    body: `
    <div class="auth-brand">
      <svg class="brand-mark lg" aria-hidden="true"><use href="#mark"/></svg>
      <b>SYMBIOSIS</b>
      <small>Admin console</small>
    </div>
    <h1 class="auth-title">Welcome back</h1>
    <p class="auth-sub">Sign in to manage courses, leads and website content.</p>
    <form method="post" action="/admin/login" class="auth-form" id="loginForm" novalidate data-loading-label="Signing in…">
      <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
      <input type="hidden" name="next" value="${esc(safeNext(next))}">
      <label class="field">
        <span>Email address</span>
        <input type="email" name="email" autocomplete="username" required value="${esc(email || '')}" placeholder="you@example.com">
      </label>
      <label class="field">
        <span>Password</span>
        <span class="pw">
          <input type="password" name="password" id="password" autocomplete="current-password" required minlength="1" placeholder="Your password">
          <button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password" aria-pressed="false">Show</button>
        </span>
      </label>
      <button class="btn btn-gold btn-block" type="submit"><span class="btn-label">Sign in</span></button>
      <p class="auth-links"><a href="/admin/forgot">Forgot password?</a></p>
    </form>`,
  });
}

/* ---- shared credential check ---- */
async function attemptLogin(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const ip = clientIp(req);
  const json = wantsJson(req);
  const next = safeNext(req.body.next);

  if (!email || !password) {
    if (json) return fail(res, 400, 'validation', 'Enter your email and password.');
    return res
      .status(400)
      .send(loginCard({ csrfToken: csrf.issueAnonToken(res), next, email, error: 'Enter your email and password.' }));
  }

  const lock = await loginLockState(email, ip);
  if (lock.locked) {
    await audit.log({ action: 'auth.login_locked', actorEmail: email, req });
    const msg = 'Too many failed attempts. Please try again shortly.';
    if (json) return fail(res, 429, 'locked', msg);
    return res.status(429).send(loginCard({ csrfToken: csrf.issueAnonToken(res), next, email, error: msg }));
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  // Always run a hash comparison to reduce user-enumeration timing signal.
  const stored = user ? user.passwordHash : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==';
  const passwordOk = await verifyPassword(password, stored).catch(() => false);
  const accountOk = user && !user.deletedAt && user.status === 'active';
  const lockedNow = user && user.lockedUntil && user.lockedUntil.getTime() > Date.now();

  if (!user || !passwordOk || !accountOk || lockedNow) {
    await recordLoginAttempt(email, ip, false);
    await audit.log({ action: 'auth.login_failed', actorEmail: email, userId: user ? user.id : null, req });
    const msg = 'Invalid email or password.'; // generic — never reveals which
    if (json) return fail(res, 401, 'invalid_credentials', msg);
    return res.status(401).send(loginCard({ csrfToken: csrf.issueAnonToken(res), next, email, error: msg }));
  }

  // success
  await recordLoginAttempt(email, ip, true);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  const sess = await sessionLib.createSession(user.id, req);
  sessionLib.setSessionCookie(res, sess.token);
  await audit.log({
    action: 'auth.login',
    actorEmail: user.email,
    userId: user.id,
    entity: 'User',
    entityId: user.id,
    req,
  });

  if (json)
    return res.json({
      ok: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role.key },
        csrfToken: sess.csrfToken, // session-bound token for subsequent state-changing calls
      },
    });
  return res.redirect(next);
}

/* ---- pages + endpoints ---- */
router.get('/admin/login', async (req, res) => {
  if (req.user) return res.redirect('/admin');
  const token = csrf.issueAnonToken(res);
  res.send(loginCard({ csrfToken: token, next: req.query.next || '/admin' }));
});

router.post('/admin/login', csrf.requireCsrf, attemptLogin);
router.post('/api/admin/auth/login', csrf.requireCsrf, attemptLogin);

/* logout */
async function doLogout(req, res) {
  if (req.session) {
    await sessionLib.revokeSession(req.session.id);
    await audit.log({ action: 'auth.logout', actorEmail: req.user ? req.user.email : null, userId: req.user ? req.user.id : null, req });
  }
  sessionLib.clearSessionCookie(res);
  if (wantsJson(req)) return res.json({ ok: true, data: { loggedOut: true } });
  return res.redirect('/admin/login');
}
router.post('/admin/logout', csrf.requireCsrf, doLogout);
router.post('/api/admin/auth/logout', csrf.requireCsrf, doLogout);

/* forgot password */
function forgotCard({ csrfToken, message, error }) {
  return authLayout({
    title: 'Reset password',
    flash: error ? { kind: 'error', message: error } : message ? { kind: 'ok', message } : null,
    body: `
    <div class="auth-brand">
      <svg class="brand-mark lg" aria-hidden="true"><use href="#mark"/></svg>
      <b>SYMBIOSIS</b>
      <small>Admin console</small>
    </div>
    <h1 class="auth-title">Reset password</h1>
    <p class="auth-sub">Enter your email and we'll send a reset link.</p>
    <form method="post" action="/admin/forgot" class="auth-form" novalidate>
      <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
      <label class="field"><span>Email address</span>
        <input type="email" name="email" required placeholder="you@example.com"></label>
      <button class="btn btn-gold btn-block" type="submit"><span class="btn-label">Send reset link</span></button>
      <p class="auth-links"><a href="/admin/login">Back to sign in</a></p>
    </form>`,
  });
}

router.get('/admin/forgot', (req, res) => {
  res.send(forgotCard({ csrfToken: csrf.issueAnonToken(res) }));
});

router.post('/admin/forgot', csrf.requireCsrf, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const generic = 'If that email is registered, a reset link has been sent.';
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'active' && !user.deletedAt) {
      const token = randomToken(32);
      await prisma.passwordResetToken.create({
        data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const url = `${config.appOrigin.replace(/\/$/, '')}/admin/reset/${token}`;
      await mailer.sendMail({ to: email, subject: 'Reset your Symbiosis admin password', text: `Reset link (valid 60 min): ${url}` });
      await audit.log({ action: 'auth.reset_requested', actorEmail: email, userId: user.id, req });
    }
  }
  return res.send(forgotCard({ csrfToken: csrf.issueAnonToken(res), message: generic }));
});

/* reset password */
function resetCard({ csrfToken, token, error }) {
  return authLayout({
    title: 'Choose a new password',
    flash: error ? { kind: 'error', message: error } : null,
    body: `
    <div class="auth-brand">
      <svg class="brand-mark lg" aria-hidden="true"><use href="#mark"/></svg>
      <b>SYMBIOSIS</b>
      <small>Admin console</small>
    </div>
    <h1 class="auth-title">Choose a new password</h1>
    <p class="auth-sub">Set a strong password to secure your account.</p>
    <form method="post" action="/admin/reset" class="auth-form" novalidate>
      <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
      <input type="hidden" name="token" value="${esc(token)}">
      <label class="field"><span>New password</span>
        <input type="password" name="password" autocomplete="new-password" required minlength="10"></label>
      <label class="field"><span>Confirm new password</span>
        <input type="password" name="confirm" autocomplete="new-password" required minlength="10"></label>
      <p class="hint">At least 10 characters, with upper & lower case and a number.</p>
      <button class="btn btn-gold btn-block" type="submit"><span class="btn-label">Update password</span></button>
    </form>`,
  });
}

router.get('/admin/reset/:token', (req, res) => {
  res.send(resetCard({ csrfToken: csrf.issueAnonToken(res), token: req.params.token }));
});

router.post('/admin/reset', csrf.requireCsrf, async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const show = (error) => res.status(400).send(resetCard({ csrfToken: csrf.issueAnonToken(res), token, error }));

  if (password !== confirm) return show('Passwords do not match.');
  const pol = checkPasswordPolicy(password);
  if (!pol.ok) return show('Password needs ' + pol.errors.join(', ') + '.');

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return show('This reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, mustChangePassword: false } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await sessionLib.revokeAllForUser(record.userId);
  await audit.log({ action: 'auth.reset_completed', entity: 'User', entityId: record.userId, req });
  res.redirect('/admin/login?reset=1');
});

module.exports = router;
