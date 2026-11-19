import type { Request } from 'express';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { clientIp } from '../utils/http.js';
import { emitToAll } from './realtime.js';

/** Records an administrative / security relevant action. */
export async function audit(req: Request | null, action: string, target = '', details: unknown = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req?.user?.id ?? null,
        action,
        target,
        details: JSON.stringify(details ?? {}),
        ip: req ? clientIp(req) : '',
      },
    });
    logger.info(`AUDIT ${action} by ${req?.user?.username ?? 'system'} ${target}`);
  } catch (e) {
    logger.error('Failed to write audit log', e);
  }
}

/** Adds an entry to the team activity feed and pushes it to everyone. */
export async function activity(
  userId: string | null,
  type: string,
  summary: string,
  entityType = '',
  entityId = '',
) {
  try {
    const a = await prisma.activity.create({
      data: { userId, type, summary, entityType, entityId },
    });
    emitToAll('activity:new', a);
  } catch (e) {
    logger.error('Failed to record activity', e);
  }
}

