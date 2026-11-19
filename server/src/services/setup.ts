import crypto from 'node:crypto';
import fs from 'node:fs';
import { SETUP_TOKEN_FILE } from '../config.js';
import { prisma } from '../db.js';

/**
 * First-run protection: until the owner account exists, creating it requires a
 * one-time setup code that is only shown in the host's server console (and in
 * config/setup-token.txt). This stops anyone else on the Wi-Fi from claiming
 * the workspace before the owner does.
 */
let token: string | null = null;

export async function needsSetup() {
  return (await prisma.user.count()) === 0;
}

export async function ensureSetupToken(): Promise<string | null> {
  if (!(await needsSetup())) {
    clearSetupToken();
    return null;
  }
  if (!token) {
    try {
      token = fs.readFileSync(SETUP_TOKEN_FILE, 'utf8').trim() || null;
    } catch {
      token = null;
    }
  }
  if (!token) {
    token = crypto.randomInt(100000, 999999).toString() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    fs.writeFileSync(SETUP_TOKEN_FILE, token);
  }
  return token;
}

export function checkSetupToken(input: string) {
  if (!token) return false;
  const a = Buffer.from(input.trim().toUpperCase());
  const b = Buffer.from(token.toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clearSetupToken() {
  token = null;
  try {
    fs.unlinkSync(SETUP_TOKEN_FILE);
  } catch {
    /* already gone */
  }
}

