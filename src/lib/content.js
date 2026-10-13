'use strict';
/* Website CMS service: editable site content (WebsiteContent + revisions),
   FAQs, the media library and key/value settings. It also assembles the public
   payload consumed by js/app.js (`sitePayload`), mapping database records into
   the shapes the static frontend already renders. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../db');
const config = require('../config');

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

const CONTENT_TYPE = ['text', 'html', 'url', 'list'];
const CONTENT_STATUS = ['draft', 'published'];
const FAQ_STATUS = ['draft', 'published'];

/* Keys the public site understands (used as suggestions in the admin UI and as
   the allow-list for the settings form). */
const CONTENT_KEYS = [
  'home.hero.eyebrow',
  'home.hero.title',
  'home.hero.subtitle',
  'home.about.body',
  'home.cta.label',
  'contact.session',
  'contact.phoneDisplay',
  'contact.whatsapp',
  'contact.bio',
  'contact.tagline',
];

const SETTING_KEYS = [
  { key: 'contact.session', label: 'Admissions session (e.g. 2026–27)' },
  { key: 'contact.phone', label: 'Phone — dial (digits only, e.g. 8200691036)' },
  { key: 'contact.phoneDisplay', label: 'Phone — display (e.g. +91 82006 91036)' },
  { key: 'contact.whatsapp', label: 'WhatsApp — wa.me number (digits, e.g. 917284913204)' },
  { key: 'contact.instagram', label: 'Instagram handle (without @)' },
  { key: 'contact.instagramUrl', label: 'Instagram URL' },
  { key: 'contact.bio', label: 'Short bio' },
  { key: 'contact.tagline', label: 'Tagline' },
];

/* ------------------------------------------------------------- primitives */
function inr(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}
function money(amount, currency) {
  if (amount == null) return 'On counselling';
  return inr(amount) + (currency && currency !== 'INR' ? ' ' + currency : '');
}

/* Reads a JSON string[] (used for stored lists). */
function readList(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/* ============================================================ WebsiteContent */
async function listContent({ q = '', status = '', skip = 0, take = 25 } = {}) {
  const where = {};
  if (q) where.OR = [{ key: { contains: q } }, { value: { contains: q } }];
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.websiteContent.count({ where }),
    prisma.websiteContent.findMany({ where, orderBy: { key: 'asc' }, skip, take, include: { updatedBy: { select: { name: true } }, _count: { select: { revisions: true } } } }),
  ]);
  return { total, rows };
}
function getContent(id) {
  return prisma.websiteContent.findUnique({ where: { id }, include: { updatedBy: { select: { name: true } }, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } } });
}
function contentInput(body) {
  return {
    key: str(body.key, 120).toLowerCase(),
    value: str(body.value, 20000),
    type: assertEnum(body.type, CONTENT_TYPE, 'text', 'type'),
    status: assertEnum(body.status, CONTENT_STATUS, 'draft', 'status'),
  };
}
async function saveContent(body, actor) {
  const data = contentInput(body);
  if (!data.key) throw httpError(400, 'validation', 'A content key is required.');
  if (data.type !== 'text' && data.type !== 'list' && !data.value) throw httpError(400, 'validation', 'Value is required.');
  const existing = await prisma.websiteContent.findUnique({ where: { key: data.key } });
  if (!existing) {
    const created = await prisma.websiteContent.create({ data: { ...data, updatedById: actor.id } });
    await prisma.contentRevision.create({ data: { contentId: created.id, value: created.value, status: created.status, changedById: actor.id } });
    return created;
  }
  if (existing.value !== data.value || existing.status !== data.status || existing.type !== data.type) {
    await prisma.contentRevision.create({ data: { contentId: existing.id, value: existing.value, status: existing.status, changedById: actor.id } });
  }
  return prisma.websiteContent.update({ where: { id: existing.id }, data: { ...data, updatedById: actor.id } });
}
async function updateContent(id, body, actor) {
  const existing = await prisma.websiteContent.findUnique({ where: { id } });
  if (!existing) throw httpError(404, 'not_found', 'Content entry not found.');
  const data = contentInput(body);
  if (!data.key) throw httpError(400, 'validation', 'A content key is required.');
  if (existing.value !== data.value || existing.status !== data.status) {
    await prisma.contentRevision.create({ data: { contentId: id, value: existing.value, status: existing.status, changedById: actor.id } });
  }
  try {
    return await prisma.websiteContent.update({ where: { id }, data: { ...data, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'Another entry already uses that key.');
    throw e;
  }
}
async function setContentStatus(id, status, actor) {
  assertEnum(status, CONTENT_STATUS, null, 'status');
  const existing = await prisma.websiteContent.findUnique({ where: { id } });
  if (!existing) throw httpError(404, 'not_found', 'Content entry not found.');
  if (existing.status !== status) {
    await prisma.contentRevision.create({ data: { contentId: id, value: existing.value, status: existing.status, changedById: actor.id } });
  }
  return prisma.websiteContent.update({ where: { id }, data: { status, updatedById: actor.id } });
}
async function deleteContent(id) {
  const existing = await prisma.websiteContent.findUnique({ where: { id } });
  if (!existing) throw httpError(404, 'not_found', 'Content entry not found.');
  await prisma.websiteContent.delete({ where: { id } });
}
function listRevisions(contentId) {
  return prisma.contentRevision.findMany({ where: { contentId }, orderBy: { createdAt: 'desc' } });
}
async function publishedContent() {
  const rows = await prisma.websiteContent.findMany({ where: { status: 'published' } });
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

/* ==================================================================== FAQs */
async function listFaqs({ q = '', status = '', skip = 0, take = 50 } = {}) {
  const where = {};
  if (q) where.OR = [{ question: { contains: q } }, { answer: { contains: q } }];
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.faq.count({ where }),
    prisma.faq.findMany({ where, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], skip, take }),
  ]);
  return { total, rows };
}
function getFaq(id) {
  return prisma.faq.findUnique({ where: { id } });
}
function faqInput(body) {
  return {
    question: str(body.question, 400),
    answer: str(body.answer, 4000),
    category: optStr(body.category, 80),
    status: assertEnum(body.status, FAQ_STATUS, 'draft', 'status'),
  };
}
async function createFaq(body, actor) {
  const data = faqInput(body);
  if (data.question.length < 5) throw httpError(400, 'validation', 'A question is required.');
  if (data.answer.length < 2) throw httpError(400, 'validation', 'An answer is required.');
  const last = await prisma.faq.findFirst({ orderBy: { position: 'desc' }, select: { position: true } });
  const position = last ? last.position + 1 : 0;
  return prisma.faq.create({ data: { ...data, position, createdById: actor.id, updatedById: actor.id } });
}
async function updateFaq(id, body, actor) {
  const faq = await prisma.faq.findUnique({ where: { id } });
  if (!faq) throw httpError(404, 'not_found', 'FAQ not found.');
  const data = faqInput(body);
  if (data.question.length < 5) throw httpError(400, 'validation', 'A question is required.');
  if (data.answer.length < 2) throw httpError(400, 'validation', 'An answer is required.');
  return prisma.faq.update({ where: { id }, data: { ...data, updatedById: actor.id } });
}
async function setFaqStatus(id, status, actor) {
  assertEnum(status, FAQ_STATUS, null, 'status');
  const faq = await prisma.faq.findUnique({ where: { id } });
  if (!faq) throw httpError(404, 'not_found', 'FAQ not found.');
  return prisma.faq.update({ where: { id }, data: { status, updatedById: actor.id } });
}
async function moveFaq(id, dir) {
  const faq = await prisma.faq.findUnique({ where: { id } });
  if (!faq) throw httpError(404, 'not_found', 'FAQ not found.');
  const neighbour = await prisma.faq.findFirst({
    where: dir === 'up' ? { position: { lt: faq.position } } : { position: { gt: faq.position } },
    orderBy: { position: dir === 'up' ? 'desc' : 'asc' },
  });
  if (!neighbour) return faq;
  await prisma.$transaction([
    prisma.faq.update({ where: { id: faq.id }, data: { position: neighbour.position } }),
    prisma.faq.update({ where: { id: neighbour.id }, data: { position: faq.position } }),
  ]);
  return prisma.faq.findUnique({ where: { id } });
}
async function deleteFaq(id) {
  const faq = await prisma.faq.findUnique({ where: { id } });
  if (!faq) throw httpError(404, 'not_found', 'FAQ not found.');
  await prisma.faq.delete({ where: { id } });
}
function publishedFaqs() {
  return prisma.faq.findMany({ where: { status: 'published' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
}

/* ============================================================ media library */
const MIME_ALLOW = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
]);
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};
async function listMedia({ q = '', skip = 0, take = 48 } = {}) {
  const where = {};
  if (q) where.OR = [{ filename: { contains: q } }, { altText: { contains: q } }];
  const [total, rows] = await Promise.all([
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  ]);
  return { total, rows };
}
function getMedia(id) {
  return prisma.mediaAsset.findUnique({ where: { id } });
}
function safeExt(mime, filename) {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const fromName = path.extname(String(filename || '')).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
  return fromName || 'bin';
}
/* Writes an uploaded buffer to the uploads directory and records it. Returns a
   clear error when the filesystem is read-only (e.g. serverless hosting). */
async function saveUpload({ buffer, mimeType, filename, altText, actor }) {
  const mime = str(mimeType, 100).split(';')[0].trim().toLowerCase();
  if (!MIME_ALLOW.has(mime)) throw httpError(400, 'validation', 'Unsupported file type. Allowed: PNG, JPEG, WEBP, GIF, SVG, PDF.');
  if (!buffer || !buffer.length) throw httpError(400, 'validation', 'The uploaded file is empty.');
  if (buffer.length > config.maxUploadBytes) throw httpError(413, 'too_large', 'File is larger than the ' + Math.round(config.maxUploadBytes / 1024 / 1024) + 'MB limit.');
  const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + safeExt(mime, filename);
  const dir = config.uploadsDir;
  const disk = path.join(dir, name);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(disk, buffer);
  } catch (e) {
    throw httpError(503, 'storage_unavailable', 'Uploads are unavailable on this server (read-only storage). Add media by URL instead.');
  }
  const publicPath = '/uploads/' + name;
  return prisma.mediaAsset.create({
    data: { filename: path.basename(String(filename || name)).slice(0, 200) || name, mimeType: mime, size: buffer.length, path: publicPath, altText: optStr(altText, 300), uploadedById: actor.id },
  });
}
async function createMediaUrl(body, actor) {
  const url = optStr(body.path, 1000);
  if (!url) throw httpError(400, 'validation', 'A file path or URL is required.');
  const filename = optStr(body.filename, 200) || path.basename(url.split('?')[0]) || url;
  return prisma.mediaAsset.create({
    data: { filename, mimeType: str(body.mimeType, 100) || 'text/uri-list', size: 0, path: url, altText: optStr(body.altText, 300), uploadedById: actor.id },
  });
}
async function deleteMedia(id) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw httpError(404, 'not_found', 'Media asset not found.');
  if (asset.path && asset.path.startsWith('/uploads/')) {
    try {
      await fs.promises.unlink(path.join(config.uploadsDir, path.basename(asset.path)));
    } catch {
      /* best effort — the DB record still goes away */
    }
  }
  await prisma.mediaAsset.delete({ where: { id } });
}

/* ================================================================ settings */
async function getSettings() {
  const rows = await prisma.setting.findMany();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}
async function setSettings(body, actor) {
  for (const s of SETTING_KEYS) {
    if (!(s.key in body)) continue;
    const value = str(body[s.key], 500);
    if (value) {
      await prisma.setting.upsert({ where: { key: s.key }, update: { value }, create: { key: s.key, value } });
    } else {
      await prisma.setting.deleteMany({ where: { key: s.key } });
    }
  }
  return getSettings();
}

/* ============================================================ public payload */
function courseToPublic(c) {
  const fees = (c.fees || [])
    .filter((f) => f.status === 'published')
    .map((f) => [f.label, money(f.amount, f.currency)]);
  return {
    id: c.publicId || c.slug,
    field: c.category || '',
    name: c.name,
    univ: c.institution ? c.institution.name : c.country || '',
    place: c.city || c.country || '',
    country: c.country || '',
    duration: c.duration || 'As per university',
    eligibility: c.eligibility || '',
    total: money(c.tuitionFee, c.currency),
    from: c.tuitionFee == null ? null : c.tuitionFee,
    tag: c.academicYear || (c.featured ? 'Featured' : ''),
    fees,
    points: [],
    src: '',
  };
}

async function sitePayload() {
  const [content, settings, faqRows, countryRows, courseRows, slotRows] = await Promise.all([
    publishedContent(),
    getSettings(),
    publishedFaqs(),
    prisma.country.findMany({ where: { status: 'published' }, orderBy: { name: 'asc' } }),
    prisma.course.findMany({
      where: { status: 'published', deletedAt: null },
      orderBy: [{ featured: 'desc' }, { updatedAt: 'desc' }],
      include: { institution: { select: { name: true, city: true } }, fees: true },
    }),
    prisma.availabilitySlot.findMany({ where: { active: true }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] }),
  ]);
  return {
    content,
    settings,
    faqs: faqRows.map((f) => ({ question: f.question, answer: f.answer, category: f.category })),
    countries: countryRows.map((c) => ({ id: c.id, name: c.name, code: c.code, overview: c.overview })),
    courses: courseRows.map(courseToPublic),
    availability: slotRows.map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  httpError, str, optStr, inr, money, readList,
  CONTENT_TYPE, CONTENT_STATUS, CONTENT_KEYS, SETTING_KEYS, MIME_ALLOW,
  listContent, getContent, saveContent, updateContent, setContentStatus, deleteContent, listRevisions, publishedContent,
  listFaqs, getFaq, createFaq, updateFaq, setFaqStatus, moveFaq, deleteFaq, publishedFaqs,
  listMedia, getMedia, saveUpload, createMediaUrl, deleteMedia,
  getSettings, setSettings,
  sitePayload, courseToPublic,
};
