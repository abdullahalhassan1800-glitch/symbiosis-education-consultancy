/**
 * Symbiosis CRM -> Google Sheets webhook (push)
 * =============================================
 * One-way: the website backend POSTs every new Lead / Appointment / Enquiry to
 * this web app, which appends a row to the matching tab in real time. It never
 * writes back to the website.
 *
 * QUICK SETUP (one time)
 * ----------------------
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Delete everything in Code.gs, paste THIS WHOLE FILE, then Save (Ctrl+S).
 * 3. Project Settings (gear icon) -> Script properties -> Add property:
 *        Name:  WEBHOOK_KEY
 *        Value: d8056f8937b21c5303ba42b00a11c674e602d06533775fbe
 *    (This must match SHEETS_SYNC_KEY in the backend .env. Leave it empty to
 *     accept any caller - NOT recommended.)
 * 4. Deploy -> New deployment -> gear icon -> "Web app":
 *        Description:     Symbiosis webhook
 *        Execute as:      Me
 *        Who has access:  Anyone        <-- must be EXACTLY "Anyone"
 *                                              (NOT "Anyone with Google account")
 *    Click Deploy, then Authorize access: choose your account ->
 *    Advanced -> "Go to <project> (unsafe)" -> Allow.
 * 5. Copy the "Web app" URL (ends with /exec). Put it in the backend .env:
 *        SHEETS_WEBHOOK_URL="<the /exec URL>"
 *        SHEETS_SYNC_KEY="d8056f8937b21c5303ba42b00a11c674e602d06533775fbe"
 *    and restart the server.
 *
 * VERIFY
 * ------
 * - Open the /exec URL in an INCOGNITO browser window. You must see
 *       {"ok":true,"service":"symbiosis-sheets-webhook",...}
 *   If you instead see a Google "You need access" page, then "Who has access"
 *   is not "Anyone" (or your Google Workspace admin blocks public web apps).
 * - In the Apps Script editor, pick the function `selfTest` and click Run once.
 *   It writes a test row directly (bypasses the web deployment) and logs the
 *   JSON result - this proves the sheet-writing half works.
 *
 * NOTE: changing the code does NOT change access. "Who has access: Anyone" is a
 * deployment setting - see step 4.
 */

var WEBHOOK_KEY_PROP = 'WEBHOOK_KEY';
var SPREADSHEET_ID_PROP = 'SPREADSHEET_ID'; // optional; only for standalone scripts

var SHEETS = {
  lead: {
    name: 'Leads',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Phone', 'Email',
      'Course interest', 'Source', 'Status', 'Created (UTC)'],
    row: function (r, t) {
      return [t, s_(r.reference), s_(r.studentName), s_(r.phone), s_(r.email),
        s_(r.courseInterest), s_(r.source), s_(r.status), s_(r.createdAt)];
    },
  },
  appointment: {
    name: 'Appointments',
    headers: ['Received (UTC)', 'Reference', 'Student', 'Contact', 'Email',
      'Course interest', 'Scheduled at', 'Timezone', 'Meeting type', 'Status'],
    row: function (r, t) {
      return [t, s_(r.reference), s_(r.studentName), s_(r.contactNumber), s_(r.email),
        s_(r.courseInterest), s_(r.scheduledAt), s_(r.timezone), s_(r.meetingType), s_(r.status)];
    },
  },
  enquiry: {
    name: 'Enquiries',
    headers: ['Received (UTC)', 'ID', 'Name', 'Contact', 'Email', 'Subject',
      'Message', 'Source page', 'Status'],
    row: function (r, t) {
      return [t, s_(r.id), s_(r.name), s_(r.contact), s_(r.email), s_(r.subject),
        s_(r.message), s_(r.sourcePage), s_(r.status)];
    },
  },
};

/** Health check: open the /exec URL in a browser. */
function doGet(e) {
  var auth = auth_(e);
  return json_({
    ok: auth.ok,
    service: 'symbiosis-sheets-webhook',
    key: auth.ok ? 'accepted' : 'missing or invalid',
    at: new Date().toISOString(),
  });
}

/** Receives a JSON payload and appends one row. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var auth = auth_(e);
    if (!auth.ok) return json_({ ok: false, error: 'unauthorized' });

    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      return json_({ ok: false, error: 'invalid JSON body' });
    }

    var kind = String(body.kind || '').toLowerCase();
    var spec = SHEETS[kind];
    if (!spec) return json_({ ok: false, error: 'unknown kind: ' + (kind || '(empty)') });

    lock.waitLock(10000);
    locked = true;

    var sh = sheet_(spec.name);
    ensureHeader_(sh, spec.headers);
    sh.appendRow(spec.row(body.record || {}, s_(body.sentAt || new Date().toISOString())));

    return json_({ ok: true, kind: kind, sheet: spec.name });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function auth_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty(WEBHOOK_KEY_PROP) || '';
  var provided = (e && e.parameter && e.parameter.key) || '';
  if (!expected) return { ok: true }; // no key set => accept any caller
  return { ok: provided === expected };
}

function spreadsheet_() {
  var bound = null;
  try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (ignore) {}
  if (bound) return bound;
  var id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROP);
  if (!id) throw new Error('No bound spreadsheet found. Set the SPREADSHEET_ID script property to your sheet id.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var ss = spreadsheet_();
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

function s_(v) {
  return v === null || v === undefined ? '' : String(v);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to confirm the script can write to the sheet. */
function selfTest() {
  var key = PropertiesService.getScriptProperties().getProperty(WEBHOOK_KEY_PROP) || '';
  var out = doPost({
    parameter: { key: key },
    postData: {
      contents: JSON.stringify({
        kind: 'lead',
        sheet: 'Leads',
        sentAt: new Date().toISOString(),
        record: {
          reference: 'SELFTEST-' + Date.now(),
          studentName: 'Apps Script self test',
          phone: '0000000000',
          email: 'selftest@example.com',
          courseInterest: 'MBBS',
          source: 'apps-script',
          status: 'new',
          createdAt: new Date().toISOString(),
        },
      }),
    },
  });
  Logger.log(out.getContent());
}
