import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAdmin, requireAuth } from '../middleware/auth.js';
import { loginLimiter, sensitiveLimiter } from '../middleware/security.js';
import { activity, audit } from '../services/audit.js';
import {
  clearSessionCookie,
  createSession,
  dummyVerify,
  hashPassword,
  passwordProblem,
  setSessionCookie,
  USERNAME_RE,
  verifyPassword,
} from '../services/auth.js';
import { addUserToTeam, createSystemMessage, broadcastConversation } from '../services/conversations.js';
import { disconnectSession, disconnectUser, emitToAll } from '../services/realtime.js';
import { userDto } from '../services/serializers.js';
import { getSettings } from '../services/settings.js';
import { checkSetupToken, clearSetupToken, needsSetup } from '../services/setup.js';
import { badRequest, conflict, forbidden, notFound, param, parse, unauthorized } from '../utils/http.js';

export const authRouter = Router();

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, '3-24 characters: lowercase letters, numbers, dot, dash or underscore');
const displayNameSchema = z.string().trim().min(1).max(40);
const passwordSchema = z.string().min(1).max(128);

function checkPassword(pw: string) {
  const problem = passwordProblem(pw);
  if (problem) throw badRequest(problem);
}

async function startSession(req: any, res: any, userId: string) {
  const { token, session } = await createSession(userId, req);
  setSessionCookie(req, res, token);
  return { token, sessionId: session.id };
}

// ---- First-run owner setup ----
authRouter.post('/setup', sensitiveLimiter, async (req, res) => {
  const body = parse(
    z.object({
      setupCode: z.string().min(4).max(40),
      username: usernameSchema,
      displayName: displayNameSchema,
      password: passwordSchema,
      workspaceName: z.string().trim().min(1).max(40).optional(),
    }),
    req.body,
  );
  if (!(await needsSetup())) throw forbidden('This workspace has already been set up.');
  if (!checkSetupToken(body.setupCode)) {
    throw forbidden('Incorrect setup code. Look at the LOCAL HUB server window on the host computer.');
  }
  checkPassword(body.password);
  const user = await prisma.user.create({
    data: {
      username: body.username,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      role: 'OWNER',
    },
  });
  if (body.workspaceName) {
    const { updateSettings } = await import('../services/settings.js');
    await updateSettings({ workspaceName: body.workspaceName });
  }
  clearSetupToken();
  await addUserToTeam(user.id);
  req.user = user;
  await audit(req, 'WORKSPACE_SETUP', user.username);
  await activity(user.id, 'WORKSPACE_CREATED', `${user.displayName} created the workspace`);
  const s = await startSession(req, res, user.id);
  res.status(201).json({ user: userDto(user), ...s });
});

// ---- Login / logout ----
authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(
    z.object({ username: z.string().trim().toLowerCase().min(1).max(40), password: passwordSchema }),
    req.body,
  );
  const user = await prisma.user.findUnique({ where: { username: body.username } });
  if (!user) {
    await dummyVerify(body.password);
    throw unauthorized('Incorrect username or password.');
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw unauthorized('Incorrect username or password.');
  }
  if (!user.isActive) throw forbidden('This account has been deactivated. Contact the workspace owner.');
  const s = await startSession(req, res, user.id);
  res.json({ user: userDto(user), ...s });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await prisma.session.delete({ where: { id: req.session!.id } }).catch(() => {});
  clearSessionCookie(res);
  await disconnectSession(req.session!.id, 'logout');
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  const { count } = await prisma.session.deleteMany({ where: { userId: req.user!.id } });
  clearSessionCookie(res);
  await audit(req, 'LOGOUT_ALL_DEVICES', req.user!.username, { sessions: count });
  await disconnectUser(req.user!.id, 'logout_all');
  res.json({ ok: true, revoked: count });
});

// ---- Invitation-based registration ----
authRouter.get('/invite/:code', sensitiveLimiter, async (req, res) => {
  const code = param(req, 'code').toUpperCase();
  const inv = await prisma.invitation.findUnique({ where: { code } });
  const valid = !!inv && !inv.usedAt && !inv.revokedAt && inv.expiresAt > new Date();
  const settings = await getSettings();
  res.json({ valid, role: valid ? inv!.role : null, workspaceName: settings.workspaceName });
});

authRouter.post('/register', sensitiveLimiter, async (req, res) => {
  const body = parse(
    z.object({
      inviteCode: z.string().trim().toUpperCase().min(4).max(40),
      username: usernameSchema,
      displayName: displayNameSchema,
      password: passwordSchema,
    }),
    req.body,
  );
  checkPassword(body.password);
  const inv = await prisma.invitation.findUnique({ where: { code: body.inviteCode } });
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt < new Date()) {
    throw forbidden('This invitation code is invalid, expired or already used.');
  }
  const settings = await getSettings();
  const activeUsers = await prisma.user.count({ where: { isActive: true } });
  if (activeUsers >= settings.maxUsers) {
    throw forbidden(`The workspace is full (${settings.maxUsers} members). Ask the owner to raise the limit.`);
  }
  if (await prisma.user.findUnique({ where: { username: body.username } })) {
    throw conflict('That username is already taken.');
  }
  const passwordHash = await hashPassword(body.password);
  const user = await prisma.$transaction(async (tx) => {
    // Atomically consume the invitation so it can never be used twice.
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw forbidden('This invitation has already been used.');
    const u = await tx.user.create({
      data: {
        username: body.username,
        displayName: body.displayName,
        passwordHash,
        role: inv.role === 'ADMIN' ? 'ADMIN' : 'PARTNER',
      },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { usedById: u.id } });
    return u;
  });
  const team = await addUserToTeam(user.id);
  req.user = user;
  await audit(req, 'USER_REGISTERED', user.username, { invitation: inv.id });
  await activity(user.id, 'MEMBER_JOINED', `${user.displayName} joined the workspace`, 'user', user.id);
  emitToAll('user:upsert', userDto(user));
  await createSystemMessage(team.id, `${user.displayName} joined the team`);
  await broadcastConversation(team.id);
  const s = await startSession(req, res, user.id);
  res.status(201).json({ user: userDto(user), ...s });
});

// ---- Current user / sessions ----
authRouter.get('/me', requireAuth, async (req, res) => {
  const settings = await getSettings();
  res.json({
    user: userDto(req.user!),
    sessionId: req.session!.id,
    isAdmin: isAdmin(req.user),
    workspaceName: settings.workspaceName,
  });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user!.id },
    orderBy: { lastActiveAt: 'desc' },
  });
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      current: s.id === req.session!.id,
    })),
  });
});

authRouter.delete('/sessions/:id', requireAuth, async (req, res) => {
  const id = param(req, 'id');
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s || s.userId !== req.user!.id) throw notFound('Session not found.');
  await prisma.session.delete({ where: { id } });
  await disconnectSession(id);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, sensitiveLimiter, async (req, res) => {
  const body = parse(
    z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }),
    req.body,
  );
  if (!(await verifyPassword(body.currentPassword, req.user!.passwordHash))) {
    throw badRequest('Your current password is incorrect.');
  }
  checkPassword(body.newPassword);
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
  // Sign out every other device.
  const others = await prisma.session.findMany({
    where: { userId: req.user!.id, NOT: { id: req.session!.id } },
  });
  await prisma.session.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
  for (const o of others) await disconnectSession(o.id, 'password_changed');
  await audit(req, 'PASSWORD_CHANGED', req.user!.username);
  res.json({ ok: true, revokedSessions: others.length });
});

