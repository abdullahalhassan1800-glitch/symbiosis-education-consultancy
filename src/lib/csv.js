'use strict';
/* Minimal RFC-4180-style CSV parser/serialiser (no dependencies). */

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && String(r[0]).trim() !== ''));
}

function stringify(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/* Parse into objects keyed by the (trimmed) header row. */
function toObjects(text) {
  const rows = parse(text);
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => String(h).trim());
  const out = rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] === undefined ? '' : r[idx]; });
    return o;
  });
  return { header, rows: out };
}

module.exports = { parse, stringify, toObjects };
