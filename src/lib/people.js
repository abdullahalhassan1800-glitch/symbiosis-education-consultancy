'use strict';
/* Staff & roles service: validation + business rules shared by the HTML pages
   and the JSON API. All privilege guards live here so they cannot be bypassed
   by calling an endpoint directly. */
const prisma = require('../db');
const { hashPassword, checkPasswordPolicy } = require('./password');
const { validate, z, trimmed, email } = require('./validate');

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const createSchema = z.object({
  name: trimmed(2, 120, 'Name'),
  email: email,
  roleId: z.string().min(1, 'Role is required'),
  password: z.string().min(1, 'Password is required'),
  status: z.enum(['active', 'disabled']).optional(),
});
const updateSchema = z.object({
  name: trimmed(2, 120, 'Name'),
  email: email,
  roleId: z.string().min(1, 'Role is required'),
  status: z.enum(['active', 'disabled']),
});
const passwordSchema = z.object({ password: z.string().min(1, 'Password is required') });

async function activeSuperAdmins(excludeId) {
  return prisma.user.count({
    where: {
      status: 'active',
      deletedAt: null,
      role: { key: 'super_admin' },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
}

function assertPassword(password) {
  const pol = checkPasswordPolicy(password);
  if (!pol.ok) throw httpError(400, 'weak_password', 'Password needs ' + pol.errors.join(', ') + '.');
}

async function assertRole(roleId) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw httpError(400, 'bad_role', 'That role does not exist.');
  return role;
}

async function listStaff({ q = '', status = '', roleId = '', skip = 0, take = 20 } = {}) {
  const where = { deletedAt: null };
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  if (status) where.status = status;
  if (roleId) where.roleId = roleId;
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { role: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
  ]);
  return { total, rows };
}

async function getStaff(id) {
  return prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
}

async function createStaff(input, actor, req) {
  const data = validate(createSchema, input);
  assertPassword(data.password);
  await assertRole(data.roleId);
  const passwordHash = await hashPassword(data.password);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        roleId: data.roleId,
        status: data.status || 'active',
        passwordHash,
        mustChangePassword: true,
      },
      include: { role: true },
    });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'email_taken', 'That email is already in use.');
    throw e;
  }
  return { user, actor, req };
}

async function updateStaff(id, input, actor, req) {
  const data = validate(updateSchema, input);
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!user) throw httpError(404, 'not_found', 'Staff member not found.');

  const losingSuper = user.role.key === 'super_admin' && data.roleId !== user.roleId;
  const disablingSuper = user.role.key === 'super_admin' && user.status === 'active' && data.status === 'disabled';
  if ((losingSuper || disablingSuper) && (await activeSuperAdmins(user.id)) < 1) {
    throw httpError(409, 'last_super_admin', 'Cannot remove the last active super administrator.');
  }
  if (user.id === actor.id && data.status === 'disabled') {
    throw httpError(409, 'self_disable', 'You cannot disable your own account.');
  }
  await assertRole(data.roleId);
  try {
    await prisma.user.update({
      where: { id },
      data: { name: data.name, email: data.email, roleId: data.roleId, status: data.status },
    });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'email_taken', 'That email is already in use.');
    throw e;
  }
}

async function setStaffPassword(id, input, actor, req) {
  const data = validate(passwordSchema, input);
  assertPassword(data.password);
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw httpError(404, 'not_found', 'Staff member not found.');
  const passwordHash = await hashPassword(data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

async function setStaffStatus(id, status, actor, req) {
  if (!['active', 'disabled'].includes(status)) throw httpError(400, 'bad_status', 'Invalid status.');
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!user) throw httpError(404, 'not_found', 'Staff member not found.');
  if (user.id === actor.id && status === 'disabled') throw httpError(409, 'self_disable', 'You cannot disable your own account.');
  if (user.role.key === 'super_admin' && status === 'disabled' && (await activeSuperAdmins(user.id)) < 1) {
    throw httpError(409, 'last_super_admin', 'Cannot disable the last active super administrator.');
  }
  await prisma.user.update({ where: { id }, data: { status } });
  if (status === 'disabled') {
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

async function deleteStaff(id, actor, req) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!user) throw httpError(404, 'not_found', 'Staff member not found.');
  if (user.id === actor.id) throw httpError(409, 'self_delete', 'You cannot delete your own account.');
  if (user.role.key === 'super_admin' && (await activeSuperAdmins(user.id)) < 1) {
    throw httpError(409, 'last_super_admin', 'Cannot delete the last active super administrator.');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'disabled' } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

/* ------------------------------------------------------------------ roles */

async function listRoles() {
  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r._count.users,
    permissions: r.permissions.map((p) => p.permission.key).sort(),
  }));
}

function listPermissions() {
  const rbac = require('./rbac');
  return rbac.PERMISSIONS;
}

async function saveRole(id, { name, description, permissions }, actor, req) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw httpError(404, 'not_found', 'Role not found.');
  if (role.key === 'super_admin') {
    throw httpError(409, 'locked_role', 'The Super Admin role always holds every permission and cannot be edited.');
  }
  const nextName = role.isSystem ? role.name : String(name || role.name).trim();
  const nextDesc = role.isSystem ? role.description : String(description ?? role.description ?? '').trim();
  const keys = Array.isArray(permissions) ? permissions : [];

  await prisma.role.update({ where: { id }, data: { name: nextName, description: nextDesc } });
  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
  if (perms.length) {
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
  }
}

async function createRole({ key, name, description, permissions }, actor, req) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2) throw httpError(400, 'validation', 'Role name is required.');
  const cleanKey =
    String(key || cleanName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'role';
  try {
    const role = await prisma.role.create({ data: { key: cleanKey, name: cleanName, description: String(description || '').trim(), isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: Array.isArray(permissions) ? permissions : [] } } });
    if (perms.length) await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    return role;
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'role_exists', 'A role with that key already exists.');
    throw e;
  }
}

module.exports = {
  httpError,
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  setStaffPassword,
  setStaffStatus,
  deleteStaff,
  listRoles,
  listPermissions,
  saveRole,
  createRole,
};
