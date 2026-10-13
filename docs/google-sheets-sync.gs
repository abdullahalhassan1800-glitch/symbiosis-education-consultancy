/**
 * Symbiosis CRM → Google Sheets sync
 * -----------------------------------
 * Mirrors Leads, Appointments and Contact Enquiries from the Symbiosis backend
 * into this spreadsheet. Read-only: it never writes back to the website.
 *
 * Setup (one time):
 *   1. In the backend .env set a long random SHEETS_SYNC_KEY and restart.
 *   2. Open your Google Sheet → Extensions → Apps Script.
 *   3. Paste this file, then Project Settings → Script properties, add:
 *        API_BASE = https://your-deployment.example.com   (no trailing slash)
 *        API_KEY  = the same value as SHEETS_SYNC_KEY
 *   4. Run `syncAll` once and grant the requested permissions.
 *   5. Run `installTrigger` to refresh every 15 minutes (optional).
 */

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var base = (props.getProperty('API_BASE') || '').replace(/\/+$/, '');
  var key = props.getProperty('API_KEY') || '';
  if (!base || !key) {
    throw new Error('Set API_BASE and API_KEY in Project Settings → Script properties.');
  }
  return { base: base, key: key };
}

function fetchRecords_(since) {
  var cfg = getConfig_();
  var url = cfg.base + '/api/integrations/records' + (since ? '?since=' + encodeURIComponent(since) : '');
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': cfg.key, accept: 'application/json' },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('API error ' + code + ': ' + res.getContentText());
  var body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error('API returned an error: ' + res.getContentText());
  return body.data;
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function fmt_(v) {
  return v === null || v === undefined ? '' : String(v);
}

function writeSheet_(name, headers, rows) {
  var sh = sheet_(name);
  sh.clear();
  var values = [headers].concat(rows);
  sh.getRange(1, 1, values.length, headers.length).setValues(values);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
  return rows.length;
}

function syncAll() {
  var data = fetchRecords_(null);

  var leadHeaders = ['Reference', 'Student', 'Phone', 'WhatsApp', 'Email', 'City',
    'Qualification', 'Course interest', 'Country interest', 'NEET', 'Source',
    'Status', 'Assigned to', 'Notes', 'Created', 'Updated'];
  var leadRows = data.leads.map(function (l) {
    return [l.reference, l.studentName, l.phone, l.whatsapp, l.email, l.city,
      l.qualification, l.courseInterest, l.countryInterest, l.neetScore, l.source,
      l.status, l.assignedTo, l.notes, l.createdAt, l.updatedAt].map(fmt_);
  });

  var apptHeaders = ['Reference', 'Student', 'Contact', 'Email', 'Course interest',
    'Scheduled at', 'Timezone', 'Meeting type', 'Status', 'Assigned to', 'Notes', 'Created', 'Updated'];
  var apptRows = data.appointments.map(function (a) {
    return [a.reference, a.studentName, a.contactNumber, a.email, a.courseInterest,
      a.scheduledAt, a.timezone, a.meetingType, a.status, a.assignedTo, a.notes,
      a.createdAt, a.updatedAt].map(fmt_);
  });

  var enqHeaders = ['ID', 'Name', 'Contact', 'Email', 'Subject', 'Message',
    'Source page', 'Status', 'Assigned to', 'Created', 'Updated'];
  var enqRows = data.enquiries.map(function (e) {
    return [e.id, e.name, e.contact, e.email, e.subject, e.message,
      e.sourcePage, e.status, e.assignedTo, e.createdAt, e.updatedAt].map(fmt_);
  });

  writeSheet_('Leads', leadHeaders, leadRows);
  writeSheet_('Appointments', apptHeaders, apptRows);
  writeSheet_('Enquiries', enqHeaders, enqRows);

  var meta = sheet_('Meta');
  meta.clear();
  meta.getRange(1, 1, 2, 2).setValues([
    ['Field', 'Value'],
    ['Last sync (UTC)', new Date().toISOString()],
  ]);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Synced ' + leadRows.length + ' leads, ' + apptRows.length +
    ' appointments, ' + enqRows.length + ' enquiries.'
  );
}

/** Optional: a how-to-check function used during setup. */
function testConnection() {
  var cfg = getConfig_();
  var res = UrlFetchApp.fetch(cfg.base + '/api/integrations/ping', {
    headers: { 'x-api-key': cfg.key, accept: 'application/json' },
    muteHttpExceptions: true,
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}

/** Run once to refresh every 15 minutes (the minimum interval allowed). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(15).create();
}
