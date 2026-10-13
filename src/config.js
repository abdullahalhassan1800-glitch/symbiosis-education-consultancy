'use strict';
/* Central configuration. Reads environment variables only — no secrets in code. */
require('dotenv').config();

const path = require('path');
const env = process.env;

function bool(v, d) {
  if (v === undefined || v === null || v === '') return d;
  return v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
}

const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const config = {
  env: nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  root: path.resolve(__dirname, '..'),
  appOrigin: env.APP_ORIGIN || 'http://localhost:4173',

  session: {
    cookieName: env.SESSION_COOKIE_NAME || 'sym_admin_sid',
    ttlHours: Number(env.SESSION_TTL_HOURS || 12),
    secure: bool(env.COOKIE_SECURE, isProd),
    sameSite: 'lax',
    csrfCookieName: 'sym_csrf',
  },

  login: {
    maxFailures: Number(env.LOGIN_MAX_FAILURES || 8),
    windowMinutes: Number(env.LOGIN_WINDOW_MINUTES || 15),
    lockMinutes: Number(env.LOGIN_LOCK_MINUTES || 15),
  },

  admin: {
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || '',
  },

  mail: {
    smtpUrl: env.SMTP_URL || '',
    from: env.MAIL_FROM || '',
  },

  integration: {
    // Shared key for the read-only records API (Google Sheets sync, etc.).
    sheetsKey: env.SHEETS_SYNC_KEY || '',
    // Apps Script web-app URL that receives new CRM records (push webhook).
    sheetsWebhookUrl: env.SHEETS_WEBHOOK_URL || '',
  },

  uploadsDir: path.resolve(__dirname, '..', 'uploads'),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 4 * 1024 * 1024),
};

module.exports = config;
