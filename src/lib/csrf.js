'use strict';
/* CSRF protection.
   • Authenticated requests: synchronizer-token — the hidden/`x-csrf-token`
     value must equal the token bound to the server-side session.
   • Unauthenticated forms (login / forgot): double-submit — a random cookie is
     mirrored into a hidden field and compared. */
const config = require('../config');
const { randomToken, timingSafeEqualStr } = require('./tokens');
const { fail } = require('./http');

function issueAnonToken(res) {
  const token = randomToken(24);
  res.cookie(config.session.csrfCookieName, token, {
    httpOnly: false,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: '/',
    maxAge: 3600 * 1000,
  });
  return token;
}

function submittedToken(req) {
  return (
    (req.body && (req.body._csrf || req.body.csrfToken)) ||
    req.headers['x-csrf-token'] ||
    ''
  );
}

function valid(req) {
  const given = submittedToken(req);
  if (!given) return false;
  if (req.session && req.session.csrfToken) {
    return timingSafeEqualStr(given, req.session.csrfToken);
  }
  const cookie = req.cookies ? req.cookies[config.session.csrfCookieName] : '';
  return cookie ? timingSafeEqualStr(given, cookie) : false;
}

function requireCsrf(req, res, next) {
  if (valid(req)) return next();
  return fail(res, 403, 'csrf', 'Invalid or missing CSRF token.');
}

module.exports = { issueAnonToken, requireCsrf, valid };
