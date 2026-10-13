'use strict';
/* `npm run db:demo` — inserts clearly-labelled DEMO data (5 rows per module)
   so the admin console and dashboard can be explored with content.
   Idempotent: re-running adds nothing new. Nothing here is real business data.
   Publish-sensitive records (countries, courses, FAQs, content, testimonials)
   are created as DRAFT so the public website keeps its verified content. */
const prisma = require('../src/db');

const YEAR = '2026–27';

async function ensure(model, where, data) {
  const existing = await prisma[model].findFirst({ where });
  if (existing) return { row: existing, created: false };
  const row = await prisma[model].create({ data });
  return { row, created: true };
}

async function seedCountries() {
  const rows = [
    { name: 'Russia', code: 'RU', overview: 'Demo record — English-medium MBBS destination.' },
    { name: 'Kazakhstan', code: 'KZ', overview: 'Demo record — affordable medical education.' },
    { name: 'Uzbekistan', code: 'UZ', overview: 'Demo record — growing MBBS destination.' },
    { name: 'Kyrgyzstan', code: 'KG', overview: 'Demo record — low-cost medical programmes.' },
    { name: 'Philippines', code: 'PH', overview: 'Demo record — US-pattern medical curriculum.' },
  ];
  const out = [];
  let created = 0;
  for (const r of rows) {
    const res = await ensure('country', { name: r.name }, { ...r, status: 'draft' });
    if (res.created) created++;
    out.push(res.row);
  }
  return { created, rows: out };
}

async function seedInstitutions(countries) {
  const byCode = Object.fromEntries(countries.map((c) => [c.code, c.id]));
  const rows = [
    { name: 'Demo International Medical University', slug: 'demo-imu', city: 'Moscow', code: 'RU' },
    { name: 'Demo Caspian Medical Academy', slug: 'demo-caspian-medical', city: 'Almaty', code: 'KZ' },
    { name: 'Demo Samarkand Medical Institute', slug: 'demo-samarkand-medical', city: 'Samarkand', code: 'UZ' },
    { name: 'Demo Bishkek Medical College', slug: 'demo-bishkek-medical', city: 'Bishkek', code: 'KG' },
    { name: 'Demo Manila Health Sciences University', slug: 'demo-manila-health', city: 'Manila', code: 'PH' },
  ];
  const out = [];
  let created = 0;
  for (const r of rows) {
    const res = await ensure(
      'institution',
      { slug: r.slug },
      {
        name: r.name,
        slug: r.slug,
        city: r.city,
        countryId: byCode[r.code] || null,
        officialWebsite: 'https://example.edu/demo',
        description: 'Demo university record used to populate the admin console.',
        verificationStatus: 'unverified',
        status: 'draft',
      }
    );
    if (res.created) created++;
    out.push(res.row);
  }
  return { created, rows: out };
}

async function seedCourses(institutions) {
  const inst = Object.fromEntries(institutions.map((i) => [i.slug, i]));
  const rows = [
    { name: 'MBBS (Demo)', slug: 'demo-mbbs', publicId: 'demo-mbbs', category: 'mbbs', country: 'Russia', city: 'Moscow', duration: '5.5 years', eligibility: '10+2 with PCB, NEET qualified', tuitionFee: 350000, institutionSlug: 'demo-imu' },
    { name: 'BDS (Demo)', slug: 'demo-bds', publicId: 'demo-bds', category: 'dental', country: 'Kazakhstan', city: 'Almaty', duration: '5 years', eligibility: '10+2 with PCB', tuitionFee: 280000, institutionSlug: 'demo-caspian-medical' },
    { name: 'B.Sc Nursing (Demo)', slug: 'demo-bsc-nursing', publicId: 'demo-bsc-nursing', category: 'nursing', country: 'Philippines', city: 'Manila', duration: '4 years', eligibility: '10+2 with PCB', tuitionFee: 120000, institutionSlug: 'demo-manila-health' },
    { name: 'B.Pharm (Demo)', slug: 'demo-bpharm', publicId: 'demo-bpharm', category: 'pharmacy', country: 'Uzbekistan', city: 'Samarkand', duration: '4 years', eligibility: '10+2 with PCB/PCM', tuitionFee: 110000, institutionSlug: 'demo-samarkand-medical' },
    { name: 'BPT Physiotherapy (Demo)', slug: 'demo-bpt', publicId: 'demo-bpt', category: 'physiotherapy', country: 'Kyrgyzstan', city: 'Bishkek', duration: '4.5 years', eligibility: '10+2 with PCB', tuitionFee: 130000, institutionSlug: 'demo-bishkek-medical' },
  ];
  const out = [];
  let created = 0;
  for (const r of rows) {
    const res = await ensure(
      'course',
      { slug: r.slug },
      {
        name: r.name,
        slug: r.slug,
        publicId: r.publicId,
        category: r.category,
        country: r.country,
        city: r.city,
        duration: r.duration,
        eligibility: r.eligibility,
        tuitionFee: r.tuitionFee,
        currency: 'INR',
        academicYear: YEAR,
        institutionId: inst[r.institutionSlug] ? inst[r.institutionSlug].id : null,
        status: 'draft',
        featured: false,
      }
    );
    if (res.created) created++;
    out.push(res.row);
  }

  // 5 fee records, one per demo course.
  let feesCreated = 0;
  for (const c of out) {
    const res = await ensure(
      'feeRecord',
      { courseId: c.id, label: 'Tuition (Year 1)' },
      { courseId: c.id, label: 'Tuition (Year 1)', amount: c.tuitionFee, currency: 'INR', academicYear: YEAR, kind: 'tuition', status: 'draft' }
    );
    if (res.created) feesCreated++;
  }
  return { created, feesCreated };
}

async function seedLeads() {
  const rows = [
    { studentName: 'Demo Student One', phone: '9000000001', status: 'new', source: 'website', courseInterest: 'MBBS' },
    { studentName: 'Demo Student Two', phone: '9000000002', status: 'contacted', source: 'instagram', courseInterest: 'B.Sc Nursing' },
    { studentName: 'Demo Student Three', phone: '9000000003', status: 'follow_up', source: 'referral', courseInterest: 'BDS' },
    { studentName: 'Demo Student Four', phone: '9000000004', status: 'converted', source: 'whatsapp', courseInterest: 'B.Pharm' },
    { studentName: 'Demo Student Five', phone: '9000000005', status: 'qualified', source: 'other', courseInterest: 'BPT' },
  ];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res = await ensure(
      'lead',
      { reference: 'DEMO-LEAD-' + (i + 1) },
      { reference: 'DEMO-LEAD-' + (i + 1), ...r, consentStatus: true, notes: 'Demo record.' }
    );
    if (res.created) created++;
  }
  return { created };
}

async function seedAppointments() {
  const rows = [
    { studentName: 'Demo Student One', status: 'pending' },
    { studentName: 'Demo Student Two', status: 'confirmed' },
    { studentName: 'Demo Student Three', status: 'completed' },
    { studentName: 'Demo Student Four', status: 'cancelled' },
    { studentName: 'Demo Student Five', status: 'rescheduled' },
  ];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const when = new Date();
    when.setDate(when.getDate() + (i + 1));
    when.setHours(10 + i, 0, 0, 0);
    const res = await ensure(
      'appointment',
      { reference: 'DEMO-APT-' + (i + 1) },
      { reference: 'DEMO-APT-' + (i + 1), studentName: r.studentName, contactNumber: '900000000' + (i + 1), email: 'demo' + (i + 1) + '@example.com', courseInterest: 'MBBS', scheduledAt: when, meetingType: 'call', status: r.status, notes: 'Demo record.' }
    );
    if (res.created) created++;
  }
  return { created };
}

async function seedEnquiries() {
  const rows = [
    { name: 'Demo Enquiry One', subject: 'Fees structure', status: 'new' },
    { name: 'Demo Enquiry Two', subject: 'Hostel facilities', status: 'contacted' },
    { name: 'Demo Enquiry Three', subject: 'Admission process', status: 'resolved' },
    { name: 'Demo Enquiry Four', subject: 'Scholarship', status: 'new' },
    { name: 'Demo Enquiry Five', subject: 'Visa help', status: 'spam' },
  ];
  let created = 0;
  for (const r of rows) {
    const res = await ensure(
      'contactEnquiry',
      { name: r.name, sourcePage: 'demo-seed' },
      { name: r.name, contact: '9000000000', email: 'enquiry@example.com', subject: r.subject, message: 'Demo enquiry message for admin preview.', sourcePage: 'demo-seed', consentStatus: true, status: r.status }
    );
    if (res.created) created++;
  }
  return { created };
}

async function seedFaqs() {
  const rows = [
    { question: 'Demo: How do I apply for MBBS abroad?', answer: 'Demo answer — the real process is explained during counselling.' },
    { question: 'Demo: Are the universities recognised?', answer: 'Demo answer — recognition details are verified case by case.' },
    { question: 'Demo: What documents are required?', answer: 'Demo answer — documents are shared after a profile review.' },
    { question: 'Demo: Do you help with visas?', answer: 'Demo answer — end-to-end guidance is provided.' },
    { question: 'Demo: What are the fees?', answer: 'Demo answer — fees are shared transparently before payment.' },
  ];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const res = await ensure('faq', { question: rows[i].question }, { ...rows[i], category: 'Demo', position: 100 + i, status: 'draft' });
    if (res.created) created++;
  }
  return { created };
}

async function seedTestimonials() {
  const rows = [
    { name: 'Demo Student One', course: 'MBBS — Russia', city: 'Bhopal', rating: 5 },
    { name: 'Demo Student Two', course: 'B.Sc Nursing — Philippines', city: 'Indore', rating: 5 },
    { name: 'Demo Student Three', course: 'BDS — Kazakhstan', city: 'Jabalpur', rating: 4 },
    { name: 'Demo Student Four', course: 'B.Pharm — Uzbekistan', city: 'Gwalior', rating: 5 },
    { name: 'Demo Student Five', course: 'BPT — Kyrgyzstan', city: 'Bhopal', rating: 4 },
  ];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res = await ensure(
      'testimonial',
      { name: r.name, message: 'Demo testimonial text for admin preview only.' },
      { name: r.name, course: r.course, city: r.city, message: 'Demo testimonial text for admin preview only.', rating: r.rating, consentStatus: true, position: i, status: 'draft' }
    );
    if (res.created) created++;
  }
  return { created };
}

async function seedMedia() {
  const rows = [
    { filename: 'hero-classroom.jpg', path: '/assets/photos/hero-classroom.jpg', altText: 'Counselling session (demo)' },
    { filename: 'counselling.jpg', path: '/assets/photos/counselling.jpg', altText: 'Student counselling (demo)' },
    { filename: 'students-1.jpg', path: '/assets/photos/students-1.jpg', altText: 'Graduates (demo)' },
    { filename: 'tbilisi.jpg', path: '/assets/photos/tbilisi.jpg', altText: 'Campus city (demo)' },
    { filename: 'step-study.jpg', path: '/assets/photos/step-study.jpg', altText: 'Study abroad (demo)' },
  ];
  let created = 0;
  for (const r of rows) {
    const res = await ensure('mediaAsset', { path: r.path }, { filename: r.filename, mimeType: 'image/jpeg', size: 0, path: r.path, altText: r.altText });
    if (res.created) created++;
  }
  return { created };
}

async function seedContent() {
  const rows = [
    { key: 'demo.notice.1', value: 'Demo content entry — safe to delete.', type: 'text' },
    { key: 'demo.notice.2', value: 'Demo content entry — safe to delete.', type: 'text' },
    { key: 'demo.notice.3', value: 'Demo content entry — safe to delete.', type: 'text' },
    { key: 'demo.notice.4', value: 'Demo content entry — safe to delete.', type: 'text' },
    { key: 'demo.notice.5', value: 'Demo content entry — safe to delete.', type: 'text' },
  ];
  let created = 0;
  for (const r of rows) {
    const res = await ensure('websiteContent', { key: r.key }, { ...r, status: 'draft' });
    if (res.created) created++;
  }
  return { created };
}

async function main() {
  const countries = await seedCountries();
  const institutions = await seedInstitutions(countries.rows);
  const courses = await seedCourses(institutions.rows);
  const leads = await seedLeads();
  const appts = await seedAppointments();
  const enquiries = await seedEnquiries();
  const faqs = await seedFaqs();
  const testimonials = await seedTestimonials();
  const media = await seedMedia();
  const content = await seedContent();

  console.log('Demo seed complete (draft-safe for the public site):');
  console.log(`  countries   +${countries.created}`);
  console.log(`  universities +${institutions.created}`);
  console.log(`  courses     +${courses.created} (fees +${courses.feesCreated})`);
  console.log(`  leads       +${leads.created}`);
  console.log(`  appointments +${appts.created}`);
  console.log(`  enquiries   +${enquiries.created}`);
  console.log(`  faqs        +${faqs.created}`);
  console.log(`  testimonials +${testimonials.created}`);
  console.log(`  media       +${media.created}`);
  console.log(`  content     +${content.created}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
