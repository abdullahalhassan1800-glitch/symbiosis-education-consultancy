'use strict';
/* Push new CRM records to Google Sheets.
 *
 * Two interchangeable modes, chosen automatically from configuration:
 *
 *   1. "api"     — Google Sheets API v4 using a service-account key. The backend
 *                  signs a JWT, exchanges it for an access token and appends the
 *                  row directly. No public web app, no Apps Script, no "Anyone"
 *                  access needed. This is the reliable option. Configure:
 *                    GOOGLE_SHEETS_ID           <spreadsheet id>
 *                    GOOGLE_SERVICE_ACCOUNT_JSON <JSON content or path to the key file>
 *   2. "webhook" — POSTs to a Google Apps Script web-app (/exec) URL. Kept for
 *                  setups that already have one. Configure SHEETS_WEBHOOK_URL.
 *
 *   3. "off"     — nothing configured; every call is a harmless no-op.
 *
 * The call is deliberately best-effort: a slow or unreachable endpoint must
 * never affect a visitor's request. Every call is time-boxed and never throws.
 */
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const TIMEOUT_MS = 5000;
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/* Column layout for each record kind. Row order MUST stay in sync with the
   headers so the spreadsheet stays readable without a syncing schema. */
const SHEET_SPEC = {
  lead: {
    name: 'Leads',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Phone', 'Email',
      'Course interest', 'Source', 'Status', 'Created (UTC)'],
    cells: (r, t) => [t, r.reference, r.studentName, r.phone, r.email,
      r.courseInterest, r.source, r.status, r.createdAt],
  },
  appointment: {
    name: 'Appointments',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Contact', 'Email',
      'Course interest', 'Scheduled at', 'Timezone', 'Meeting type', 'Status'],
    cells: (r, t) => [t, r.reference, r.studentName, r.contactNumber, r.email,
      r.courseInterest, r.scheduledAt, r.timezone, r.meetingType, r.status],
  },
  enquiry: {
    name: 'Enquiries',
    headers: ['Received (UTC)', 'ID', 'Name', 'Contact', 'Email', 'Subject',
      'Message', 'Source page', 'Status'],
    cells: (r, t) => [t, r.id, r.name, r.contact, r.email, r.subject,
      r.message, r.sourcePage, r.status],
  },
};

function webhookUrl() {
  return (config.integration.sheetsWebhookUrl || '').trim();
}
function spreadsheetId() {
  return (config.integration.sheetsSpreadsheetId || '').trim();
}

function serviceAccount() {
  const raw = (config.integration.sheetsServiceAccount || '').trim();
  if (!raw) return null;
  let text = raw;
  if (!raw.startsWith('{')) {
    try { text = fs.readFileSync(raw, 'utf8'); } catch (e) { return null; }
  }
  try {
    const sa = JSON.parse(text);
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch (e) {
    return null;
  }
}

function mode() {
  if (spreadsheetId() && serviceAccount()) return 'api';
  if (webhookUrl()) return 'webhook';
  return 'off';
}

function enabled() {
  return mode() !== 'off';
}

/* ---------------------------------------------------------- webhook (legacy) */

function withKey(rawUrl) {
  const key = config.integration.sheetsKey || '';
  if (!key) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  return rawUrl + sep + 'key=' + encodeURIComponent(key);
}

async function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function postWebhook(payload) {
  const res = await timedFetch(withKey(webhookUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/* -------------------------------------------------------------- api (v4 JWT) */

let tokenCache = { token: '', exp: 0 };
let knownTabs = { id: '', titles: new Set() };

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64url(JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }));
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  return unsigned + '.' + b64url(sig);
}

async function accessToken() {
  if (tokenCache.token && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const sa = serviceAccount();
  const res = await timedFetch(sa.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(sa),
    }).toString(),
  });
  if (!res.ok) throw new Error('token ' + res.status);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function quoteTab(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

async function api(token, path, init) {
  return timedFetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init && init.headers),
    },
  });
}

async function ensureTab(token, id, title) {
  if (knownTabs.id === id && knownTabs.titles.has(title)) return;
  const res = await api(token, id + '?fields=sheets.properties.title', { method: 'GET' });
  if (!res.ok) throw new Error('meta ' + res.status);
  const data = await res.json();
  const titles = new Set((data.sheets || []).map((s) => s.properties && s.properties.title));
  if (!titles.has(title)) {
    const add = await api(token, id + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    if (!add.ok) throw new Error('addSheet ' + add.status);
    titles.add(title);
  }
  knownTabs = { id, titles };
}

async function ensureHeaderRow(token, id, spec) {
  const range = quoteTab(spec.name) + '!A1:A1';
  const res = await api(token, id + '/values/' + encodeURIComponent(range), { method: 'GET' });
  if (!res.ok) throw new Error('read ' + res.status);
  const data = await res.json();
  if (data.values && data.values.length) return;
  await appendRow(token, id, spec.name, spec.headers);
}

async function appendRow(token, id, title, row) {
  const range = quoteTab(title) + '!A1';
  const res = await api(
    token,
    id + '/values/' + encodeURIComponent(range) +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );
  if (!res.ok) throw new Error('append ' + res.status);
}

function cell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function postApi(payload) {
  const spec = SHEET_SPEC[payload.kind];
  if (!spec) return false;
  const token = await accessToken();
  const id = spreadsheetId();
  await ensureTab(token, id, spec.name);
  await ensureHeaderRow(token, id, spec);
  const received = payload.sentAt || new Date().toISOString();
  await appendRow(token, id, spec.name, spec.cells(payload.record || {}, cell(received)).map(cell));
  return true;
}

/* ------------------------------------------------------------------ public */

async function post(payload) {
  const m = mode();
  if (m === 'off') return false;
  try {
    return m === 'api' ? await postApi(payload) : await postWebhook(payload);
  } catch (e) {
    return false;
  }
}

/* Fire-and-forget. Callers do not await this; the returned promise is only for
   tests. It never rejects. */
function notify(kind, record) {
  const spec = SHEET_SPEC[kind];
  if (!spec || !enabled()) return Promise.resolve(false);
  return post({ kind, sheet: spec.name, record, sentAt: new Date().toISOString() })
    .catch(() => false);
}

module.exports = { enabled, mode, notify, post };
