'use strict';
/* Idempotent seeding of the RBAC catalogue (permissions, roles and grants).
   Used by `npm run db:seed`, `admin:create` and the test bootstrap. */
const rbac = require('./rbac');

async function syncRbac(prisma) {
  for (const p of rbac.PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label, group: p.group },
      create: p,
    });
  }

  for (const [key, def] of Object.entries(rbac.ROLE_DEFS)) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: def.name, description: def.description, isSystem: true },
      create: { key, name: def.name, description: def.description, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: def.permissions } },
    });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }
}

module.exports = { syncRbac };
