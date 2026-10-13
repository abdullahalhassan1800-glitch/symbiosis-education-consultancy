'use strict';
/* Audit logging — best effort; never throws to callers. */
const prisma = require('../db');
const { clientIp, userAgent } = require('./http');

async function log({ userId, actorEmail, action, entity, entityId, meta, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        actorEmail: actorEmail || null,
        action,
        entity: entity || null,
        entityId: entityId != null ? String(entityId) : null,
        meta: meta ? JSON.stringify(meta) : null,
        ip: clientIp(req) || null,
        userAgent: userAgent(req) || null,
      },
    });
  } catch (e) {
    console.error('audit log failed:', e.message);
  }
}

module.exports = { log };
