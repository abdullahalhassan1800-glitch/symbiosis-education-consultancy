'use strict';
/* Shared server-render helpers for admin module pages. */
const { layout } = require('./render');
const { navFor } = require('../routes/admin');

/* Common flash codes shared by the catalogue modules. */
const FLASH = {
  created: ['ok', 'Created successfully.'],
  updated: ['ok', 'Changes saved.'],
  deleted: ['ok', 'Deleted.'],
  imported: ['ok', 'Import complete.'],
  published: ['ok', 'Published.'],
  unpublished: ['ok', 'Moved to draft.'],
  duplicate: ['error', 'A record with those unique values already exists.'],
  in_use: ['error', 'That record is still in use and cannot be deleted.'],
  not_found: ['error', 'Record not found.'],
  validation: ['error', 'Please check the submitted values and try again.'],
  bad_csv: ['error', 'The CSV could not be parsed, or a required column is missing.'],
};

function flash(req) {
  const okCode = req.query.ok;
  const errCode = req.query.err;
  if (okCode && FLASH[okCode]) return { kind: FLASH[okCode][0], message: FLASH[okCode][1] };
  if (errCode && FLASH[errCode]) return { kind: FLASH[errCode][0], message: FLASH[errCode][1] };
  if (errCode) return { kind: 'error', message: String(errCode).slice(0, 300) };
  return null;
}

function errCode(e) {
  return e && e.code && FLASH[e.code] ? e.code : 'validation';
}

function shell(req, title, active, body, flashOverride) {
  return layout({
    title,
    user: req.user,
    nav: navFor(req.permissions, req.user.role.key),
    active,
    body,
    csrfToken: req.session.csrfToken,
    flash: flashOverride || flash(req),
  });
}

module.exports = { shell, flash, errCode, FLASH };
