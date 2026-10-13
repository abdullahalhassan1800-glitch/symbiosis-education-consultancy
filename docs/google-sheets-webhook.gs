/**
 * Symbiosis CRM → Google Sheets webhook (push)
 * =============================================
 * The Symbiosis backend POSTs every new Lead, Appointment and Contact Enquiry
 * to this web app, which appends a row to the matching tab in real time.
 *
 * One-way: the website pushes here; this script never writes back.
 *
 * Setup (one time):
 *   1. Open your Google Sheet → Extensions → Apps Script.
 *   2. Replace Code.gs with this file and save.
 *   3. Project Settings (⚙) → Script properties → Add:
 *        WEBHOOK_KEY = the same value as SHEETS_SYNC_KEY in the backend .env
 *      (Leave it empty to accept any caller — not recommended.)
 *   4. Deploy → New deployment → type "Web app":
 *        Execute as:  Me
 *        Who has access:  Anyone
 *      Copy the /exec URL.
 *   5. In the backend .env set:
 *        SHEETS_WEBHOOK_URL="<the /exec URL>"
 *        SHEETS_SYNC_KEY="<the same WEBHOOK_KEY>"
 *      and restart the server.
 *
 * Health check: open the /exec URL in a browser → {"ok":true,...}
 */

var SHEETS = {
  lead: {
    name: 'Leads',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Phone', 'Email',
      'Course interest', 'Source', 'Status', 'Created (UTC)'],
  },
  appointment: {
    name: 'Appointments',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Contact', 'Email',
      'Course interest', 'Scheduled at', 'Timezone', 'Meeting type', 'Status'],
  },
  enquiry: {
    name: 'Enquiries',
    headers: ['Received (UTC)', 'ID', 'Name', 'Contact', 'Email', 'Subject',
      'Message', 'Source page', 'Status'],
  },
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('WEBHOOK_KEY') || '';
    var provided = (e && e.parameter && e.parameter.key) || '';
    if (expected && provided !== expected) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var kind = String(body.kind || '').toLowerCase();
    var spec = SHEETS[kind];
    if (!spec) return json_({ ok: false, error: 'unknown kind: ' + kind });

    lock.waitLock(10000);
    var sh = sheet_(spec.name);
    ensureHeader_(sh, spec.headers);
    sh.appendRow(row_(kind, body));
    lock.releaseLock();

    return json_({ ok: true, kind: kind, sheet: spec.name });
  } catch (err) {
    try { lock.releaseLock(); } catch (ignore) {}
    return json_({ ok: false, error: String(err) });
  }
}

/** Opening the /exec URL in a browser confirms the deployment is live. */
function doGet() {
  return json_({ ok: true, service: 'symbiosis-sheets-webhook', at: new Date().toISOString() });
}

/* ------------------------------------------------------------------ helpers */

function row_(kind, body) {
  var r = body.record || {};
  var t = fmt_(body.sentAt || new Date().toISOString());
  if (kind === 'lead') {
    return [t, fmt_(r.reference), fmt_(r.studentName), fmt_(r.phone), fmt_(r.email),
      fmt_(r.courseInterest), fmt_(r.source), fmt_(r.status), fmt_(r.createdAt)];
  }
  if (kind === 'appointment') {
    return [t, fmt_(r.reference), fmt_(r.studentName), fmt_(r.contactNumber), fmt_(r.email),
      fmt_(r.courseInterest), fmt_(r.scheduledAt), fmt_(r.timezone), fmt_(r.meetingType), fmt_(r.status)];
  }
  return [t, fmt_(r.id), fmt_(r.name), fmt_(r.contact), fmt_(r.email), fmt_(r.subject),
    fmt_(r.message), fmt_(r.sourcePage), fmt_(r.status)];
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeader_(sh, headers) {
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
}

function fmt_(v) {
  return v === null || v === undefined ? '' : String(v);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
