'use strict';
/* Small server-rendered form/field helpers shared by the catalogue pages. */
const { esc } = require('./render');

function field({ label, name, value = '', type = 'text', required = false, placeholder = '', hint = '', attrs = '' }) {
  return `<label class="field"><span>${esc(label)}${required ? ' *' : ''}</span>` +
    `<input type="${esc(type)}" name="${esc(name)}" value="${esc(value == null ? '' : value)}"` +
    `${required ? ' required' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} ${attrs}>` +
    `${hint ? `<em class="hint">${esc(hint)}</em>` : ''}</label>`;
}

function textarea({ label, name, value = '', rows = 4, required = false, hint = '', placeholder = '' }) {
  return `<label class="field"><span>${esc(label)}${required ? ' *' : ''}</span>` +
    `<textarea name="${esc(name)}" rows="${rows}"${required ? ' required' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(value == null ? '' : value)}</textarea>` +
    `${hint ? `<em class="hint">${esc(hint)}</em>` : ''}</label>`;
}

function select({ label, name, value = '', options = [], required = false, hint = '' }) {
  const opts = options
    .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('');
  return `<label class="field"><span>${esc(label)}${required ? ' *' : ''}</span>` +
    `<select name="${esc(name)}"${required ? ' required' : ''}>${opts}</select>` +
    `${hint ? `<em class="hint">${esc(hint)}</em>` : ''}</label>`;
}

function checkbox({ label, name, checked = false, value = '1' }) {
  return `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
}

function pager(base, page, total, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const link = (p) => `${base}${base.includes('?') ? '&' : '?'}page=${p}`;
  const parts = [];
  if (page > 1) parts.push(`<a class="pg" href="${esc(link(page - 1))}">← Prev</a>`);
  parts.push(`<span class="pg-info">Page ${page} of ${pages} · ${total} total</span>`);
  if (page < pages) parts.push(`<a class="pg" href="${esc(link(page + 1))}">Next →</a>`);
  return `<div class="pager">${parts.join('')}</div>`;
}

function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : '';
}
function fmtDateTime(d) {
  return d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

module.exports = { field, textarea, select, checkbox, pager, fmtDate, fmtDateTime, STATUS_OPTIONS };
