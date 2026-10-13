'use strict';
/* Express application factory. Used by the local server and, in production, by
   the serverless entry (api/index.js). Static site assets are only mounted when
   serveStatic is requested (local dev); on Vercel the platform serves them. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { attachUser } = require('./middleware/auth');
const { memoryLimiter } = require('./lib/ratelimit');
const { esc } = require('./lib/render');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const staffRoutes = require('./routes/staff');
const countriesRoutes = require('./routes/countries');
const institutionsRoutes = require('./routes/institutions');
const coursesRoutes = require('./routes/courses');
const crmRoutes = require('./routes/crm');
const contentRoutes = require('./routes/content');
const testimonialsRoutes = require('./routes/testimonials');
const publicRoutes = require('./routes/public');
const reportsRoutes = require('./routes/reports');
const overseasRoutes = require('./routes/overseas');
const integrationsRoutes = require('./routes/integrations');

function createApp(opts = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers (applied to every response).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    if (config.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Coarse rate limit for API + admin surfaces (login has its own DB-backed lock).
  app.use(['/api', '/admin'], memoryLimiter({ windowMs: 60 * 1000, max: 300 }));

  app.use(attachUser);

  app.use(authRoutes);
  app.use(adminRoutes);
  app.use(staffRoutes);
  app.use(countriesRoutes);
  app.use(institutionsRoutes);
  app.use(coursesRoutes);
  app.use(crmRoutes);
  app.use(contentRoutes);
  app.use(testimonialsRoutes);
  app.use(publicRoutes);
  app.use(reportsRoutes);
  app.use(overseasRoutes);
  app.use(integrationsRoutes);

  if (opts.serveStatic) {
    app.use('/css', express.static(path.join(config.root, 'css')));
    app.use('/js', express.static(path.join(config.root, 'js')));
    app.use('/assets', express.static(path.join(config.root, 'assets')));
    if (fs.existsSync(config.uploadsDir)) {
      app.use('/uploads', express.static(config.uploadsDir));
    }
    const files = ['index.html', 'privacy.html', 'terms.html', '404.html', 'robots.txt', 'sitemap.xml'];
    files.forEach((f) => app.get('/' + f, (req, res) => res.sendFile(path.join(config.root, f))));
    app.get('/', (req, res) => res.sendFile(path.join(config.root, 'index.html')));
  }

  // JSON 404 for the API namespace.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Not found.' } });
    }
    next();
  });

  if (opts.serveStatic) {
    app.use((req, res) => res.status(404).sendFile(path.join(config.root, '404.html')));
  }

  // Central error handler — never leaks stack traces or secrets.
  app.use((err, req, res, next) => {
    const status = Number(err.status) || 500;
    if (status >= 500) console.error('[error]', err.message);
    if (req.path.startsWith('/api')) {
      return res.status(status).json({
        ok: false,
        error: {
          code: err.code || (status >= 500 ? 'server_error' : 'error'),
          message: status >= 500 ? 'Something went wrong.' : err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
    }
    res
      .status(status)
      .type('html')
      .send(
        `<!doctype html><meta name="robots" content="noindex"><title>${status}</title>` +
          `<h1>${status}</h1><p>${esc(status >= 500 ? 'Something went wrong.' : err.message)}</p>`
      );
  });

  return app;
}

module.exports = { createApp };
