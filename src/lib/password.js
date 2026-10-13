'use strict';
/* Password hashing with scrypt (Node built-in — no native build, strong KDF).
   Format: scrypt$N$r$p$<salt-b64>$<hash-b64>                              */
const crypto = require('crypto');

const N = 16384; // CPU/memory cost (2^14)
const R = 8;
const P = 1;
const KEYLEN = 64;
const MIN_LENGTH = 10;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password), salt, KEYLEN, { N, r: R, p: P }, (err, dk) => {
      if (err) return reject(err);
      resolve(
        `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`
      );
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    try {
      const parts = String(stored).split('$');
      if (parts[0] !== 'scrypt' || parts.length !== 6) return resolve(false);
      const n = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      const salt = Buffer.from(parts[4], 'base64');
      const expected = Buffer.from(parts[5], 'base64');
      crypto.scrypt(String(password), salt, expected.length, { N: n, r, p }, (err, dk) => {
        if (err) return resolve(false);
        resolve(dk.length === expected.length && crypto.timingSafeEqual(dk, expected));
      });
    } catch {
      resolve(false);
    }
  });
}

/* Password policy used by create-admin, reset and change-password. */
function checkPasswordPolicy(password) {
  const errors = [];
  const pw = String(password || '');
  if (pw.length < MIN_LENGTH) errors.push(`at least ${MIN_LENGTH} characters`);
  if (!/[a-z]/.test(pw)) errors.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) errors.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) errors.push('a number');
  return { ok: errors.length === 0, errors };
}

module.exports = { hashPassword, verifyPassword, checkPasswordPolicy, MIN_LENGTH };
