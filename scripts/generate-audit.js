/* ============================================================================
   Generates the content-extraction / audit artefacts in docs/ from the same
   verified dataset the website uses, so the audit and the site can never drift.
   Run:  node scripts/generate-audit.js
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(DOCS, { recursive: true });

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), sandbox, { filename: 'data.js' });
const S = sandbox.SYM;

const BASE = 'https://symbiosis-consultancy.vercel.app';
const STAMP = '2026-10-14T00:00:00Z';
const write = (name, content) => fs.writeFileSync(path.join(DOCS, name), content);
const csvCell = v => {
  v = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const csv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

/* ------------------------------------------------- website_inventory.csv */
write('website_inventory.csv', csv([
  ['url', 'http_status', 'page_title', 'meta_description', 'canonical', 'renders_without_js', 'extraction_status', 'extracted_at'],
  [`${BASE}/`, '200', 'Symbiosis Education Consultancy — Admissions 2026–27',
    'Strategic guidance for medical & professional degrees. Admissions in India and overseas — MBBS, AYUSH, Pharmacy, Nursing, Paramedical, Engineering, MBA and more.',
    `${BASE}/`, 'partial (course lists/stats render from js/data.js)', 'complete', STAMP],
  [`${BASE}/robots.txt`, '404', '', '', '', 'n/a', 'not present on reference', STAMP],
  [`${BASE}/sitemap.xml`, '404', '', '', '', 'n/a', 'not present on reference', STAMP],
  [`${BASE}/js/data.js`, '200', '', '', '', 'n/a', 'content dataset extracted', STAMP],
  [`${BASE}/js/main.js`, '200', '', '', '', 'n/a', 'client behaviour extracted', STAMP],
  [`${BASE}/css/styles.css`, '200', '', '', '', 'n/a', 'styling reference extracted', STAMP]
]));

/* ------------------------------------------------- page_content.json */
write('page_content.json', JSON.stringify({
  source: BASE,
  extracted_at: STAMP,
  title: 'Symbiosis Education Consultancy — Admissions 2026–27',
  meta_description: 'Strategic guidance for medical & professional degrees. Admissions in India and overseas — MBBS, AYUSH, Pharmacy, Nursing, Paramedical, Engineering, MBA and more. Book a 1:1 counselling session.',
  headings: {
    h1: ['Your future. Our guidance.'],
    h2: [
      'Every professional degree, one honest guide',
      'Confused about college admissions?',
      'Your dream college. A transparent admission process.',
      'Real courses. Real fees. No surprises.',
      'From confusion to convocation.',
      'Wear the white coat — in India or abroad.',
      'From first call to confirmed seat in four steps',
      'Your dreams. Our guidance. A better tomorrow.',
      'Pick a day. Pick a time. We\'ll call you.',
      'Straight answers before you pay anything',
      'Fresh from our Instagram',
      'Your dream course is just a call away.'
    ]
  },
  contact: S.CONTACT,
  counts: { fields: S.FIELDS.length, courses: S.COURSES.length, faqs: S.FAQ.length, updates: S.UPDATES.length },
  sections: [
    'Hero', 'Trust strip', 'Courses (bento)', 'CTA band', 'Approach', 'Fee finder',
    'Photo band', 'Overseas MBBS', 'Process', 'Brand + stats', 'Booking', 'FAQ', 'Instagram updates', 'Final CTA', 'Footer'
  ]
}, null, 2) + '\n');

/* ------------------------------------------------- page_content.md */
write('page_content.md', `# Symbiosis Education Consultancy — extracted page content

Source: ${BASE} · extracted ${STAMP}

## Meta
- **Title:** Symbiosis Education Consultancy — Admissions 2026–27
- **Description:** Strategic guidance for medical & professional degrees. Admissions in India and overseas — MBBS, AYUSH, Pharmacy, Nursing, Paramedical, Engineering, MBA and more.

## Section order (matches the reference)
1. Hero — *Your future. Our guidance.*
2. Trust strip
3. Courses (bento grid) — *Every professional degree, one honest guide*
4. CTA band — *Confused about college admissions?*
5. Approach — *Your dream college. A transparent admission process.*
6. Fee finder — *Real courses. Real fees. No surprises.*
7. Photo band — *From confusion to convocation.*
8. Overseas MBBS — *Wear the white coat — in India or abroad.*
9. Process — *From first call to confirmed seat in four steps*
10. Brand + stats — *Your dreams. Our guidance. A better tomorrow.*
11. Booking — *Pick a day. Pick a time. We'll call you.*
12. FAQ — *Straight answers before you pay anything*
13. Instagram updates — *Fresh from our Instagram*
14. Final CTA — *Your dream course is just a call away.*
15. Footer

## Contact (verified)
- Phone / WhatsApp (posters): ${S.CONTACT.phoneDisplay}
- Booking WhatsApp (bio link): wa.me/${S.CONTACT.whatsapp}
- Instagram: @${S.CONTACT.instagram}

## Counts
- ${S.FIELDS.length} fields · ${S.COURSES.length} programmes · ${S.FAQ.length} FAQs · ${S.UPDATES.length} Instagram updates
`);

/* ------------------------------------------------- courses_and_fees.csv */
{
  const rows = [['course_id', 'course_name', 'category', 'institution', 'country', 'place', 'duration', 'eligibility', 'key_fee', 'lowest_yearly_fee_inr', 'currency', 'academic_year', 'source_url', 'verification_status']];
  S.COURSES.forEach(c => rows.push([
    c.id, c.name, (S.FIELDS.find(f => f.id === c.field) || {}).name, c.univ, c.country, c.place, c.duration,
    c.eligibility || 'Not specified in source', c.total, c.from || '', 'INR', '2026–27',
    `https://www.instagram.com/reel/${c.src}/`, c.verified ? 'verified — public source' : 'unverified'
  ]));
  write('courses_and_fees.csv', csv(rows));
}

/* ------------------------------------------------- courses_and_fees (fee detail) */
{
  const rows = [['course_id', 'fee_label', 'fee_value']];
  S.COURSES.forEach(c => c.fees.forEach(f => rows.push([c.id, f[0], f[1]])));
  write('courses_fee_lines.csv', csv(rows));
}

/* ------------------------------------------------- universities_and_countries.csv */
write('universities_and_countries.csv', csv([
  ['institution', 'country', 'city_or_region', 'recognition_details', 'programmes_referenced', 'official_website', 'verification_status'],
  ['Caucasus International University (CIU)', 'Georgia', 'Tbilisi', 'NMC & WHO approved (as stated in source)', 'MBBS in Georgia', 'https://www.ciu.edu.ge/en', 'verified from public source; recognition to be re-confirmed with NMC/WHO'],
  ['RGPV University', 'India', 'Madhya Pradesh', 'State technological university', 'B.Pharm, D.Pharm', 'https://www.rgpv.ac.in', 'verified from public source'],
  ['Sardar Patel University', 'India', 'Balaghat, Madhya Pradesh', 'University offer referenced', 'UG/PG/Diploma courses', '', 'offer referenced; official domain not confirmed'],
  ['VNSGU (Veer Narmad South Gujarat University)', 'India', 'Gujarat', 'State university', 'BPT — Physiotherapy', 'https://www.vnsgu.ac.in', 'verified from public source'],
  ['PCI-approved pharmacy colleges', 'India', 'Gwalior, Bhopal, MP', 'PCI approved (as stated)', 'B.Pharm, D.Pharm, M.Pharm', 'https://www.pci.nic.in', 'category, not a specific college'],
  ['UGC-recognised universities', 'India', 'Pan-India', 'UGC recognised (as stated)', 'Working-professional degrees, PhD, M.Tech', 'https://www.ugc.gov.in', 'category, not a specific university']
]));

/* ------------------------------------------------- faqs.json */
write('faqs.json', JSON.stringify(S.FAQ.map(f => ({ question: f[0], answer: f[1], source: 'reference website', verified: true })), null, 2) + '\n');

/* ------------------------------------------------- links */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const linkRe = /href="([^"]+)"/g;
const internal = [], external = [];
let m;
while ((m = linkRe.exec(html))) {
  const v = m[1];
  if (v.startsWith('#')) internal.push(['anchor', v, 'in-page section link']);
  else if (/^(mailto:|tel:)/.test(v)) external.push(['contact', v, '']);
  else if (/^https?:/.test(v)) external.push(['external', v, v.includes('instagram') ? 'official Instagram' : 'reference/third-party']);
  else internal.push(['page', v, 'local page/asset']);
}
write('internal_links.csv', csv([['type', 'target', 'note']].concat(internal)));
write('external_links.csv', csv([['type', 'url', 'note']].concat(external)));

/* ------------------------------------------------- assets_inventory.csv */
{
  const rows = [['path', 'type', 'bytes', 'referenced_by', 'status']];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    rows.push([rel, path.extname(e.name).slice(1), fs.statSync(full).size, '', 'present']);
  });
  walk(path.join(ROOT, 'assets'));
  // sort by path for stable output
  const head = rows.shift(); rows.sort((a, b) => a[0].localeCompare(b[0]));
  write('assets_inventory.csv', csv([head].concat(rows)));
}

/* ------------------------------------------------- forms_and_fields.json */
{
  const fields = [];
  const fieldRe = /<(input|select|textarea)\b[^>]*name="([^"]+)"[^>]*>/g;
  let fm;
  while ((fm = fieldRe.exec(html))) {
    const tag = fm[0];
    fields.push({
      tag: fm[1], name: fm[2],
      type: (tag.match(/type="([^"]+)"/) || [, null])[1],
      required: /\brequired\b/.test(tag),
      placeholder: (tag.match(/placeholder="([^"]+)"/) || [, null])[1]
    });
  }
  write('forms_and_fields.json', JSON.stringify({
    forms: [{
      id: 'bkForm', purpose: 'Book a 1:1 counselling session',
      submission: 'client-side only — builds a WhatsApp deep link, no server storage',
      fields
    }]
  }, null, 2) + '\n');
}

/* ------------------------------------------------- structured_data.json */
{
  const sd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  write('structured_data.json', JSON.stringify({ blocks: sd ? [JSON.parse(sd[1])] : [] }, null, 2) + '\n');
}

/* ------------------------------------------------- crawl_errors.csv */
write('crawl_errors.csv', csv([
  ['url', 'status', 'note'],
  [`${BASE}/robots.txt`, '404', 'no robots.txt on reference'],
  [`${BASE}/sitemap.xml`, '404', 'no sitemap on reference'],
  [`${BASE}/sitemap_index.xml`, '404', 'no sitemap index on reference'],
  [`${BASE}/assets/posts/Ddbbk4Yzqcv.webp`, '404', 'case-mismatch probe; correct file is Ddbbk4YzqCv.webp']
]));

console.log('Audit artefacts written to docs/');
