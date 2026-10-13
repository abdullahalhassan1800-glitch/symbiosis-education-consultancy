'use strict';
/* Push new CRM records to a Google Sheets web app (Apps Script `doPost`).
 *
 * This is the outbound half of the Sheets integration. A website lead,
 * appointment or enquiry is POSTed to the configured webhook URL as soon as it
 * is stored, so the spreadsheet fills in real time.
 *
 * It is deliberately best-effort: a slow or unreachable endpoint must never
 * affect a visitor's request. Every call is time-boxed and never throws, and
 * when no URL is configured it is a no-op.
 *
 * Google Apps Script does not expose custom request headers to `doPost`, so the
 * shared key travels as a `?key=` query parameter (the URL is HTTPS).
 */
const config = require('../config');

const SHEET_NAME = { lead: 'Leads', appointment: 'Appointments', enquiry: 'Enquiries' };
const TIMEOUT_MS = 5000;

function enabled() {
  return !!(config.integration.sheetsWebhookUrl || '').trim();
}

function withKey(rawUrl) {
  const key = config.integration.sheetsKey || '';
  if (!key) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  return rawUrl + sep + 'key=' + encodeURIComponent(key);
}

async function post(payload) {
  if (!enabled()) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(withKey(config.integration.sheetsWebhookUrl.trim()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* Fire-and-forget. Callers do not await this; the returned promise is only for
   tests. It never rejects. */
function notify(kind, record) {
  const sheet = SHEET_NAME[kind];
  if (!sheet || !enabled()) return Promise.resolve(false);
  return post({ kind, sheet, record, sentAt: new Date().toISOString() }).catch(() => false);
}

module.exports = { enabled, notify, post };
