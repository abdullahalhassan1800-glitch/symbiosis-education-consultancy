'use strict';
/* Role-based access control: canonical permission catalogue + role grants.
   Permissions are persisted (Permission / RolePermission) and seeded from here,
   so the database — not the UI — is the source of truth enforced server-side. */

const PERMISSIONS = [
  ['dashboard:view', 'View dashboard', 'Dashboard'],

  ['courses:read', 'View courses', 'Courses'],
  ['courses:write', 'Create / edit courses', 'Courses'],
  ['courses:publish', 'Publish / unpublish courses', 'Courses'],

  ['institutions:read', 'View universities', 'Universities'],
  ['institutions:write', 'Create / edit universities', 'Universities'],

  ['countries:read', 'View countries', 'Countries'],
  ['countries:write', 'Create / edit countries', 'Countries'],

  ['fees:read', 'View fees & eligibility', 'Fees'],
  ['fees:write', 'Edit fees & eligibility', 'Fees'],

  ['leads:read', 'View student leads', 'Leads'],
  ['leads:write', 'Update student leads', 'Leads'],
  ['leads:assign', 'Assign student leads', 'Leads'],

  ['appointments:read', 'View appointments', 'Appointments'],
  ['appointments:write', 'Manage appointments', 'Appointments'],

  ['enquiries:read', 'View contact enquiries', 'Enquiries'],
  ['enquiries:write', 'Manage contact enquiries', 'Enquiries'],

  ['content:read', 'View website content', 'Content'],
  ['content:write', 'Edit website content', 'Content'],
  ['content:publish', 'Publish website content', 'Content'],

  ['faqs:read', 'View FAQs', 'FAQs'],
  ['faqs:write', 'Edit FAQs', 'FAQs'],

  ['media:read', 'View media library', 'Media'],
  ['media:write', 'Upload / manage media', 'Media'],

  ['staff:read', 'View staff & roles', 'Staff'],
  ['staff:write', 'Manage staff & roles', 'Staff'],

  ['reports:view', 'View reports', 'Reports'],
  ['audit:view', 'View audit logs', 'Audit'],
  ['settings:write', 'Manage application settings', 'Settings'],
].map(([key, label, group]) => ({ key, label, group }));

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

const ROLE_DEFS = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full control of the platform, staff and settings.',
    permissions: ALL_KEYS, // wildcard-equivalent: everything
  },
  admin: {
    name: 'Admin',
    description: 'Manage catalogue, CRM and website content.',
    permissions: [
      'dashboard:view',
      'courses:read', 'courses:write', 'courses:publish',
      'institutions:read', 'institutions:write',
      'countries:read', 'countries:write',
      'fees:read', 'fees:write',
      'leads:read', 'leads:write', 'leads:assign',
      'appointments:read', 'appointments:write',
      'enquiries:read', 'enquiries:write',
      'content:read', 'content:write', 'content:publish',
      'faqs:read', 'faqs:write',
      'media:read', 'media:write',
      'reports:view',
    ],
  },
  counsellor: {
    name: 'Counsellor',
    description: 'Works assigned leads and appointments.',
    permissions: [
      'dashboard:view',
      'leads:read', 'leads:write',
      'appointments:read', 'appointments:write',
      'enquiries:read',
      'courses:read',
    ],
  },
  content_manager: {
    name: 'Content Manager',
    description: 'Maintains public website content, FAQs and media.',
    permissions: [
      'dashboard:view',
      'content:read', 'content:write', 'content:publish',
      'faqs:read', 'faqs:write',
      'media:read', 'media:write',
      'countries:read',
      'courses:read',
    ],
  },
};

const SYSTEM_ROLE_KEYS = Object.keys(ROLE_DEFS);

/* A super admin implicitly holds every permission. */
function roleHasPermission(roleKey, permissionSet, key) {
  if (roleKey === 'super_admin') return true;
  return permissionSet ? permissionSet.has(key) : false;
}

module.exports = {
  PERMISSIONS,
  ALL_KEYS,
  ROLE_DEFS,
  SYSTEM_ROLE_KEYS,
  roleHasPermission,
};
