'use strict';
/* Server-managed sessions. The cookie carries an opaque random token; only its
   SHA-256 hash is stored. Sessions can be revoked and expire. */
const prisma = require('../db');
const config = require('../config');
const { randomToken, sha256 } = require('./tokens');
const { clientIp, userAgent } = require('./http');

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: '/',
    maxAge: config.session.ttlHours * 3600 * 1000,
  };
}

const userInclude = {
  user: {
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
};

async function createSession(userId, req) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + config.session.ttlHours * 3600 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      csrfToken,
      expiresAt,
      ip: clientIp(req) || null,
      userAgent: userAgent(req) || null,
    },
  });
  return { token, csrfToken, expiresAt };
}

async function resolveSession(token) {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: userInclude,
  });
  if (!s) return null;
  if (s.revokedAt) return null;
  if (s.expiresAt.getTime() <= Date.now()) return null;
  return s;
}

async function touchSession(id) {
  await prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
}

async function revokeSession(id) {
  await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
}

async function revokeAllForUser(userId) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function purgeExpired() {
  await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] },
  });
}

function setSessionCookie(res, token) {
  res.cookie(config.session.cookieName, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, { path: '/' });
}

module.exports = {
  createSession,
  resolveSession,
  touchSession,
  revokeSession,
  revokeAllForUser,
  purgeExpired,
  setSessionCookie,
  clearSessionCookie,
  cookieOptions,
};
