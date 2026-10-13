'use strict';
/* One-time bootstrap CLI for the FIRST super administrator.
 *
 *   npm run admin:create            (interactive)
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
 *   npm run admin:create -- --force (reset an existing account's password)
 *
 * The password is hashed before storage and is never printed. This command is
 * intentionally NOT exposed over HTTP and there is no public admin signup.
 */
const readline = require('readline');
const prisma = require('../src/db');
const config = require('../src/config');
const { hashPassword, checkPasswordPolicy } = require('../src/lib/password');
const { syncRbac } = require('../src/lib/seed');

function makeRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}
function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a)));
}
function askHidden(rl, q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const original = rl._writeToOutput;
    rl._writeToOutput = function () {};
    rl.question('', (answer) => {
      rl._writeToOutput = original;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const force = process.argv.includes('--force');
  await syncRbac(prisma);

  let email = config.admin.email;
  let name = config.admin.name;
  let password = config.admin.password;

  const needPrompt = !email || !password;
  const rl = needPrompt ? makeRl() : null;

  if (!email) email = (await ask(rl, 'Super admin email address: ')).trim().toLowerCase();
  if (!name) name = (await ask(rl, 'Full name: ')).trim();
  if (!password) {
    password = await askHidden(rl, 'Password (hidden): ');
    const confirm = await askHidden(rl, 'Confirm password: ');
    if (password !== confirm) {
      if (rl) rl.close();
      console.error('\nError: passwords do not match.');
      process.exit(1);
    }
  }
  if (rl) rl.close();

  if (!EMAIL_RE.test(email)) {
    console.error('\nError: enter a valid email address.');
    process.exit(1);
  }
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    console.error('\nError: password needs ' + policy.errors.join(', ') + '.');
    process.exit(1);
  }

  const role = await prisma.role.findUnique({ where: { key: 'super_admin' } });
  if (!role) throw new Error('super_admin role missing — run `npm run db:seed` first.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !force) {
    console.error(
      `\nError: a user with ${email} already exists. Re-run with --force to reset its password.`
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, name: name || existing.name, roleId: role.id, status: 'active', deletedAt: null, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      })
    : await prisma.user.create({
        data: { email, name: name || 'Super Admin', passwordHash, roleId: role.id, status: 'active' },
      });

  await prisma.auditLog.create({
    data: { action: existing ? 'staff.password_reset_cli' : 'staff.created_cli', actorEmail: email, entity: 'User', entityId: user.id },
  });

  console.log(`\n✓ Super admin ready: ${user.email} (${user.name})`);
  console.log('  Sign in at /admin/login');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
