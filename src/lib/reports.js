'use strict';
/* Reporting / analytics service. All numbers are computed live from the
   database with Prisma — no placeholder or cached values. Nothing here is a
   native enum, Json or array column, so it stays portable SQLite ↔ PostgreSQL. */
const prisma = require('../db');

const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'counselling_scheduled',
  'follow_up',
  'converted',
  'not_interested',
  'closed',
];
const LEAD_SOURCES = ['website', 'whatsapp', 'instagram', 'referral', 'other'];
const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show'];
const ENQUIRY_STATUSES = ['new', 'contacted', 'resolved', 'spam'];

/* Stages shown in the conversion funnel, in order. */
const FUNNEL = ['new', 'contacted', 'qualified', 'counselling_scheduled', 'converted'];

const DAY_MS = 24 * 3600 * 1000;

/* Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD into an inclusive UTC range.
   Defaults to the last 30 days (inclusive of today). */
function parseRange(query = {}) {
  const now = new Date();
  const to = query.to ? new Date(String(query.to) + 'T23:59:59.999Z') : now;
  const from = query.from
    ? new Date(String(query.from) + 'T00:00:00.000Z')
    : new Date((Number.isNaN(to.getTime()) ? now : to).getTime() - 29 * DAY_MS);
  const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  return {
    from: valid(from) ? from : new Date(now.getTime() - 29 * DAY_MS),
    to: valid(to) ? to : now,
  };
}

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/* Fill a status->count map so every known value appears (0 when absent). */
function fill(keys, map) {
  const out = {};
  for (const k of keys) out[k] = map[k] || 0;
  // Include any unexpected values that exist in the data too.
  for (const k of Object.keys(map)) if (!(k in out)) out[k] = map[k];
  return out;
}

async function groupCounts(delegate, field, where) {
  const rows = await delegate.groupBy({ by: [field], _count: { _all: true }, where });
  const out = {};
  for (const r of rows) out[r[field]] = r._count._all;
  return out;
}

/* Build an ordered daily series for `rows` (objects with a Date field). */
function dailySeries(rows, field, from, to) {
  const buckets = new Map();
  for (let t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); t <= to; t = new Date(t.getTime() + DAY_MS)) {
    buckets.set(isoDay(t), 0);
  }
  for (const r of rows) {
    const key = isoDay(r[field]);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

async function getSummary(range = parseRange()) {
  const since = { gte: range.from, lte: range.to };
  const now = new Date();

  const [
    leadTotal,
    leadStatusMap,
    leadSourceMap,
    leadRows,
    appointmentTotal,
    appointmentStatusMap,
    appointmentsUpcoming,
    enquiryTotal,
    enquiryStatusMap,
    courseStatusMap,
    institutionCount,
    countryCount,
    funnelMap,
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: since, deletedAt: null } }),
    groupCounts(prisma.lead, 'status', { createdAt: since, deletedAt: null }),
    groupCounts(prisma.lead, 'source', { createdAt: since, deletedAt: null }),
    prisma.lead.findMany({ where: { createdAt: since, deletedAt: null }, select: { createdAt: true } }),
    prisma.appointment.count({ where: { createdAt: since } }),
    groupCounts(prisma.appointment, 'status', { createdAt: since }),
    prisma.appointment.count({ where: { scheduledAt: { gte: now }, status: { in: ['pending', 'confirmed'] } } }),
    prisma.contactEnquiry.count({ where: { createdAt: since } }),
    groupCounts(prisma.contactEnquiry, 'status', { createdAt: since }),
    groupCounts(prisma.course, 'status', { deletedAt: null }),
    prisma.institution.count(),
    prisma.country.count(),
    groupCounts(prisma.lead, 'status', { deletedAt: null }),
  ]);

  const leadsByStatus = fill(LEAD_STATUSES, leadStatusMap);
  const converted = leadsByStatus.converted || 0;
  const conversionRate = leadTotal > 0 ? Math.round((converted / leadTotal) * 1000) / 10 : 0;

  return {
    range: { from: isoDay(range.from), to: isoDay(range.to) },
    generatedAt: new Date().toISOString(),
    leads: {
      total: leadTotal,
      byStatus: leadsByStatus,
      bySource: fill(LEAD_SOURCES, leadSourceMap),
      daily: dailySeries(leadRows, 'createdAt', range.from, range.to),
    },
    appointments: {
      total: appointmentTotal,
      byStatus: fill(APPOINTMENT_STATUSES, appointmentStatusMap),
      upcoming: appointmentsUpcoming,
    },
    enquiries: {
      total: enquiryTotal,
      byStatus: fill(ENQUIRY_STATUSES, enquiryStatusMap),
    },
    catalogue: {
      coursesByStatus: fill(['draft', 'published', 'archived'], courseStatusMap),
      institutions: institutionCount,
      countries: countryCount,
    },
    funnel: {
      overall: Object.fromEntries(FUNNEL.map((s) => [s, funnelMap[s] || 0])),
      conversionRate,
    },
  };
}

/* Flatten the summary into CSV rows. */
function toCsvRows(summary) {
  const rows = [['section', 'metric', 'value']];
  rows.push(['range', 'from', summary.range.from]);
  rows.push(['range', 'to', summary.range.to]);
  rows.push(['leads', 'total', summary.leads.total]);
  for (const [k, v] of Object.entries(summary.leads.byStatus)) rows.push(['leads.by_status', k, v]);
  for (const [k, v] of Object.entries(summary.leads.bySource)) rows.push(['leads.by_source', k, v]);
  rows.push(['appointments', 'total', summary.appointments.total]);
  for (const [k, v] of Object.entries(summary.appointments.byStatus)) rows.push(['appointments.by_status', k, v]);
  rows.push(['appointments', 'upcoming', summary.appointments.upcoming]);
  rows.push(['enquiries', 'total', summary.enquiries.total]);
  for (const [k, v] of Object.entries(summary.enquiries.byStatus)) rows.push(['enquiries.by_status', k, v]);
  for (const [k, v] of Object.entries(summary.catalogue.coursesByStatus)) rows.push(['catalogue.courses', k, v]);
  rows.push(['catalogue', 'institutions', summary.catalogue.institutions]);
  rows.push(['catalogue', 'countries', summary.catalogue.countries]);
  for (const [k, v] of Object.entries(summary.funnel.overall)) rows.push(['funnel', k, v]);
  rows.push(['funnel', 'conversion_rate_pct', summary.funnel.conversionRate]);
  return rows;
}

module.exports = {
  LEAD_STATUSES,
  LEAD_SOURCES,
  APPOINTMENT_STATUSES,
  ENQUIRY_STATUSES,
  FUNNEL,
  parseRange,
  getSummary,
  toCsvRows,
};
