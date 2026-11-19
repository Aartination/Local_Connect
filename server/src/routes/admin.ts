import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config, DATABASE_FILE, readFileConfig, ROOT_DIR, writeFileConfig } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { requireAdmin, requireAuth, requireOwner } from '../middleware/auth.js';
import { getLanAddresses } from '../network.js';
import { activity, audit } from '../services/audit.js';
import { hashPassword, passwordProblem, USERNAME_RE } from '../services/auth.js';
import { createBackup, deleteBackup, listBackups, restoreBackup } from '../services/backup.js';
import { addUserToTeam, broadcastConversation, createSystemMessage } from '../services/conversations.js';
import { presence } from '../services/presence.js';
import { disconnectSession, disconnectUser, emitToAll } from '../services/realtime.js';
import { fileDto, userDto } from '../services/serializers.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { CATEGORY_DIRS, dirSize, diskSpace, moveFile, STORAGE_ROOT, storagePath } from '../services/storage.js';
import { badRequest, conflict, forbidden, notFound, param, parse, safeJson } from '../utils/http.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const SERVER_STARTED_AT = Date.now();

async function storageBreakdown() {
  const categories: Record<string, { bytes: number; files: number }> = {};
  let totalBytes = 0;
  let totalFiles = 0;
  for (const [cat, dir] of Object.entries(CATEGORY_DIRS)) {
    const s = await dirSize(path.join(STORAGE_ROOT, dir));
    categories[cat] = s;
    totalBytes += s.bytes;
    totalFiles += s.files;
  }
  const [users, thumbnails, trash, disk] = await Promise.all([
    dirSize(path.join(STORAGE_ROOT, 'users')),
    dirSize(path.join(STORAGE_ROOT, 'thumbnails')),
    dirSize(path.join(STORAGE_ROOT, 'trash')),
    diskSpace(STORAGE_ROOT),
  ]);
  const dbSize = fs.existsSync(DATABASE_FILE) ? (await fsp.stat(DATABASE_FILE)).size : 0;
  return {
    storageDir: STORAGE_ROOT,
    categories,
    users,
    thumbnails,
    trash,
    dbSize,
    totalBytes: totalBytes + users.bytes + thumbnails.bytes + trash.bytes,
    totalFiles,
    disk,
  };
}

// ---- Overview ----
adminRouter.get('/overview', async (_req, res) => {
  const [
    totalUsers,
    activeUsers,
    totalMessages,
    totalFiles,
    activeSessions,
    storage,
    recentActivity,
    recentAudit,
    settings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.message.count({ where: { deletedAt: null } }),
    prisma.file.count({ where: { deletedAt: null } }),
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
    storageBreakdown(),
    prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { actor: { select: { id: true, username: true, displayName: true } } },
    }),
    getSettings(),
  ]);

  const lan = getLanAddresses();
  const mem = process.memoryUsage();
  res.json({
    users: {
      total: totalUsers,
      active: activeUsers,
      online: presence.onlineUserIds().length,
      maxUsers: settings.maxUsers,
    },
    messages: { total: totalMessages },
    files: { total: totalFiles },
    sessions: { active: activeSessions, liveSockets: presence.connectionCount() },
    storage,
    server: {
      version: config.version,
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      startedAt: new Date(SERVER_STARTED_AT).toISOString(),
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      httpPort: config.port,
      httpsPort: config.httpsPort,
      httpsEnabled: config.enableHttps,
      lanAddresses: lan,
    },
    recentActivity,
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      target: a.target,
      details: safeJson(a.details, {}),
      ip: a.ip,
      createdAt: a.createdAt,
      actor: a.actor,
    })),
  });
});

// ---- User Management ----
adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: {
      _count: {
        select: {
          sessions: { where: { expiresAt: { gt: new Date() } } },
          messages: true,
          files: true,
        },
      },
    },
  });
  res.json({
    users: users.map((u) => ({
      ...userDto(u),
      sessionCount: u._count.sessions,
      messageCount: u._count.messages,
      fileCount: u._count.files,
    })),
  });
});

adminRouter.post('/users', async (req, res) => {
  const body = parse(
    z.object({
      username: z.string().trim().toLowerCase().regex(USERNAME_RE, '3-24 chars: lowercase, digits, . _ -'),
      displayName: z.string().trim().min(1).max(40),
      password: z.string().min(8).max(128),
      role: z.enum(['PARTNER', 'ADMIN']).default('PARTNER'),
    }),
    req.body,
  );
  const problem = passwordProblem(body.password);
  if (problem) throw badRequest(problem);
  if (body.role === 'ADMIN' && req.user!.role !== 'OWNER') {
    throw forbidden('Only the owner can create administrator accounts.');
  }
  const settings = await getSettings();
  const activeCount = await prisma.user.count({ where: { isActive: true } });
  if (activeCount >= settings.maxUsers) {
    throw conflict(`Workspace limit (${settings.maxUsers} active members) reached. Increase it in Settings first.`);
  }
  if (await prisma.user.findUnique({ where: { username: body.username } })) {
    throw conflict('Username already exists.');
  }
  const user = await prisma.user.create({
    data: {
      username: body.username,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      role: body.role,
    },
  });
  const team = await addUserToTeam(user.id);
  emitToAll('user:upsert', userDto(user));
  await createSystemMessage(team.id, `${user.displayName} was added to the team`);
  await broadcastConversation(team.id);
  await audit(req, 'USER_CREATED', user.username, { role: user.role });
  await activity(req.user!.id, 'MEMBER_JOINED', `${user.displayName} joined the workspace`, 'user', user.id);
  res.status(201).json({ user: userDto(user) });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!target) throw notFound('User not found.');
  const body = parse(
    z.object({
      isActive: z.boolean().optional(),
      role: z.enum(['PARTNER', 'ADMIN']).optional(),
      displayName: z.string().trim().min(1).max(40).optional(),
    }),
    req.body,
  );
  if (target.role === 'OWNER') throw forbidden('The owner account cannot be modified here.');
  if (target.id === req.user!.id && body.isActive === false) throw forbidden('You cannot deactivate yourself.');
  if (body.role !== undefined && req.user!.role !== 'OWNER') {
    throw forbidden('Only the owner can change user roles.');
  }
  if (body.isActive === true && !target.isActive) {
    const settings = await getSettings();
    const activeCount = await prisma.user.count({ where: { isActive: true } });
    if (activeCount >= settings.maxUsers) {
      throw conflict(`Workspace limit (${settings.maxUsers} active members) reached.`);
    }
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data: body });
  if (body.isActive === false) {
    await prisma.session.deleteMany({ where: { userId: target.id } });
    await disconnectUser(target.id, 'account_deactivated');
  }
  emitToAll('user:upsert', userDto(updated));
  await audit(req, 'USER_UPDATED', updated.username, body);
  res.json({ user: userDto(updated) });
});

adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!target) throw notFound('User not found.');
  if (target.role === 'OWNER' && req.user!.id !== target.id) {
    throw forbidden('Only the owner can reset the owner password.');
  }
  const { newPassword } = parse(z.object({ newPassword: z.string().min(8).max(128) }), req.body);
  const problem = passwordProblem(newPassword);
  if (problem) throw badRequest(problem);

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await prisma.session.deleteMany({ where: { userId: target.id } });
  await disconnectUser(target.id, 'password_reset');
  await audit(req, 'USER_PASSWORD_RESET', target.username);
  res.json({ ok: true });
});

adminRouter.delete('/users/:id', requireOwner, async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!target) throw notFound('User not found.');
  if (target.role === 'OWNER' || target.id === req.user!.id) {
    throw forbidden('The owner account cannot be deleted.');
  }
  await disconnectUser(target.id, 'account_deleted');
  await prisma.user.delete({ where: { id: target.id } });
  emitToAll('user:removed', { id: target.id });
  await audit(req, 'USER_DELETED', target.username);
  res.json({ ok: true });
});

// ---- Invitations ----
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n: number) =>
    Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
  return `LH-${part(4)}-${part(4)}`;
}

adminRouter.get('/invitations', async (_req, res) => {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true } },
      usedBy: { select: { id: true, username: true, displayName: true } },
    },
  });
  res.json({ invitations });
});

adminRouter.post('/invitations', async (req, res) => {
  const body = parse(
    z.object({
      role: z.enum(['PARTNER', 'ADMIN']).default('PARTNER'),
      note: z.string().trim().max(120).default(''),
      expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
    }),
    req.body,
  );
  if (body.role === 'ADMIN' && req.user!.role !== 'OWNER') {
    throw forbidden('Only the owner can create administrator invitations.');
  }
  const code = generateInviteCode();
  const invitation = await prisma.invitation.create({
    data: {
      code,
      role: body.role,
      note: body.note,
      createdById: req.user!.id,
      expiresAt: new Date(Date.now() + body.expiresInHours * 3600 * 1000),
    },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true } },
      usedBy: { select: { id: true, username: true, displayName: true } },
    },
  });
  await audit(req, 'INVITATION_CREATED', code, { role: body.role, expiresInHours: body.expiresInHours });
  res.status(201).json({ invitation });
});

adminRouter.delete('/invitations/:id', async (req, res) => {
  const inv = await prisma.invitation.findUnique({ where: { id: param(req, 'id') } });
  if (!inv) throw notFound('Invitation not found.');
  await prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit(req, 'INVITATION_REVOKED', inv.code);
  res.json({ ok: true });
});

// ---- Active Sessions ----
adminRouter.get('/sessions', async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
    include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
  });
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      user: s.user,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      current: s.id === req.session!.id,
    })),
  });
});

adminRouter.delete('/sessions/:id', async (req, res) => {
  const id = param(req, 'id');
  const s = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!s) throw notFound('Session not found.');
  await prisma.session.delete({ where: { id } });
  await disconnectSession(id, 'admin_revoked');
  await audit(req, 'SESSION_REVOKED', s.user.username, { sessionId: id });
  res.json({ ok: true });
});

// ---- Group Permissions ----
adminRouter.get('/conversations', async (_req, res) => {
  const convs = await prisma.conversation.findMany({
    where: { type: { in: ['TEAM', 'GROUP'] } },
    include: {
      _count: { select: { members: true, messages: true } },
    },
    orderBy: [{ type: 'desc' }, { lastMessageAt: 'desc' }],
  });
  res.json({
    conversations: convs.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      description: c.description,
      onlyAdminsCanPost: c.onlyAdminsCanPost,
      membersCanInvite: c.membersCanInvite,
      memberCount: c._count.members,
      messageCount: c._count.messages,
      createdAt: c.createdAt,
    })),
  });
});

adminRouter.patch('/conversations/:id', async (req, res) => {
  const cid = param(req, 'id');
  const conv = await prisma.conversation.findUnique({ where: { id: cid } });
  if (!conv || conv.type === 'DIRECT') throw notFound('Group not found.');
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      description: z.string().trim().max(300).optional(),
      onlyAdminsCanPost: z.boolean().optional(),
      membersCanInvite: z.boolean().optional(),
    }),
    req.body,
  );
  const updated = await prisma.conversation.update({ where: { id: cid }, data: body });
  await broadcastConversation(cid);
  await audit(req, 'GROUP_PERMISSIONS_UPDATED', updated.name, body);
  res.json({ conversation: updated });
});

// ---- Settings & Server Config ----
adminRouter.get('/settings', async (_req, res) => {
  const [runtime, fileCfg] = await Promise.all([getSettings(), Promise.resolve(readFileConfig())]);
  res.json({
    runtime,
    serverConfig: {
      port: fileCfg.port,
      httpsPort: fileCfg.httpsPort,
      enableHttps: fileCfg.enableHttps,
      storageDir: fileCfg.storageDir,
      resolvedStorageDir: STORAGE_ROOT,
      sessionDays: fileCfg.sessionDays,
    },
  });
});

adminRouter.patch('/settings', async (req, res) => {
  const body = parse(
    z.object({
      workspaceName: z.string().trim().min(1).max(40).optional(),
      maxFileSizeMB: z.coerce.number().int().min(1).max(10240).optional(),
      allowedExtensions: z
        .array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,10}$/))
        .min(1)
        .max(100)
        .optional(),
      maxUsers: z.coerce.number().int().min(2).max(50).optional(),
      port: z.coerce.number().int().min(1024).max(65535).optional(),
      httpsPort: z.coerce.number().int().min(1024).max(65535).optional(),
      enableHttps: z.boolean().optional(),
      storageDir: z.string().trim().min(1).max(260).optional(),
      sessionDays: z.coerce.number().int().min(1).max(365).optional(),
    }),
    req.body,
  );

  const runtimePatch: any = {};
  if (body.workspaceName !== undefined) runtimePatch.workspaceName = body.workspaceName;
  if (body.maxFileSizeMB !== undefined) runtimePatch.maxFileSizeMB = body.maxFileSizeMB;
  if (body.allowedExtensions !== undefined) runtimePatch.allowedExtensions = [...new Set(body.allowedExtensions)];
  if (body.maxUsers !== undefined) runtimePatch.maxUsers = body.maxUsers;
  const runtime = await updateSettings(runtimePatch);

  let restartRequired = false;
  const cfgPatch: any = {};
  if (body.port !== undefined && body.port !== config.port) {
    cfgPatch.port = body.port;
    restartRequired = true;
  }
  if (body.httpsPort !== undefined && body.httpsPort !== config.httpsPort) {
    cfgPatch.httpsPort = body.httpsPort;
    restartRequired = true;
  }
  if (body.enableHttps !== undefined && body.enableHttps !== config.enableHttps) {
    cfgPatch.enableHttps = body.enableHttps;
    restartRequired = true;
  }
  if (body.sessionDays !== undefined) cfgPatch.sessionDays = body.sessionDays;
  if (body.storageDir !== undefined) {
    const resolved = path.isAbsolute(body.storageDir) ? body.storageDir : path.resolve(ROOT_DIR, body.storageDir);
    if (resolved !== STORAGE_ROOT) {
      if (req.user!.role !== 'OWNER') throw forbidden('Only the owner can change the storage directory.');
      fs.mkdirSync(resolved, { recursive: true });
      cfgPatch.storageDir = body.storageDir;
      restartRequired = true;
    }
  }
  if (Object.keys(cfgPatch).length > 0) writeFileConfig(cfgPatch);

  if (body.workspaceName) emitToAll('workspace:renamed', { workspaceName: runtime.workspaceName });
  await audit(req, 'SETTINGS_UPDATED', '', { runtimePatch, cfgPatch });
  res.json({ runtime, serverConfig: readFileConfig(), restartRequired });
});

// ---- Storage & Files Moderation ----
adminRouter.get('/storage', async (_req, res) => {
  res.json(await storageBreakdown());
});

adminRouter.post('/storage/consistency-check', async (req, res) => {
  const dbFiles = await prisma.file.findMany({ where: { deletedAt: null } });
  const missingOnDisk: Array<{ id: string; name: string; relPath: string }> = [];
  const trackedPaths = new Set<string>();

  for (const f of dbFiles) {
    const abs = storagePath(f.relPath);
    trackedPaths.add(path.normalize(abs));
    if (!fs.existsSync(abs)) missingOnDisk.push({ id: f.id, name: f.originalName, relPath: f.relPath });
  }

  const untrackedOnDisk: string[] = [];
  for (const dir of Object.values(CATEGORY_DIRS)) {
    const root = path.join(STORAGE_ROOT, dir);
    async function walk(d: string) {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && !trackedPaths.has(path.normalize(p))) {
          untrackedOnDisk.push(path.relative(STORAGE_ROOT, p));
        }
      }
    }
    await walk(root);
  }

  // Clean up stale upload sessions older than 12 hours
  const cutoff = new Date(Date.now() - 12 * 3600 * 1000);
  const staleSessions = await prisma.uploadSession.findMany({ where: { updatedAt: { lt: cutoff } } });
  for (const s of staleSessions) {
    await fsp.unlink(storagePath(path.join('tmp', `${s.id}.part`))).catch(() => {});
  }
  await prisma.uploadSession.deleteMany({ where: { id: { in: staleSessions.map((s) => s.id) } } });

  await audit(req, 'STORAGE_CONSISTENCY_CHECK', '', {
    checked: dbFiles.length,
    missingOnDisk: missingOnDisk.length,
    untrackedOnDisk: untrackedOnDisk.length,
    staleUploadsCleaned: staleSessions.length,
  });

  res.json({
    checked: dbFiles.length,
    missingOnDisk,
    untrackedOnDisk,
    staleUploadsCleaned: staleSessions.length,
    healthy: missingOnDisk.length === 0 && untrackedOnDisk.length === 0,
  });
});

adminRouter.post('/storage/purge-trash', async (req, res) => {
  const trashDir = path.join(STORAGE_ROOT, 'trash');
  const before = await dirSize(trashDir);
  const entries = await fsp.readdir(trashDir).catch(() => []);
  for (const e of entries) {
    await fsp.rm(path.join(trashDir, e), { recursive: true, force: true }).catch(() => {});
  }
  await audit(req, 'TRASH_PURGED', '', before);
  res.json({ ok: true, freedBytes: before.bytes, removedFiles: before.files });
});

adminRouter.get('/files', async (req, res) => {
  const q = parse(
    z.object({
      q: z.string().max(100).optional(),
      category: z.string().max(20).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    req.query,
  );
  const files = await prisma.file.findMany({
    where: {
      deletedAt: null,
      ...(q.category ? { category: q.category } : {}),
      ...(q.q ? { originalName: { contains: q.q } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    include: { uploader: { select: { id: true, username: true, displayName: true } } },
  });
  res.json({
    files: files.map((f) => ({ ...fileDto(f), uploader: f.uploader })),
  });
});

adminRouter.delete('/files/:id', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file) throw notFound('File not found.');
  const permanent = req.query.permanent === '1' || req.query.permanent === 'true';

  const src = storagePath(file.relPath);
  if (permanent) {
    if (fs.existsSync(src)) await fsp.unlink(src).catch(() => {});
    if (file.thumbPath) await fsp.unlink(storagePath(file.thumbPath)).catch(() => {});
    await fsp.unlink(storagePath(path.join('trash', file.storedName))).catch(() => {});
    await prisma.file.delete({ where: { id: file.id } });
  } else {
    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date(), pinned: false } });
    if (fs.existsSync(src)) await moveFile(src, storagePath(path.join('trash', file.storedName))).catch(() => {});
  }
  if (file.scope === 'WORKSPACE') emitToAll('workspace:file-deleted', { id: file.id });
  await audit(req, permanent ? 'ADMIN_FILE_PURGED' : 'ADMIN_FILE_DELETED', file.originalName, { fileId: file.id });
  res.json({ ok: true });
});

// ---- Backups & Restore ----
adminRouter.get('/backups', async (_req, res) => {
  res.json({ backups: await listBackups() });
});

adminRouter.post('/backups', async (req, res) => {
  const body = parse(
    z.object({ includeFiles: z.boolean().default(true), note: z.string().max(200).default('') }),
    req.body || {},
  );
  const manifest = await createBackup(body);
  await audit(req, 'BACKUP_CREATED', manifest.name, { includeFiles: manifest.includeFiles, totalSize: manifest.totalSize });
  res.status(201).json({ backup: manifest });
});

adminRouter.post('/backups/:name/restore', requireOwner, async (req, res) => {
  const name = param(req, 'name');
  const result = await restoreBackup(name);
  await audit(req, 'BACKUP_RESTORED', name, result);
  emitToAll('system:reloaded', { reason: 'backup_restored' });
  res.json({ ok: true, ...result });
});

adminRouter.delete('/backups/:name', requireOwner, async (req, res) => {
  const name = param(req, 'name');
  await deleteBackup(name);
  await audit(req, 'BACKUP_DELETED', name);
  res.json({ ok: true });
});

// ---- Audit & Server Logs ----
adminRouter.get('/audit', async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { id: true, username: true, displayName: true } } },
  });
  res.json({
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      target: l.target,
      details: safeJson(l.details, {}),
      ip: l.ip,
      createdAt: l.createdAt,
      actor: l.actor,
    })),
  });
});

adminRouter.get('/logs', async (req, res) => {
  const q = parse(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      lines: z.coerce.number().int().min(10).max(1000).default(250),
    }),
    req.query,
  );
  const dates = logger.listFiles();
  const lines = q.date ? logger.readTail(q.lines, q.date) : logger.readTail(q.lines);
  res.json({ dates, lines: lines.length ? lines : logger.recent(q.lines) });
});

