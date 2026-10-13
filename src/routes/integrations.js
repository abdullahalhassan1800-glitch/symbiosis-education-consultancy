'use strict';
/* Read-only integration API for external tools (e.g. a Google Sheets sync).
   Protected by a shared key in the `x-api-key` header (SHEETS_SYNC_KEY env).
   Returns CRM records so a spreadsheet can mirror them automatically. */
const express = require('express');
const crypto = require('crypto');
const prisma = require('../db');
const config = require('../config');
const { ok, fail, wrapRouter } = require('../lib/http');
const { memoryLimiter } = require('../lib/ratelimit');

const router = wrapRouter(express.Router());

const readLimiter = memoryLimiter({ windowMs: 60 * 1000, max: 120 });

function keyOk(req) {
  const expected = config.integration.sheetsKey;
  if (!expected) return false;
  const provided = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseSince(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get('/api/integrations/records', readLimiter, async (req, res) => {
  if (!config.integration.sheetsKey) {
    return fail(res, 503, 'not_configured', 'Integration API is not configured (set SHEETS_SYNC_KEY).');
  }
  if (!keyOk(req)) {
    return fail(res, 401, 'unauthorized', 'A valid x-api-key header is required.');
  }

  const since = parseSince(req.query.since);
  const where = since ? { updatedAt: { gt: since } } : {};
  const [leads, appointments, enquiries] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { assignedTo: { select: { name: true } } },
    }),
    prisma.appointment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { assignedTo: { select: { name: true } } },
    }),
    prisma.contactEnquiry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { assignedTo: { select: { name: true } } },
    }),
  ]);

  return ok(res, {
    generatedAt: new Date().toISOString(),
    since: since ? since.toISOString() : null,
    leads: leads.map((l) => ({
      reference: l.reference,
      studentName: l.studentName,
      phone: l.phone,
      whatsapp: l.whatsapp,
      email: l.email,
      city: l.city,
      qualification: l.qualification,
      courseInterest: l.courseInterest,
      countryInterest: l.countryInterest,
      neetScore: l.neetScore,
      source: l.source,
      status: l.status,
      assignedTo: l.assignedTo ? l.assignedTo.name : '',
      notes: l.notes,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
    appointments: appointments.map((a) => ({
      reference: a.reference,
      studentName: a.studentName,
      contactNumber: a.contactNumber,
      email: a.email,
      courseInterest: a.courseInterest,
      scheduledAt: a.scheduledAt,
      timezone: a.timezone,
      meetingType: a.meetingType,
      status: a.status,
      assignedTo: a.assignedTo ? a.assignedTo.name : '',
      notes: a.notes,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    enquiries: enquiries.map((e) => ({
      id: e.id,
      name: e.name,
      contact: e.contact,
      email: e.email,
      subject: e.subject,
      message: e.message,
      sourcePage: e.sourcePage,
      status: e.status,
      assignedTo: e.assignedTo ? e.assignedTo.name : '',
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
  });
});

/* Lightweight health check — confirms the key works without pulling data. */
router.get('/api/integrations/ping', readLimiter, (req, res) => {
  if (!config.integration.sheetsKey) return fail(res, 503, 'not_configured', 'Integration API is not configured.');
  if (!keyOk(req)) return fail(res, 401, 'unauthorized', 'A valid x-api-key header is required.');
  return ok(res, { ok: true, service: 'symbiosis-integrations', time: new Date().toISOString() });
});

module.exports = router;
