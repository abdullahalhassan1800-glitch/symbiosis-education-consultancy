'use strict';
/* Public, unauthenticated endpoints used by the marketing website:
     • GET  /api/public/site          — published content for js/app.js
     • GET  /api/public/availability  — active booking slots
     • POST /api/public/leads         — capture a lead
     • POST /api/public/enquiries     — capture a contact enquiry
     • POST /api/public/appointments  — capture a booking request
   Writes are rate limited and honeypot-protected. Nothing sensitive is ever
   placed in a response, and all validation happens server-side. */
const express = require('express');
const content = require('../lib/content');
const crm = require('../lib/crm');
const { ok, fail, wrapRouter, clientIp } = require('../lib/http');
const { memoryLimiter } = require('../lib/ratelimit');

const router = wrapRouter(express.Router());

/* Tighter than the global /api limit — these endpoints are open to the world. */
const writeLimiter = memoryLimiter({ windowMs: 60 * 1000, max: 20 });

/* A hidden field real users never fill in. If it arrives non-empty we pretend
   success (so bots do not learn) but store nothing. */
function isBot(body) {
  return !!(body && typeof body.website === 'string' && body.website.trim() !== '');
}

function cache(res, seconds) {
  res.set('Cache-Control', 'public, max-age=' + seconds);
}

router.get('/api/public/site', async (req, res) => {
  const data = await content.sitePayload();
  cache(res, 30);
  return ok(res, data);
});

router.get('/api/public/availability', async (req, res) => {
  const rows = await crm.listSlots();
  const active = rows.filter((s) => s.active).map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }));
  cache(res, 60);
  return ok(res, active);
});

router.post('/api/public/leads', writeLimiter, async (req, res) => {
  if (isBot(req.body)) return ok(res, { received: true });
  const lead = await crm.createPublicLead(req.body || {});
  return res.status(201).json({ ok: true, data: { reference: lead.reference } });
});

router.post('/api/public/enquiries', writeLimiter, async (req, res) => {
  if (isBot(req.body)) return ok(res, { received: true });
  await crm.createPublicEnquiry(req.body || {}, { ip: clientIp(req) });
  return res.status(201).json({ ok: true, data: { received: true } });
});

router.post('/api/public/appointments', writeLimiter, async (req, res) => {
  if (isBot(req.body)) return ok(res, { received: true });
  const appt = await crm.createPublicAppointment(req.body || {});
  return res.status(201).json({ ok: true, data: { reference: appt.reference, scheduledAt: appt.scheduledAt } });
});

/* A malformed JSON body should be a clean 400, never a stack trace. */
router.use('/api/public', (err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return fail(res, 400, 'bad_request', 'Invalid request body.');
  }
  return next(err);
});

module.exports = router;
