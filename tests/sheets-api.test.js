/* ============================================================================
   Google Sheets API (service-account) push — isolated unit test.
   No network, no real credentials: a generated RSA key signs the JWT and a
   mocked fetch captures every Google API call.

   Run: node tests/sheets-api.test.js
   ========================================================================== */
'use strict';
const assert = require('assert');
const crypto = require('crypto');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (e) { results.push([name, 'FAIL', String((e && e.message) || e).replace(/[\r\n]+/g, ' ')]); }
}

/* A throwaway service-account key so sheets.js believes it is configured. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const SA = {
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'svc@test-project.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
};

process.env.NODE_ENV = 'test';
process.env.GOOGLE_SHEETS_ID = 'SHEET_ID_TEST';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
process.env.SHEETS_WEBHOOK_URL = '';           // ensure webhook mode is NOT chosen
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
delete require.cache[require.resolve('../.env')];

const sheets = require('../src/lib/sheets');

/* ------------------------------------------------------- mock Google APIs */
const calls = [];
function reply(obj) {
  return { ok: true, status: 200, async json() { return obj; } };
}
function installFetch() {
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts: opts || {} });
    if (u.includes('oauth2.googleapis.com/token')) return reply({ access_token: 'fake-token', expires_in: 3600 });
    if (u.includes('?fields=sheets.properties.title')) return reply({ sheets: [] });
    if (u.includes(':batchUpdate')) return reply({ replies: [{}] });
    if (u.includes('/values/') && (opts && opts.method) === 'GET') return reply({}); // empty tab → header needed
    if (u.includes(':append')) return reply({ updates: { updatedRows: 1 } });
    return { ok: false, status: 404, async json() { return {}; } };
  };
}

function decodeSegment(seg) {
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

(async () => {
  installFetch();

  await test('mode is "api" when spreadsheet id + service account are set', () => {
    assert.strictEqual(sheets.mode(), 'api');
    assert.strictEqual(sheets.enabled(), true);
  });

  const sentAt = new Date('2026-01-02T03:04:05.000Z').toISOString();
  let ok = false;
  await test('post() appends a lead row and succeeds', async () => {
    ok = await sheets.post({
      kind: 'lead',
      record: { reference: 'LEAD-1', studentName: 'Test Student', phone: '9998887776', email: 'a@b.com', courseInterest: 'MBBS', source: 'website', status: 'new', createdAt: '2026-01-01T00:00:00.000Z' },
      sentAt,
    });
    assert.strictEqual(ok, true, 'post() should resolve true');
  });

  await test('a JWT was signed and is verifiable with the public key', () => {
    const tokenCall = calls.find((c) => c.url.includes('oauth2.googleapis.com/token'));
    assert.ok(tokenCall, 'no token request was made');
    const body = tokenCall.opts.body;
    const assertion = decodeURIComponent(String(body).replace(/^.*assertion=/, '')).trim();
    const parts = assertion.split('.');
    assert.strictEqual(parts.length, 3, 'JWT must have 3 parts');
    const header = JSON.parse(decodeSegment(parts[0]));
    assert.strictEqual(header.alg, 'RS256');
    const claim = JSON.parse(decodeSegment(parts[1]));
    assert.strictEqual(claim.iss, SA.client_email);
    assert.ok(String(claim.scope).includes('spreadsheets'), 'scope must include spreadsheets');
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, signature);
    assert.ok(valid, 'JWT signature did not verify');
  });

  await test('an access token was requested before writing', () => {
    const order = calls.map((c) => c.url);
    const tokenAt = order.findIndex((u) => u.includes('oauth2.googleapis.com/token'));
    const appendAt = order.findIndex((u) => u.includes(':append'));
    assert.ok(tokenAt !== -1 && appendAt !== -1 && tokenAt < appendAt, 'token must be fetched before append');
    const append = calls[appendAt];
    assert.ok(String(append.opts.headers.authorization).startsWith('Bearer '), 'append must be authenticated');
  });

  await test('a missing tab is created before writing', () => {
    const hasBatch = calls.some((c) => c.url.includes(':batchUpdate'));
    assert.ok(hasBatch, 'expected an addSheet batchUpdate call');
  });

  await test('the Lead row has the correct columns', () => {
    const appends = calls.filter((c) => c.url.includes(':append'));
    assert.ok(appends.length >= 2, 'expected a header append then a data append');
    const dataAppend = appends[appends.length - 1];
    const values = JSON.parse(dataAppend.opts.body).values[0];
    assert.strictEqual(values.length, 9, 'Lead row must have 9 columns');
    assert.strictEqual(values[0], sentAt);
    assert.strictEqual(values[1], 'LEAD-1');
    assert.strictEqual(values[2], 'Test Student');
    assert.strictEqual(values[3], '9998887776');
    assert.ok(dataAppend.url.includes('Leads'), 'range must target the Leads tab');
  });

  await test('a Date value is serialised to ISO, never "[object Date]"', async () => {
    calls.length = 0;
    await sheets.post({
      kind: 'appointment',
      record: { reference: 'APT-1', studentName: 'X', contactNumber: '9000000001', scheduledAt: new Date('2026-02-03T10:00:00.000Z'), timezone: 'Asia/Kolkata', meetingType: 'call', status: 'pending' },
      sentAt,
    });
    const appends = calls.filter((c) => c.url.includes(':append'));
    const values = JSON.parse(appends[appends.length - 1].opts.body).values[0];
    assert.ok(!JSON.stringify(values).includes('[object Date]'), 'Date leaked as [object Date]');
    assert.strictEqual(values[6], '2026-02-03T10:00:00.000Z');
  });

  const pass = results.filter((r) => r[1] === 'PASS').length;
  const fail = results.length - pass;
  console.log('\nSymbiosis — Google Sheets API tests\n' + '='.repeat(40));
  for (const [name, status, msg] of results) console.log((status === 'PASS' ? '  ✓ ' : '  ✗ ') + name + (msg ? '  → ' + msg : ''));
  console.log('='.repeat(40) + `\n${pass} passed, ${fail} failed, ${results.length} total\n`);
  process.exit(fail ? 1 : 0);
})();
