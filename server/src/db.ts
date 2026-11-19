import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { DATABASE_DIR, DATABASE_FILE } from './config.js';
import { logger } from './logger.js';

fs.mkdirSync(DATABASE_DIR, { recursive: true });
// Always use an absolute path so the DB location never depends on the CWD.
process.env.DATABASE_URL = `file:${DATABASE_FILE.replace(/\\/g, '/')}`;

export let prisma = new PrismaClient();

export async function initDatabase() {
  await prisma.$connect();
  // Wait instead of failing when another statement holds the write lock.
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
}

/** Disconnects, runs `fn` (e.g. swapping the DB file), then reconnects. */
export async function withDatabaseDetached(fn: () => Promise<void> | void) {
  await prisma.$disconnect();
  try {
    await fn();
  } finally {
    prisma = new PrismaClient();
    await initDatabase();
    logger.info('Database reconnected');
  }
}

