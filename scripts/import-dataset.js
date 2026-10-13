'use strict';
/* One-time import of the VERIFIED dataset from js/data.js into the database.
   Faithful, non-inventive mapping only:

     • Settings  — the verified CONTACT block (contact.* keys the site reads).
     • FAQs      — every published FAQ entry.
     • Countries — only clean single-country names (grouped labels such as
                   "Russia, Ukraine & India" are skipped).

   Courses are deliberately NOT imported. The public site renders the verified
   static dataset for courses, and the DB course model does not yet carry the
   dataset's points/total/source/university fields — importing them would make
   the live site lose content. Keep this script non-destructive: it upserts or
   skips existing rows, so it is safe to run repeatedly. */
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'js', 'data.js'));
const SYM = global.window.SYM || {};
const prisma = require('../src/db');

const ISO = { India: 'IN', Georgia: 'GE' };

async function importSettings() {
  const c = SYM.CONTACT || {};
  const map = {
    'contact.session': c.session,
    'contact.phone': c.phone,
    'contact.phoneDisplay': c.phoneDisplay,
    'contact.whatsapp': c.whatsapp,
    'contact.instagram': c.instagram,
    'contact.instagramUrl': c.instagramUrl,
    'contact.bio': c.bio,
    'contact.tagline': c.tagline,
  };
  let n = 0;
  for (const [key, value] of Object.entries(map)) {
    if (!value) continue;
    await prisma.setting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
    n++;
  }
  return n;
}

async function importFaqs() {
  const faqs = Array.isArray(SYM.FAQ) ? SYM.FAQ : [];
  let n = 0;
  let pos = 0;
  for (const pair of faqs) {
    const question = String(pair[0] || '').trim();
    const answer = String(pair[1] || '').trim();
    if (!question || !answer) continue;
    const existing = await prisma.faq.findFirst({ where: { question } });
    if (!existing) {
      await prisma.faq.create({ data: { question, answer, position: pos, status: 'published' } });
      n++;
    }
    pos++;
  }
  return n;
}

async function importCountries() {
  const names = new Set();
  for (const c of SYM.COURSES || []) {
    const name = String(c.country || '').trim();
    if (!name) continue;
    if (/[,&/]/.test(name)) continue; // skip grouped labels, not a single country
    names.add(name);
  }
  let n = 0;
  for (const name of names) {
    const existing = await prisma.country.findUnique({ where: { name } });
    if (existing) continue;
    await prisma.country.create({ data: { name, code: ISO[name] || null, status: 'published' } });
    n++;
  }
  return n;
}

async function main() {
  const settings = await importSettings();
  const faqs = await importFaqs();
  const countries = await importCountries();
  console.log(
    `Dataset import complete: ${settings} settings, ${faqs} new FAQs, ${countries} new countries.`
  );
  console.log('Courses were NOT imported — the public site keeps the verified static dataset.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
