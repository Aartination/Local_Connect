import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { parseCookie } from 'cookie';
import type { Session, User } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { clientIp } from '../utils/http.js';

export const SESSION_COOKIE = 'lh_session';
const BCRYPT_COST = 12;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, BCRYPT_COST);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

// A precomputed hash used to keep login timing constant for unknown usernames.
let dummyHash: string | null = null;
export async function dummyVerify(pw: string) {
  if (!dummyHash) dummyHash = await bcrypt.hash('localhub-dummy-password', BCRYPT_COST);
  await bcrypt.compare(pw, dummyHash);
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, req: Request) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: clientIp(req),
      expiresAt: new Date(Date.now() + config.sessionDays * 24 * 3600 * 1000),
    },
  });
  return { token, session };
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
    maxAge: config.sessionDays * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' });
}

export function tokenFromHeaders(headers: Record<string, any>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  const cookieHeader = headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const cookies = parseCookie(cookieHeader);
    return cookies[SESSION_COOKIE] || null;
  }
  return null;
}

const TOUCH_INTERVAL = 5 * 60 * 1000;

/** Resolves a raw token to a valid session + active user, or null. */
export async function resolveSession(token: string | null): Promise<{ session: Session; user: User } | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (Date.now() - session.lastActiveAt.getTime() > TOUCH_INTERVAL) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
      .catch(() => {});
  }
  const { user, ...rest } = session;
  return { session: rest as Session, user };
}

export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

