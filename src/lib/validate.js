'use strict';
/* Validation helper built on zod. Throws a 400-shaped error the error handler
   converts into a consistent response — no stack traces leak to clients. */
const { z } = require('zod');

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.code = 'validation';
    err.details = result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw err;
  }
  return result.data;
}

const trimmed = (min, max, label = 'value') =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

const optionalString = (max = 5000) => z.string().trim().max(max).optional().or(z.literal(''));

module.exports = { z, validate, trimmed, email, optionalString };
