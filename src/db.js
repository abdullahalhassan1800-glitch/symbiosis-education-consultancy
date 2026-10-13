'use strict';
/* Single PrismaClient instance (reused across serverless invocations). */
const { PrismaClient } = require('@prisma/client');
const config = require('./config');

const g = globalThis;
const prisma =
  g.__symPrisma ||
  new PrismaClient({
    log: config.isProd ? ['error'] : ['error', 'warn'],
    errorFormat: 'minimal',
  });

if (!config.isProd) g.__symPrisma = prisma;

module.exports = prisma;
