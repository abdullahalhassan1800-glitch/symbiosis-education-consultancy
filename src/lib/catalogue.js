'use strict';
/* Catalogue service: Countries, Universities (Institutions), Courses and Fee
   records. Validation + business rules + CSV mapping live here so the HTML
   pages and the JSON API share one implementation. */
const prisma = require('../db');

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/* ------------------------------------------------------------- primitives */
function str(v, max = 8000) {
  return v == null ? '' : String(v).trim().slice(0, max);
}
function optStr(v, max = 8000) {
  const s = str(v, max);
  return s ? s : null;
}
function parseMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n) || n < 0) throw httpError(400, 'validation', 'Amount must be a positive number.');
  return Math.round(n);
}
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw httpError(400, 'validation', 'Invalid date.');
  return d;
}
function parseList(v) {
  const items = (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
  return items.length ? JSON.stringify(items) : null;
}
function readList(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function slugify(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
function requireName(v, label = 'Name') {
  const s = str(v, 200);
  if (s.length < 2) throw httpError(400, 'validation', label + ' is required.');
  return s;
}
function assertEnum(v, allowed, fallback, label) {
  const s = str(v, 40);
  if (!s) return fallback;
  if (!allowed.includes(s)) throw httpError(400, 'validation', 'Invalid ' + label + '.');
  return s;
}
function parseBool(v) {
  return v === true || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

async function uniqueSlug(model, base, excludeId) {
  let slug = slugify(base) || 'item';
  let n = 1;
  for (;;) {
    const existing = await model.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = (slugify(base) || 'item') + '-' + n;
  }
}

const STATUS = ['draft', 'published', 'archived'];

/* ------------------------------------------------------------- countries */
async function listCountries({ q = '', status = '', skip = 0, take = 20 } = {}) {
  const where = {};
  if (q) where.name = { contains: q };
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.country.count({ where }),
    prisma.country.findMany({ where, orderBy: { name: 'asc' }, skip, take, include: { _count: { select: { institutions: true } } } }),
  ]);
  return { total, rows };
}
function getCountry(id) {
  return prisma.country.findUnique({ where: { id } });
}
function countryInput(body) {
  return {
    name: requireName(body.name, 'Country name'),
    code: optStr(body.code, 4) ? str(body.code, 4).toUpperCase() : null,
    overview: optStr(body.overview, 8000),
    flagImage: optStr(body.flagImage, 500),
    admissionGuidance: optStr(body.admissionGuidance, 8000),
    livingCostEstimate: optStr(body.livingCostEstimate, 500),
    visaGuidance: optStr(body.visaGuidance, 8000),
    officialLinks: parseList(body.officialLinks),
    status: assertEnum(body.status, STATUS, 'draft', 'status'),
  };
}
async function createCountry(body, actor) {
  const data = countryInput(body);
  try {
    return await prisma.country.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A country with that name or code already exists.');
    throw e;
  }
}
async function updateCountry(id, body, actor) {
  const country = await prisma.country.findUnique({ where: { id } });
  if (!country) throw httpError(404, 'not_found', 'Country not found.');
  const data = countryInput(body);
  try {
    return await prisma.country.update({ where: { id }, data: { ...data, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A country with that name or code already exists.');
    throw e;
  }
}
async function deleteCountry(id) {
  const used = await prisma.institution.count({ where: { countryId: id } });
  if (used) throw httpError(409, 'in_use', `This country is linked to ${used} university(ies). Reassign them first.`);
  await prisma.country.delete({ where: { id } });
}

/* ---------------------------------------------------------- institutions */
async function listInstitutions({ q = '', countryId = '', status = '', skip = 0, take = 20 } = {}) {
  const where = {};
  if (q) where.OR = [{ name: { contains: q } }, { city: { contains: q } }];
  if (countryId) where.countryId = countryId;
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.institution.count({ where }),
    prisma.institution.findMany({ where, orderBy: { name: 'asc' }, skip, take, include: { country: true, _count: { select: { courses: true } } } }),
  ]);
  return { total, rows };
}
function getInstitution(id) {
  return prisma.institution.findUnique({ where: { id }, include: { country: true } });
}
async function institutionInput(body, actor, excludeId) {
  const name = requireName(body.name, 'University name');
  const city = optStr(body.city, 120);
  const slug = str(body.slug, 100) ? slugify(body.slug) : await uniqueSlug(prisma.institution, name, excludeId);
  return {
    name,
    slug,
    city,
    countryId: optStr(body.countryId, 40),
    officialWebsite: optStr(body.officialWebsite, 500),
    logoUrl: optStr(body.logoUrl, 500),
    description: optStr(body.description, 8000),
    programmes: optStr(body.programmes, 8000),
    recognitionInfo: optStr(body.recognitionInfo, 8000),
    sourceUrls: parseList(body.sourceUrls),
    verificationStatus: assertEnum(body.verificationStatus, ['verified', 'unverified', 'pending'], 'unverified', 'verification status'),
    lastVerifiedAt: parseDate(body.lastVerifiedAt),
    status: assertEnum(body.status, STATUS, 'draft', 'status'),
  };
}
async function createInstitution(body, actor) {
  const data = await institutionInput(body, actor);
  try {
    return await prisma.institution.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A university with that name/city or slug already exists.');
    throw e;
  }
}
async function updateInstitution(id, body, actor) {
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) throw httpError(404, 'not_found', 'University not found.');
  const data = await institutionInput(body, actor, id);
  try {
    return await prisma.institution.update({ where: { id }, data: { ...data, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A university with that name/city or slug already exists.');
    throw e;
  }
}
async function deleteInstitution(id) {
  const used = await prisma.course.count({ where: { institutionId: id } });
  if (used) throw httpError(409, 'in_use', `This university has ${used} course(s). Reassign or delete them first.`);
  await prisma.institution.delete({ where: { id } });
}

/* --------------------------------------------------------------- courses */
async function listCourses({ q = '', status = '', category = '', institutionId = '', featured = '', skip = 0, take = 20 } = {}) {
  const where = { deletedAt: null };
  if (q) where.OR = [{ name: { contains: q } }, { publicId: { contains: q } }, { city: { contains: q } }];
  if (status) where.status = status;
  if (category) where.category = category;
  if (institutionId) where.institutionId = institutionId;
  if (featured === '1') where.featured = true;
  const [total, rows] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip, take, include: { institution: true, _count: { select: { fees: true } } } }),
  ]);
  return { total, rows };
}
function getCourse(id) {
  return prisma.course.findFirst({
    where: { id, deletedAt: null },
    include: { institution: true, fees: { orderBy: { createdAt: 'asc' } } },
  });
}
async function buildCourseInput(body, actor, excludeId) {
  const name = requireName(body.name, 'Course name');
  const slug = str(body.slug, 100) ? slugify(body.slug) : await uniqueSlug(prisma.course, str(body.publicId, 80) || name, excludeId);
  return {
    name,
    slug,
    publicId: optStr(body.publicId, 80),
    category: optStr(body.category, 60),
    description: optStr(body.description, 12000),
    institutionId: optStr(body.institutionId, 40),
    country: optStr(body.country, 120),
    city: optStr(body.city, 120),
    duration: optStr(body.duration, 120),
    eligibility: optStr(body.eligibility, 2000),
    entranceExam: optStr(body.entranceExam, 200),
    tuitionFee: parseMoney(body.tuitionFee),
    additionalCharges: parseMoney(body.additionalCharges),
    currency: str(body.currency, 8) || 'INR',
    academicYear: optStr(body.academicYear, 20),
    applicationDeadline: parseDate(body.applicationDeadline),
    officialSourceUrl: optStr(body.officialSourceUrl, 500),
    lastVerifiedAt: parseDate(body.lastVerifiedAt),
    status: assertEnum(body.status, STATUS, 'draft', 'status'),
    featured: parseBool(body.featured),
  };
}
async function createCourse(body, actor) {
  const data = await buildCourseInput(body, actor);
  try {
    return await prisma.course.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A course with that slug or public id already exists.');
    throw e;
  }
}
async function updateCourse(id, body, actor) {
  const course = await getCourse(id);
  if (!course) throw httpError(404, 'not_found', 'Course not found.');
  const data = await buildCourseInput(body, actor, id);
  try {
    return await prisma.course.update({ where: { id }, data: { ...data, updatedById: actor.id } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'duplicate', 'A course with that slug or public id already exists.');
    throw e;
  }
}
async function setCourseStatus(id, status, actor) {
  assertEnum(status, STATUS, null, 'status');
  const course = await getCourse(id);
  if (!course) throw httpError(404, 'not_found', 'Course not found.');
  return prisma.course.update({ where: { id }, data: { status, updatedById: actor.id } });
}
async function deleteCourse(id) {
  const course = await getCourse(id);
  if (!course) throw httpError(404, 'not_found', 'Course not found.');
  await prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ---------------------------------------------------------- fee records */
function feeInput(body, actor, courseId) {
  return {
    courseId,
    label: requireName(body.label, 'Fee label'),
    amount: parseMoney(body.amount),
    currency: str(body.currency, 8) || 'INR',
    academicYear: optStr(body.academicYear, 20),
    kind: assertEnum(body.kind, ['tuition', 'additional', 'other'], 'tuition', 'fee kind'),
    sourceUrl: optStr(body.sourceUrl, 500),
    verifiedAt: parseDate(body.verifiedAt),
    status: assertEnum(body.status, ['draft', 'published'], 'draft', 'status'),
  };
}
async function listFees({ q = '', courseId = '', skip = 0, take = 25 } = {}) {
  const where = {};
  if (courseId) where.courseId = courseId;
  if (q) where.label = { contains: q };
  const [total, rows] = await Promise.all([
    prisma.feeRecord.count({ where }),
    prisma.feeRecord.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take, include: { course: { select: { name: true, slug: true } } } }),
  ]);
  return { total, rows };
}
async function addFee(courseId, body, actor) {
  const course = await getCourse(courseId);
  if (!course) throw httpError(404, 'not_found', 'Course not found.');
  const data = feeInput(body, actor, courseId);
  const fee = await prisma.feeRecord.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
  await prisma.feeChange.create({ data: { feeRecordId: fee.id, changedById: actor.id, oldAmount: null, newAmount: fee.amount, oldLabel: null, newLabel: fee.label, note: 'created' } });
  return fee;
}
async function updateFee(id, body, actor) {
  const fee = await prisma.feeRecord.findUnique({ where: { id } });
  if (!fee) throw httpError(404, 'not_found', 'Fee record not found.');
  const data = feeInput(body, actor, fee.courseId);
  if (data.amount !== fee.amount || data.label !== fee.label) {
    await prisma.feeChange.create({ data: { feeRecordId: id, changedById: actor.id, oldAmount: fee.amount, newAmount: data.amount, oldLabel: fee.label, newLabel: data.label, note: 'updated' } });
  }
  return prisma.feeRecord.update({ where: { id }, data: { ...data, updatedById: actor.id } });
}
async function deleteFee(id) {
  const fee = await prisma.feeRecord.findUnique({ where: { id } });
  if (!fee) throw httpError(404, 'not_found', 'Fee record not found.');
  await prisma.feeRecord.delete({ where: { id } });
}
function listFeeChanges(feeRecordId) {
  return prisma.feeChange.findMany({ where: { feeRecordId }, orderBy: { createdAt: 'desc' } });
}

/* --------------------------------------------------------------- options */
async function countryOptions() {
  const rows = await prisma.country.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return rows;
}
async function institutionOptions() {
  const rows = await prisma.institution.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, city: true } });
  return rows;
}
async function categoryOptions() {
  const rows = await prisma.course.findMany({ where: { deletedAt: null, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  return rows.map((r) => r.category).filter(Boolean);
}

module.exports = {
  httpError,
  str, optStr, parseMoney, parseDate, parseList, readList, slugify, parseBool,
  listCountries, getCountry, createCountry, updateCountry, deleteCountry,
  listInstitutions, getInstitution, createInstitution, updateInstitution, deleteInstitution,
  listCourses, getCourse, createCourse, updateCourse, setCourseStatus, deleteCourse,
  listFees, addFee, updateFee, deleteFee, listFeeChanges,
  countryOptions, institutionOptions, categoryOptions,
  STATUS,
};
