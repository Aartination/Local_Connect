import type { NextFunction, Request, Response } from 'express';
import type { Session, User } from '@prisma/client';
import { resolveSession, tokenFromHeaders } from '../services/auth.js';
import { forbidden, unauthorized } from '../utils/http.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const resolved = await resolveSession(tokenFromHeaders(req.headers));
  if (!resolved) return next(unauthorized());
  req.user = resolved.user;
  req.session = resolved.session;
  next();
}

export const isAdmin = (u?: User | null) => !!u && (u.role === 'OWNER' || u.role === 'ADMIN');

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isAdmin(req.user)) return next(forbidden('Administrator access required.'));
  next();
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'OWNER') return next(forbidden('Only the workspace owner can do that.'));
  next();
}

