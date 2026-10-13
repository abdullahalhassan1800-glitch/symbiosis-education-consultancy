'use strict';
/* Vercel serverless entry — exposes the Express app (handles /admin and /api).
   Static site files are served directly by Vercel, and vercel.json rewrites
   /admin/* and /api/* to this function. */
const { createApp } = require('../src/server');

module.exports = createApp();
