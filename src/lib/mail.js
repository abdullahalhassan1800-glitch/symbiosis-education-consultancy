'use strict';
/* Minimal mailer. When SMTP_URL is configured this is a seam for a real
   provider; otherwise it logs to the server console so password-reset links
   remain usable in development without hardcoding any account. */
const config = require('../config');

async function sendMail({ to, subject, text }) {
  if (config.mail.smtpUrl) {
    // A real SMTP integration would be wired here. Kept as an explicit seam so
    // no credentials or provider assumptions live in the codebase.
    console.log(`[mail] (SMTP configured — not sent here) to=${to} subject=${subject}`);
    return { delivered: false, reason: 'smtp-not-implemented' };
  }
  console.log('\n[mail:dev] No SMTP configured. Message follows:');
  console.log(`  to: ${to}\n  subject: ${subject}\n  ${text}\n`);
  return { delivered: false, reason: 'no-transport' };
}

module.exports = { sendMail };
