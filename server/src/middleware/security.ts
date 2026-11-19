import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';
import { forbidden } from '../utils/http.js';

/**
 * Origin check: LOCAL HUB serves the UI and the API from the same origin, so
 * state-changing requests must come from a page served by this host.
 * Combined with SameSite=Strict cookies this blocks CSRF from other sites.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // same-origin navigations / non-browser clients (token auth still required)
  try {
    const o = new URL(origin);
    if (host && o.host === host) return true;
    if (config.extraOrigins.includes(origin)) return true;
    // Vite dev server (port 5173) proxies to us in development
    if (config.isDev && o.port === '5173') return true;
  } catch {
    return false;
  }
  return false;
}

export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (!isAllowedOrigin(origin, config.isDev ? host : req.headers.host)) {
    return next(forbidden('Cross-origin request blocked.'));
  }
  next();
}

const json429 = (message: string) => ({
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  message: { error: message, code: 'RATE_LIMITED' },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1200,
  ...json429('Too many requests. Please slow down.'),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip || '')}:${String(req.body?.username || '').toLowerCase().slice(0, 30)}`,
  ...json429('Too many failed sign-in attempts. Try again in 15 minutes.'),
});

export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  ...json429('Too many attempts. Try again later.'),
});

