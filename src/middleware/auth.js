'use strict';
/* Authentication / authorisation middleware. Every protected route passes
   through requireAuth and (where relevant) requirePermission, enforced on the
   server — hiding UI is never treated as security. */
const config = require('../config');
const sessionLib = require('../lib/session');
const rbac = require('../lib/rbac');
const { fail, wantsJson } = require('../lib/http');

async function attachUser(req, res, next) {
  try {
    const token = req.cookies ? req.cookies[config.session.cookieName] : null;
    const s = await sessionLib.resolveSession(token);
    if (s && s.user && s.user.status === 'active' && !s.user.deletedAt) {
      req.session = s;
      req.user = s.user;
      req.permissions = new Set(
        s.user.role.permissions.map((rp) => rp.permission.key)
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return fail(res, 401, 'unauthenticated', 'Authentication required.');
  const next_url = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect('/admin/login?next=' + next_url);
}

function deny(req, res, message) {
  if (wantsJson(req)) return fail(res, 403, 'forbidden', message || 'Forbidden.');
  return res.status(403).type('html').send(
    '<!doctype html><meta name="robots" content="noindex"><title>403</title>' +
      '<h1>403 — Forbidden</h1><p>' + (message || 'You do not have permission for this action.') +
      '</p><p><a href="/admin">Back to dashboard</a></p>'
  );
}

function requirePermission(key) {
  return function (req, res, next) {
    if (!req.user) {
      if (wantsJson(req)) return fail(res, 401, 'unauthenticated', 'Authentication required.');
      const next_url = encodeURIComponent(req.originalUrl || '/admin');
      return res.redirect('/admin/login?next=' + next_url);
    }
    if (rbac.roleHasPermission(req.user.role.key, req.permissions, key)) return next();
    return deny(req, res);
  };
}

function requireRole(...keys) {
  return function (req, res, next) {
    if (!req.user) return requireAuth(req, res, next);
    if (keys.includes(req.user.role.key)) return next();
    return deny(req, res);
  };
}

module.exports = { attachUser, requireAuth, requirePermission, requireRole, deny };
