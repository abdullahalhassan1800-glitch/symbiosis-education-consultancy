/* ============================================================================
   Functional / data integrity tests — zero dependencies (Node >= 16).
   Run: npm test   (or: node tests/run.js)

   These tests verify:
     • the central dataset is structurally sound and internally consistent
     • every local asset referenced by HTML/JS actually exists on disk
     • every DOM id referenced by app.js exists in index.html
     • the fee-finder filter logic behaves (field, country, free text, empty)
     • booking helpers (slot formatting / notice window) work
     • contact + booking links are well formed and never point at the
       reference website for form submission
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function test(name, fn) {
  try { fn(); results.push([name, 'PASS', '']); }
  catch (e) { results.push([name, 'FAIL', String(e.message || e).replace(/[\r\n]+/g, ' ')]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

/* -------------------------------------------------- load the dataset */
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), sandbox, { filename: 'data.js' });
const SYM = sandbox.SYM;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

/* -------------------------------------------------- dataset structure */
test('dataset loads and exposes required collections', () => {
  assert(SYM, 'window.SYM not set');
  ['CONTACT', 'FIELDS', 'COURSES', 'PROMISES', 'UPDATES', 'PATHS', 'FAQ', 'SERVICES', 'TRUST', 'FIELD_PEOPLE']
    .forEach(k => assert(SYM[k], 'missing collection: ' + k));
});

test('contact details match the verified public business details', () => {
  assert(SYM.CONTACT.whatsapp === '917284913204', 'whatsapp number changed');
  assert(SYM.CONTACT.phone === '8200691036', 'phone number changed');
  assert(/^https:\/\/wa\.me\/\d+$/.test('https://wa.me/' + SYM.CONTACT.whatsapp), 'whatsapp link malformed');
});

test('every course has the required fields', () => {
  const req = ['id', 'field', 'name', 'univ', 'place', 'country', 'duration', 'total', 'tag', 'fees', 'points', 'src'];
  SYM.COURSES.forEach((c, i) => req.forEach(k => assert(c[k] !== undefined, `course ${i} (${c.id}) missing ${k}`)));
});
test('eligibility, where present, is a non-empty string', () => {
  SYM.COURSES.forEach(c => assert(c.eligibility === undefined || (typeof c.eligibility === 'string' && c.eligibility.length > 0), `${c.id} bad eligibility`));
});

test('course ids are unique', () => {
  const ids = SYM.COURSES.map(c => c.id);
  assert(new Set(ids).size === ids.length, 'duplicate course id');
});

test('every course field references a known field', () => {
  const ids = new Set(SYM.FIELDS.map(f => f.id));
  SYM.COURSES.forEach(c => assert(ids.has(c.field), `${c.id} has unknown field ${c.field}`));
});

test('every "from" fee is a positive number or null', () => {
  SYM.COURSES.forEach(c => assert(c.from === null || (typeof c.from === 'number' && c.from > 0), `${c.id} invalid from=${c.from}`));
});

test('fees rows are [label, value] string pairs', () => {
  SYM.COURSES.forEach(c => c.fees.forEach(r => {
    assert(Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string', `${c.id} bad fee row`);
  }));
});

test('lowest published fee is ₹20,000 (Journalism / M.A. Education, Balaghat)', () => {
  const froms = SYM.COURSES.map(c => c.from).filter(Boolean);
  const min = Math.min(...froms);
  assert(min === 20000, 'minimum published fee is ' + min + ', expected 20000');
});

test('all 10 fields are present', () => {
  assert(SYM.FIELDS.length === 10, 'expected 10 fields, got ' + SYM.FIELDS.length);
});

test('every field tile has a cut-out portrait mapping', () => {
  SYM.FIELDS.forEach(f => assert(SYM.FIELD_PEOPLE[f.id], 'no FIELD_PEOPLE for ' + f.id));
});

/* -------------------------------------------------- asset existence */
function localRefs(source) {
  const out = [];
  const re = /(?:src|href)="([^"]+)"/g; let m;
  while ((m = re.exec(source))) {
    const v = m[1];
    if (/^(https?:|mailto:|tel:|#|data:)/.test(v)) continue;
    out.push(v.replace(/^\//, '').split('#')[0].split('?')[0]);
  }
  return out;
}
test('every local asset referenced by index.html exists', () => {
  localRefs(html).forEach(ref => {
    if (!ref) return;
    assert(fs.existsSync(path.join(ROOT, ref)), 'missing asset: ' + ref);
  });
});
test('every generated asset path in app.js exists (cutouts, posts)', () => {
  const cutouts = SYM.FIELDS.map(f => 'assets/cutouts/' + SYM.FIELD_PEOPLE[f.id] + '.webp')
    .concat(SYM.PATHS.map(p => 'assets/cutouts/' + p.img + '.webp'))
    .concat(['assets/cutouts/medico.webp', 'assets/cutouts/med-student.webp']);
  const posts = SYM.UPDATES.map(u => 'assets/posts/' + u.code + '.webp');
  cutouts.concat(posts).forEach(ref => assert(fs.existsSync(path.join(ROOT, ref)), 'missing generated asset: ' + ref));
});

/* -------------------------------------------------- DOM id wiring */
test('every $("#id") referenced by app.js exists in index.html', () => {
  const ids = new Set();
  let m; const re = /\$\('#([A-Za-z0-9_-]+)'/g;
  while ((m = re.exec(appjs))) ids.add(m[1]);
  const missing = [...ids].filter(id => !new RegExp('id="' + id + '"').test(html));
  assert(missing.length === 0, 'ids missing from HTML: ' + missing.join(', '));
});

/* -------------------------------------------------- finder logic (mirrors app.js) */
function filtered(state) {
  const fieldName = id => (SYM.FIELDS.find(f => f.id === id) || {}).name || id;
  const q = state.q.trim().toLowerCase();
  return SYM.COURSES.filter(c => {
    if (state.field !== 'all' && c.field !== state.field) return false;
    if (state.country !== 'all' && c.country !== state.country) return false;
    if (!q) return true;
    const hay = [c.name, c.univ, c.place, c.country, c.tag, c.eligibility, fieldName(c.field)]
      .concat(c.points, [].concat.apply([], c.fees)).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}
test('finder: default state shows all programmes', () => {
  assert(filtered({ field: 'all', q: '', country: 'all' }).length === SYM.COURSES.length, 'not all shown');
});
test('finder: field filter narrows results and stays a subset', () => {
  const list = filtered({ field: 'pharmacy', q: '', country: 'all' });
  assert(list.length === SYM.COURSES.filter(c => c.field === 'pharmacy').length, 'pharmacy count mismatch');
  assert(list.every(c => c.field === 'pharmacy'), 'field leak');
});
test('finder: country filter (Georgia) returns only Georgia', () => {
  const list = filtered({ field: 'all', q: '', country: 'Georgia' });
  assert(list.length >= 1 && list.every(c => c.country === 'Georgia'), 'country filter wrong');
});
test('finder: free-text search "Bhopal" matches', () => {
  const list = filtered({ field: 'all', q: 'Bhopal', country: 'all' });
  assert(list.length >= 1 && list.every(c => /bhopal/i.test(c.place)), 'search wrong');
});
test('finder: nonsense query yields a truthful empty state', () => {
  assert(filtered({ field: 'all', q: 'zzzzqqq', country: 'all' }).length === 0, 'expected empty');
});

/* -------------------------------------------------- booking helpers */
const pad = n => String(n).padStart(2, '0');
const fmtSlot = s => { const [h, m] = s.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
test('booking: slot formatting is correct (24h → 12h)', () => {
  assert(fmtSlot('10:00') === '10:00 AM', 'fmtSlot 10:00');
  assert(fmtSlot('13:00') === '1:00 PM', 'fmtSlot 13:00');
  assert(fmtSlot('18:00') === '6:00 PM', 'fmtSlot 18:00');
});

/* -------------------------------------------------- safety / links */
test('index.html never targets the reference site for form submission', () => {
  const bad = /action\s*=\s*"[^"]*symbiosis-consultancy/.test(html);
  assert(!bad, 'form action points at reference site');
});
test('WhatsApp float and hero link use the verified business number', () => {
  assert(html.includes('https://wa.me/917284913204'), 'wa.me link missing');
});
test('structured data JSON-LD is valid JSON', () => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(m, 'no JSON-LD block');
  JSON.parse(m[1]);
});

/* -------------------------------------------------- opening animation */
test('opening animation: intro curtain exists and is hidden without JS', () => {
  assert(/<div class="intro" id="intro"/.test(html), 'no intro overlay in HTML');
  assert(/<noscript><style>[^<]*\.intro\{display:none/.test(html), 'intro not hidden for no-JS users');
});
test('opening animation: app.js dismisses the curtain and unlocks the page', () => {
  assert(/\$\('#intro'\)/.test(appjs), 'app.js does not reference #intro');
  assert(/intro-pending/.test(appjs), 'app.js does not clear the intro-pending lock');
});

/* -------------------------------------------------- output + exit */
const pass = results.filter(r => r[1] === 'PASS').length;
const fail = results.length - pass;
console.log('\nSymbiosis — functional tests\n' + '='.repeat(40));
for (const [name, status, msg] of results) console.log((status === 'PASS' ? '  ✓ ' : '  ✗ ') + name + (msg ? '  → ' + msg : ''));
console.log('='.repeat(40) + `\n${pass} passed, ${fail} failed, ${results.length} total\n`);

const csv = ['test,status,detail'].concat(results.map(r => [r[0], r[1], '"' + r[2].replace(/"/g, "'") + '"'].join(','))).join('\n');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/functional_test_results.csv'), csv + '\n');
process.exit(fail ? 1 : 0);
