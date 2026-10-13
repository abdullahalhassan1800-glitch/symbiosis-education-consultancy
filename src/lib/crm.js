'use strict';
/* CRM service: student leads, activity timeline, appointments, weekly
   availability slots and contact enquiries. Validation + rules live here. */
const crypto = require('crypto');
const prisma = require('../db');
const sheets = require('./sheets');

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}
function str(v, max = 8000) {
  return v == null ? '' : String(v).trim().slice(0, max);
}
function optStr(v, max = 8000) {
  const s = str(v, max);
  return s ? s : null;
}
function assertEnum(v, allowed, fallback, label) {
  const s = str(v, 40);
  if (!s) {
    if (fallback == null) throw httpError(400, 'validation', 'Invalid ' + label + '.');
    return fallback;
  }
  if (!allowed.includes(s)) throw httpError(400, 'validation', 'Invalid ' + label + '.');
  return s;
}
function parseBool(v) {
  return v === true || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}
function parseDateTime(v, label = 'date') {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw httpError(400, 'validation', 'Invalid ' + label + '.');
  return d;
}
function requireField(v, label, min = 1) {
  const s = str(v, 400);
  if (s.length < min) throw httpError(400, 'validation', label + ' is required.');
  return s;
}
function genRef(prefix) {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return prefix + '-' + ymd + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function phoneOk(v) {
  const digits = String(v || '').replace(/[^0-9]/g, '');
  return digits.length >= 7;
}

const LEAD_STATUS = ['new', 'contacted', 'qualified', 'counselling_scheduled', 'follow_up', 'converted', 'not_interested', 'closed'];
const LEAD_SOURCE = ['website', 'whatsapp', 'instagram', 'referral', 'other'];
const NOTE_KIND = ['note', 'call', 'followup', 'status_change'];
const APPT_STATUS = ['pending', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show'];
const MEETING_TYPE = ['call', 'video', 'in_person', 'whatsapp'];
const ENQ_STATUS = ['new', 'contacted', 'resolved', 'spam'];

/* -------------------------------------------------------------- assignees */
function userOptions() {
  return prisma.user.findMany({ where: { deletedAt: null, status: 'active' }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } });
}

/* ------------------------------------------------------------------ leads */
async function listLeads({ q = '', status = '', assignedToId = '', source = '', skip = 0, take = 20 } = {}) {
  const where = { deletedAt: null };
  if (q) where.OR = [{ studentName: { contains: q } }, { phone: { contains: q } }, { reference: { contains: q } }, { email: { contains: q } }];
  if (status) where.status = status;
  if (assignedToId) where.assignedToId = assignedToId === 'unassigned' ? null : assignedToId;
  if (source) where.source = source;
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { assignedTo: { select: { name: true } }, _count: { select: { followUps: true } } } }),
  ]);
  return { total, rows };
}
function getLead(id) {
  return prisma.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true } },
      followUps: { orderBy: { createdAt: 'desc' } },
      appointments: { orderBy: { scheduledAt: 'desc' } },
    },
  });
}
function leadInput(body, actor) {
  return {
    studentName: requireField(body.studentName, 'Student name', 2),
    phone: requireField(body.phone, 'Phone number', 5),
    whatsapp: optStr(body.whatsapp, 40),
    email: optStr(body.email, 254),
    city: optStr(body.city, 120),
    qualification: optStr(body.qualification, 200),
    courseInterest: optStr(body.courseInterest, 200),
    countryInterest: optStr(body.countryInterest, 120),
    neetScore: optStr(body.neetScore, 40),
    source: assertEnum(body.source, LEAD_SOURCE, 'other', 'source'),
    consentStatus: parseBool(body.consentStatus),
    status: assertEnum(body.status, LEAD_STATUS, 'new', 'status'),
    notes: optStr(body.notes, 8000),
  };
}
async function createLead(body, actor) {
  const data = leadInput(body, actor);
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw httpError(400, 'validation', 'Enter a valid email address.');
  const lead = await prisma.lead.create({ data: { ...data, assignedToId: optStr(body.assignedToId, 40) } });
  await prisma.leadNote.create({ data: { leadId: lead.id, authorId: actor.id, body: 'Lead created.', kind: 'status_change' } });
  return lead;
}
async function updateLead(id, body, actor, { canAssign }) {
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw httpError(404, 'not_found', 'Lead not found.');
  const data = leadInput(body, actor);
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw httpError(400, 'validation', 'Enter a valid email address.');
  const patch = { ...data, lastContactAt: new Date() };
  if (canAssign) patch.assignedToId = optStr(body.assignedToId, 40) || null;
  if (data.status !== lead.status) {
    await prisma.leadNote.create({ data: { leadId: id, authorId: actor.id, body: `Status: ${lead.status} → ${data.status}`, kind: 'status_change' } });
  }
  return prisma.lead.update({ where: { id }, data: patch });
}
async function setLeadStatus(id, status, actor) {
  assertEnum(status, LEAD_STATUS, null, 'status');
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw httpError(404, 'not_found', 'Lead not found.');
  if (lead.status !== status) await prisma.leadNote.create({ data: { leadId: id, authorId: actor.id, body: `Status: ${lead.status} → ${status}`, kind: 'status_change' } });
  return prisma.lead.update({ where: { id }, data: { status, lastContactAt: new Date() } });
}
async function addLeadNote(id, body, actor) {
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw httpError(404, 'not_found', 'Lead not found.');
  const text = requireField(body.body, 'Note', 2);
  const kind = assertEnum(body.kind, NOTE_KIND.filter((k) => k !== 'status_change'), 'note', 'note type');
  return prisma.leadNote.create({ data: { leadId: id, authorId: actor.id, body: text, kind } });
}
async function assignLead(id, assignedToId, actor) {
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw httpError(404, 'not_found', 'Lead not found.');
  let name = 'Unassigned';
  if (assignedToId) {
    const u = await prisma.user.findFirst({ where: { id: assignedToId, deletedAt: null } });
    if (!u) throw httpError(400, 'validation', 'Assignee not found.');
    name = u.name;
  }
  await prisma.leadNote.create({ data: { leadId: id, authorId: actor.id, body: `Assigned to ${name}.`, kind: 'status_change' } });
  return prisma.lead.update({ where: { id }, data: { assignedToId: assignedToId || null } });
}
async function deleteLead(id) {
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw httpError(404, 'not_found', 'Lead not found.');
  await prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ----------------------------------------------------------- appointments */
async function listAppointments({ status = '', assignedToId = '', from = '', to = '', skip = 0, take = 20 } = {}) {
  const where = {};
  if (status) where.status = status;
  if (assignedToId) where.assignedToId = assignedToId === 'unassigned' ? null : assignedToId;
  if (from || to) {
    where.scheduledAt = {};
    if (from) where.scheduledAt.gte = new Date(from);
    if (to) where.scheduledAt.lte = new Date(to + 'T23:59:59');
  }
  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, orderBy: { scheduledAt: 'desc' }, skip, take, include: { assignedTo: { select: { name: true } }, lead: { select: { id: true, studentName: true } } } }),
  ]);
  return { total, rows };
}
function getAppointment(id) {
  return prisma.appointment.findUnique({ where: { id }, include: { assignedTo: { select: { id: true, name: true } }, lead: { select: { id: true, studentName: true, reference: true } } } });
}
function apptInput(body) {
  const scheduledAt = parseDateTime(body.scheduledAt, 'date & time');
  if (!scheduledAt) throw httpError(400, 'validation', 'Date & time is required.');
  return {
    studentName: requireField(body.studentName, 'Student name', 2),
    contactNumber: requireField(body.contactNumber, 'Contact number', 5),
    email: optStr(body.email, 254),
    courseInterest: optStr(body.courseInterest, 200),
    scheduledAt,
    timezone: str(body.timezone, 64) || 'Asia/Kolkata',
    meetingType: assertEnum(body.meetingType, MEETING_TYPE, 'call', 'meeting type'),
    status: assertEnum(body.status, APPT_STATUS, 'pending', 'status'),
    notes: optStr(body.notes, 8000),
  };
}
async function createAppointment(body, actor) {
  const data = apptInput(body);
  return prisma.appointment.create({
    data: { ...data, reference: genRef('APT'), assignedToId: optStr(body.assignedToId, 40), leadId: optStr(body.leadId, 40), createdById: actor.id },
  });
}
async function updateAppointment(id, body, actor) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw httpError(404, 'not_found', 'Appointment not found.');
  const data = apptInput(body);
  return prisma.appointment.update({ where: { id }, data: { ...data, assignedToId: optStr(body.assignedToId, 40), leadId: optStr(body.leadId, 40) } });
}
async function setAppointmentStatus(id, status, actor) {
  assertEnum(status, APPT_STATUS, null, 'status');
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw httpError(404, 'not_found', 'Appointment not found.');
  return prisma.appointment.update({ where: { id }, data: { status } });
}
async function deleteAppointment(id) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw httpError(404, 'not_found', 'Appointment not found.');
  await prisma.appointment.delete({ where: { id } });
}
async function leadsForPicker(q = '') {
  const where = { deletedAt: null };
  if (q) where.OR = [{ studentName: { contains: q } }, { phone: { contains: q } }];
  return prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, studentName: true, phone: true, reference: true } });
}

/* ------------------------------------------------------------ availability */
function listSlots() {
  return prisma.availabilitySlot.findMany({ orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
}
function parseTime(v, label) {
  const s = str(v, 5);
  if (!/^\d{2}:\d{2}$/.test(s)) throw httpError(400, 'validation', 'Invalid ' + label + ' (use HH:MM).');
  return s;
}
async function addSlot(body) {
  const weekday = parseInt(body.weekday, 10);
  if (!(weekday >= 0 && weekday <= 6)) throw httpError(400, 'validation', 'Invalid weekday.');
  const startTime = parseTime(body.startTime, 'start time');
  const endTime = parseTime(body.endTime, 'end time');
  if (endTime <= startTime) throw httpError(400, 'validation', 'End time must be after start time.');
  try {
    return await prisma.availabilitySlot.create({ data: { weekday, startTime, endTime, active: body.active === undefined ? true : parseBool(body.active) } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'That slot already exists.');
    throw e;
  }
}
async function toggleSlot(id) {
  const slot = await prisma.availabilitySlot.findUnique({ where: { id } });
  if (!slot) throw httpError(404, 'not_found', 'Slot not found.');
  return prisma.availabilitySlot.update({ where: { id }, data: { active: !slot.active } });
}
async function deleteSlot(id) {
  const slot = await prisma.availabilitySlot.findUnique({ where: { id } });
  if (!slot) throw httpError(404, 'not_found', 'Slot not found.');
  await prisma.availabilitySlot.delete({ where: { id } });
}

/* -------------------------------------------------------------- enquiries */
async function listEnquiries({ q = '', status = '', assignedToId = '', skip = 0, take = 20 } = {}) {
  const where = {};
  if (q) where.OR = [{ name: { contains: q } }, { contact: { contains: q } }, { subject: { contains: q } }, { email: { contains: q } }];
  if (status) where.status = status;
  if (assignedToId) where.assignedToId = assignedToId === 'unassigned' ? null : assignedToId;
  const [total, rows] = await Promise.all([
    prisma.contactEnquiry.count({ where }),
    prisma.contactEnquiry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { assignedTo: { select: { name: true } } } }),
  ]);
  return { total, rows };
}
function getEnquiry(id) {
  return prisma.contactEnquiry.findUnique({ where: { id }, include: { assignedTo: { select: { id: true, name: true } } } });
}
async function updateEnquiry(id, body, actor) {
  const enq = await prisma.contactEnquiry.findUnique({ where: { id } });
  if (!enq) throw httpError(404, 'not_found', 'Enquiry not found.');
  return prisma.contactEnquiry.update({
    where: { id },
    data: {
      status: assertEnum(body.status, ENQ_STATUS, 'new', 'status'),
      notes: optStr(body.notes, 8000),
      assignedToId: optStr(body.assignedToId, 40),
    },
  });
}
async function deleteEnquiry(id) {
  const enq = await prisma.contactEnquiry.findUnique({ where: { id } });
  if (!enq) throw httpError(404, 'not_found', 'Enquiry not found.');
  await prisma.contactEnquiry.delete({ where: { id } });
}

/* ====================================================== public intake (website)
   These are called from unauthenticated website forms. They are deliberate
   about what they accept: source/status are forced server-side, no assignment
   is possible, and no CRM internals are exposed in the response. */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function createPublicLead(body) {
  const data = leadInput({ ...body, source: 'website', status: 'new' }, { id: null });
  if (data.email && !EMAIL_RE.test(data.email)) throw httpError(400, 'validation', 'Enter a valid email address.');
  if (!phoneOk(data.phone)) throw httpError(400, 'validation', 'Enter a valid phone number.');
  const lead = await prisma.lead.create({ data: { ...data, assignedToId: null } });
  await prisma.leadNote.create({ data: { leadId: lead.id, authorId: null, body: 'Captured from the website.', kind: 'status_change' } });
  sheets.notify('lead', {
    reference: lead.reference, studentName: lead.studentName, phone: lead.phone, email: lead.email,
    courseInterest: lead.courseInterest, source: lead.source, status: lead.status, createdAt: lead.createdAt,
  });
  return lead;
}

async function createPublicEnquiry(body, { ip } = {}) {
  const name = requireField(body.name, 'Name', 2);
  const contact = requireField(body.contact, 'Contact number', 5);
  const message = requireField(body.message, 'Message', 5);
  const email = optStr(body.email, 254);
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'validation', 'Enter a valid email address.');
  const enq = await prisma.contactEnquiry.create({
    data: {
      name,
      contact,
      email,
      subject: optStr(body.subject, 200),
      message: str(message, 4000),
      sourcePage: optStr(body.sourcePage, 200),
      consentStatus: parseBool(body.consentStatus),
      status: 'new',
      ip: optStr(ip, 60),
    },
  });
  sheets.notify('enquiry', {
    id: enq.id, name: enq.name, contact: enq.contact, email: enq.email, subject: enq.subject,
    message: enq.message, sourcePage: enq.sourcePage, status: enq.status, createdAt: enq.createdAt,
  });
  return enq;
}

/* A website booking also becomes a lead (matched by phone), so it appears in
   the pipeline as "counselling scheduled" without any manual data entry. */
async function createPublicAppointment(body) {
  const scheduledAt = parseDateTime(body.scheduledAt, 'date & time');
  if (!scheduledAt) throw httpError(400, 'validation', 'Please choose a date and time.');
  if (scheduledAt.getTime() < Date.now()) throw httpError(400, 'validation', 'Please choose a future date and time.');
  const studentName = requireField(body.studentName, 'Name', 2);
  const contactNumber = requireField(body.contactNumber, 'Contact number', 5);
  if (!phoneOk(contactNumber)) throw httpError(400, 'validation', 'Enter a valid phone number.');
  const email = optStr(body.email, 254);
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'validation', 'Enter a valid email address.');
  const meetingType = assertEnum(body.meetingType, MEETING_TYPE, 'call', 'meeting type');
  const courseInterest = optStr(body.courseInterest, 200);

  const appt = await prisma.appointment.create({
    data: {
      reference: genRef('APT'),
      studentName,
      contactNumber,
      email,
      courseInterest,
      scheduledAt,
      timezone: str(body.timezone, 64) || 'Asia/Kolkata',
      meetingType,
      status: 'pending',
      notes: optStr(body.notes, 2000),
    },
  });

  let lead = await prisma.lead.findFirst({ where: { phone: contactNumber, deletedAt: null } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: { studentName, phone: contactNumber, email, courseInterest, source: 'website', consentStatus: parseBool(body.consentStatus), status: 'counselling_scheduled' },
    });
    await prisma.leadNote.create({ data: { leadId: lead.id, authorId: null, body: 'Lead created from a website booking.', kind: 'status_change' } });
  }
  const saved = await prisma.appointment.update({ where: { id: appt.id }, data: { leadId: lead.id } });
  sheets.notify('appointment', {
    reference: saved.reference, studentName: saved.studentName, contactNumber: saved.contactNumber,
    email: saved.email, courseInterest: saved.courseInterest, scheduledAt: saved.scheduledAt,
    timezone: saved.timezone, meetingType: saved.meetingType, status: saved.status,
  });
  return saved;
}

module.exports = {
  httpError, phoneOk, genRef,
  LEAD_STATUS, LEAD_SOURCE, NOTE_KIND, APPT_STATUS, MEETING_TYPE, ENQ_STATUS,
  userOptions,
  listLeads, getLead, createLead, updateLead, setLeadStatus, addLeadNote, assignLead, deleteLead, leadsForPicker,
  listAppointments, getAppointment, createAppointment, updateAppointment, setAppointmentStatus, deleteAppointment,
  listSlots, addSlot, toggleSlot, deleteSlot,
  listEnquiries, getEnquiry, updateEnquiry, deleteEnquiry,
  createPublicLead, createPublicEnquiry, createPublicAppointment,
};
