import type { Request } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Please sign in to continue.') => new HttpError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'You do not have permission to do that.') => new HttpError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found.') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m: string, details?: unknown) => new HttpError(409, m, 'CONFLICT', details);

/** Validates input with zod and throws a readable 400 error on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path?.join('.') || 'input';
    throw badRequest(`Invalid ${field}: ${first?.message ?? 'invalid value'}`, result.error.issues);
  }
  return result.data;
}

export function clientIp(req: Request): string {
  const ip = req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !v || v.length > 64) throw badRequest(`Invalid ${name}`);
  return v;
}

export function safeJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

