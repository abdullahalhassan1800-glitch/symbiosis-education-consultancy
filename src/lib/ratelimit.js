'use strict';
/* Rate limiting.
   • Login: persisted in the DB (LoginAttempt) so brute-force protection survives
     restarts and works across instances.
   • General endpoints: lightweight in-memory sliding window (per instance). */
const prisma = require('../db');
const config = require('../config');
const { fail, clientIp } = require('./http');

async function recordLoginAttempt(email, ip, success) {
  await prisma.loginAttempt.create({
    data: { email: (email || '').toLowerCase(), ip: ip || '', success: !!success },
  });
}

function windowStart() {
  return new Date(Date.now() - config.login.windowMinutes * 60 * 1000);
}

async function failuresFor(where) {
  return prisma.loginAttempt.count({
    where: { success: false, createdAt: { gte: windowStart() }, ...where },
  });
}

/* Count per-email and per-IP separately. The per-email threshold protects a
   single account; the per-IP threshold is deliberately more generous so a
   shared/NAT IP (office, campus) is not locked out by one attacker. */
async function loginLockState(email, ip) {
  const emailFails = email ? await failuresFor({ email: email.toLowerCase() }) : 0;
  const ipFails = ip ? await failuresFor({ ip }) : 0;
  const ipLimit = config.login.maxFailures * 4;
  return {
    locked: emailFails >= config.login.maxFailures || ipFails >= ipLimit,
    emailFails,
    ipFails,
  };
}

function memoryLimiter({ windowMs = 60 * 1000, max = 120 } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const key = clientIp(req) || 'unknown';
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return fail(res, 429, 'rate_limited', 'Too many requests. Please slow down.');
    }
    return next();
  };
}

module.exports = {
  recordLoginAttempt,
  loginLockState,
  memoryLimiter,
};
