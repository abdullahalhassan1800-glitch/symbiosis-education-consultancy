'use strict';
/* Small HTTP helpers: client IP, consistent JSON envelope. */

function clientIp(req) {
  if (!req) return '';
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return xf || (req.socket && req.socket.remoteAddress) || '';
}

function userAgent(req) {
  return String((req && req.headers['user-agent']) || '').slice(0, 300);
}

function ok(res, data, pagination) {
  const body = { ok: true, data };
  if (pagination) body.pagination = pagination;
  return res.json(body);
}

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function wantsJson(req) {
  return (
    (req.path || '').startsWith('/api') ||
    /application\/json/.test(req.headers.accept || '') ||
    req.xhr === true
  );
}

/* Express 4 does not forward rejected promises from async handlers to the error
   middleware. Wrapping the router's route methods makes any thrown/rejected
   handler call next(err), so errors return a clean response instead of crashing
   the process. Middleware (`.use`) is left untouched. */
function wrapRouter(router) {
  ['get', 'post', 'put', 'patch', 'delete', 'all'].forEach((method) => {
    const original = router[method].bind(router);
    router[method] = (...args) => {
      const handler = args[args.length - 1];
      if (typeof handler === 'function' && handler.length < 4) {
        args[args.length - 1] = (req, res, next) =>
          Promise.resolve(handler(req, res, next)).catch(next);
      }
      return original(...args);
    };
  });
  return router;
}

module.exports = { clientIp, userAgent, ok, fail, wantsJson, wrapRouter };
