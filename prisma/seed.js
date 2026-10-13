'use strict';
/* `npm run db:seed` — seeds the RBAC catalogue and default availability slots.
   Contains NO fabricated production content (no fake courses/leads/reviews). */
const prisma = require('../src/db');
const { syncRbac } = require('../src/lib/seed');

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function timeSteps(start, end, step) {
  const out = [];
  let [h, m] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  while (h * 60 + m < eh * 60 + em) {
    const t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    out.push(t);
    m += step;
    h += Math.floor(m / 60);
    m %= 60;
  }
  return out;
}

async function seedAvailability() {
  const slots = [];
  for (let weekday = 1; weekday <= 6; weekday++) {
    for (const t of timeSteps('10:00', '17:00', 30)) {
      slots.push({ weekday, startTime: t, endTime: addMinutes(t, 30) });
    }
  }
  for (const s of slots) {
    await prisma.availabilitySlot.upsert({
      where: { weekday_startTime: { weekday: s.weekday, startTime: s.startTime } },
      update: {},
      create: s,
    });
  }
  return slots.length;
}

async function main() {
  await syncRbac(prisma);
  const n = await seedAvailability();
  console.log(`Seed complete: permissions/roles synced, ${n} availability slots ensured.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
