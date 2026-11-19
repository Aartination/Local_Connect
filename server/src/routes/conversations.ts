import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAdmin, requireAuth } from '../middleware/auth.js';
import { activity, audit } from '../services/audit.js';
import {
  assertCanPost,
  broadcastConversation,
  canManageConversation,
  conversationDto,
  createSystemMessage,
  directKey,
  loadConversation,
  requireMembership,
} from '../services/conversations.js';
import { createMessage } from '../services/messages.js';
import { emitToConversation } from '../services/realtime.js';
import { fileDto, messageDto, messageInclude, type FullMessage } from '../services/serializers.js';
import { badRequest, forbidden, notFound, param, parse } from '../utils/http.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

const id = z.string().min(1).max(64);

conversationsRouter.get('/', async (req, res) => {
  const convs = await prisma.conversation.findMany({
    where: { members: { some: { userId: req.user!.id } } },
    include: { members: true },
    orderBy: { lastMessageAt: 'desc' },
  });
  const list = [];
  for (const c of convs) list.push(await conversationDto(c, req.user!.id));
  res.json({ conversations: list });
});

conversationsRouter.post('/direct', async (req, res) => {
  const { userId } = parse(z.object({ userId: id }), req.body);
  if (userId === req.user!.id) throw badRequest('You cannot start a conversation with yourself.');
  const other = await prisma.user.findUnique({ where: { id: userId } });
  if (!other || !other.isActive) throw notFound('User not found.');
  const key = directKey(req.user!.id, userId);
  let conv = await prisma.conversation.findUnique({ where: { directKey: key }, include: { members: true } });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        type: 'DIRECT',
        directKey: key,
        createdById: req.user!.id,
        members: { create: [{ userId: req.user!.id }, { userId }] },
      },
      include: { members: true },
    });
    await broadcastConversation(conv.id);
  }
  res.json({ conversation: await conversationDto(conv, req.user!.id) });
});

conversationsRouter.post('/group', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(60),
      description: z.string().trim().max(300).optional(),
      memberIds: z.array(id).max(50).default([]),
    }),
    req.body,
  );
  const ids = [...new Set([req.user!.id, ...body.memberIds])];
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true } });
  if (users.length !== ids.length) throw badRequest('Some selected members do not exist.');
  const conv = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      name: body.name,
      description: body.description ?? '',
      createdById: req.user!.id,
      members: {
        create: ids.map((uid) => ({ userId: uid, role: uid === req.user!.id ? 'ADMIN' : 'MEMBER' })),
      },
    },
    include: { members: true },
  });
  await createSystemMessage(conv.id, `${req.user!.displayName} created the group "${conv.name}"`);
  await activity(req.user!.id, 'GROUP_CREATED', `${req.user!.displayName} created the group ${conv.name}`, 'conversation', conv.id);
  await broadcastConversation(conv.id);
  res.status(201).json({ conversation: await conversationDto(conv, req.user!.id) });
});

conversationsRouter.get('/:id', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  res.json({ conversation: await conversationDto(await loadConversation(cid), req.user!.id) });
});

conversationsRouter.patch('/:id', async (req, res) => {
  const cid = param(req, 'id');
  const member = await requireMembership(cid, req.user!.id);
  const conv = member.conversation;
  if (conv.type === 'DIRECT') throw badRequest('Direct conversations cannot be renamed.');
  if (!canManageConversation(conv, member, req.user!)) throw forbidden('Only group admins can change settings.');
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      description: z.string().trim().max(300).optional(),
      onlyAdminsCanPost: z.boolean().optional(),
      membersCanInvite: z.boolean().optional(),
    }),
    req.body,
  );
  await prisma.conversation.update({ where: { id: cid }, data: body });
  if (body.name && body.name !== conv.name) {
    await createSystemMessage(cid, `${req.user!.displayName} renamed the group to "${body.name}"`);
  }
  await broadcastConversation(cid);
  res.json({ conversation: await conversationDto(await loadConversation(cid), req.user!.id) });
});

conversationsRouter.delete('/:id', async (req, res) => {
  const cid = param(req, 'id');
  const member = await requireMembership(cid, req.user!.id);
  const conv = member.conversation;
  if (conv.type !== 'GROUP') throw badRequest('Only groups can be deleted.');
  if (!canManageConversation(conv, member, req.user!)) throw forbidden('Only group admins can delete the group.');
  const memberIds = (await prisma.conversationMember.findMany({ where: { conversationId: cid } })).map((m) => m.userId);
  await prisma.conversation.delete({ where: { id: cid } });
  await audit(req, 'GROUP_DELETED', conv.name);
  const { emitToUsers } = await import('../services/realtime.js');
  emitToUsers(memberIds, 'conversation:removed', { id: cid });
  res.json({ ok: true });
});

// ---- Members ----
conversationsRouter.post('/:id/members', async (req, res) => {
  const cid = param(req, 'id');
  const member = await requireMembership(cid, req.user!.id);
  const conv = member.conversation;
  if (conv.type !== 'GROUP') throw badRequest('Members can only be added to groups.');
  if (!conv.membersCanInvite && !canManageConversation(conv, member, req.user!)) {
    throw forbidden('Only group admins can add members.');
  }
  const { userIds } = parse(z.object({ userIds: z.array(id).min(1).max(50) }), req.body);
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true } });
  const added = [];
  for (const u of users) {
    const exists = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: cid, userId: u.id } },
    });
    if (exists) continue;
    await prisma.conversationMember.create({ data: { conversationId: cid, userId: u.id } });
    added.push(u.displayName);
  }
  if (added.length) await createSystemMessage(cid, `${req.user!.displayName} added ${added.join(', ')}`);
  await broadcastConversation(cid);
  res.json({ ok: true, added: added.length });
});

conversationsRouter.delete('/:id/members/:userId', async (req, res) => {
  const cid = param(req, 'id');
  const targetId = param(req, 'userId');
  const member = await requireMembership(cid, req.user!.id);
  const conv = member.conversation;
  if (conv.type !== 'GROUP') throw badRequest('You cannot leave this conversation.');
  const self = targetId === req.user!.id;
  if (!self && !canManageConversation(conv, member, req.user!)) throw forbidden('Only group admins can remove members.');
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  const deleted = await prisma.conversationMember.deleteMany({ where: { conversationId: cid, userId: targetId } });
  if (!deleted.count) throw notFound('Member not found.');
  // Keep at least one admin in the group.
  const admins = await prisma.conversationMember.count({ where: { conversationId: cid, role: 'ADMIN' } });
  if (admins === 0) {
    const next = await prisma.conversationMember.findFirst({ where: { conversationId: cid }, orderBy: { joinedAt: 'asc' } });
    if (next) await prisma.conversationMember.update({ where: { id: next.id }, data: { role: 'ADMIN' } });
  }
  await createSystemMessage(
    cid,
    self ? `${req.user!.displayName} left the group` : `${req.user!.displayName} removed ${target?.displayName ?? 'a member'}`,
  );
  await broadcastConversation(cid, [targetId]);
  res.json({ ok: true });
});

conversationsRouter.patch('/:id/members/:userId', async (req, res) => {
  const cid = param(req, 'id');
  const targetId = param(req, 'userId');
  const member = await requireMembership(cid, req.user!.id);
  if (member.conversation.type !== 'GROUP') throw badRequest('Roles only exist in groups.');
  if (!canManageConversation(member.conversation, member, req.user!)) throw forbidden('Only group admins can change roles.');
  const { role } = parse(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }), req.body);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: cid, userId: targetId } },
    data: { role },
  });
  await broadcastConversation(cid);
  res.json({ ok: true });
});

conversationsRouter.post('/:id/read', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  const now = new Date();
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: cid, userId: req.user!.id } },
    data: { lastReadAt: now, lastDeliveredAt: now },
  });
  await emitToConversation(cid, 'conversation:read', { conversationId: cid, userId: req.user!.id, at: now });
  res.json({ ok: true });
});

conversationsRouter.post('/:id/mute', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  const { muted } = parse(z.object({ muted: z.boolean() }), req.body);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: cid, userId: req.user!.id } },
    data: { muted },
  });
  res.json({ ok: true, muted });
});

// ---- Messages ----
conversationsRouter.get('/:id/messages', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  const q = parse(
    z.object({
      before: id.optional(),
      around: id.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }),
    req.query,
  );
  const map = (list: unknown[]) => (list as FullMessage[]).map(messageDto);

  if (q.around) {
    const anchor = await prisma.message.findUnique({ where: { id: q.around } });
    if (!anchor || anchor.conversationId !== cid) throw notFound('Message not found.');
    const half = Math.floor(q.limit / 2);
    const older = await prisma.message.findMany({
      where: { conversationId: cid, createdAt: { lte: anchor.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: half + 1,
      include: messageInclude,
    });
    const newer = await prisma.message.findMany({
      where: { conversationId: cid, createdAt: { gt: anchor.createdAt } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: half,
      include: messageInclude,
    });
    return res.json({
      messages: [...map(older).reverse(), ...map(newer)],
      hasMore: older.length > half,
      hasNewer: newer.length === half,
    });
  }

  const rows = await prisma.message.findMany({
    where: { conversationId: cid },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
    include: messageInclude,
  });
  const hasMore = rows.length > q.limit;
  res.json({ messages: map(rows.slice(0, q.limit)).reverse(), hasMore, hasNewer: false });
});

conversationsRouter.post('/:id/messages', async (req, res) => {
  const cid = param(req, 'id');
  const member = await requireMembership(cid, req.user!.id);
  assertCanPost(member.conversation, member, req.user!);
  const body = parse(
    z.object({
      content: z.string().max(8000).default(''),
      replyToId: id.nullish(),
      fileIds: z.array(id).max(20).default([]),
      type: z.enum(['TEXT', 'VOICE']).default('TEXT'),
      clientId: z.string().max(64).optional(),
    }),
    req.body,
  );
  if (body.type === 'VOICE' && body.fileIds.length !== 1) throw badRequest('A voice message needs exactly one recording.');
  const message = await createMessage({
    conversationId: cid,
    sender: req.user!,
    type: body.type,
    content: body.content,
    replyToId: body.replyToId,
    fileIds: body.fileIds,
    meta: body.clientId ? { clientId: body.clientId } : {},
  });
  res.status(201).json({ message });
});

conversationsRouter.get('/:id/pins', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  const rows = await prisma.message.findMany({
    where: { conversationId: cid, pinnedAt: { not: null }, deletedAt: null },
    orderBy: { pinnedAt: 'desc' },
    include: messageInclude,
  });
  res.json({ messages: (rows as FullMessage[]).map(messageDto) });
});

conversationsRouter.get('/:id/files', async (req, res) => {
  const cid = param(req, 'id');
  await requireMembership(cid, req.user!.id);
  const q = parse(
    z.object({
      kind: z.enum(['media', 'files', 'audio', 'all']).default('all'),
      limit: z.coerce.number().int().min(1).max(200).default(60),
    }),
    req.query,
  );
  const category =
    q.kind === 'media'
      ? { in: ['IMAGE', 'VIDEO'] }
      : q.kind === 'files'
        ? { in: ['DOCUMENT', 'ARCHIVE', 'OTHER'] }
        : q.kind === 'audio'
          ? { in: ['AUDIO'] }
          : undefined;
  const atts = await prisma.messageAttachment.findMany({
    where: {
      message: { conversationId: cid, deletedAt: null },
      file: { deletedAt: null, ...(category ? { category } : {}) },
    },
    include: { file: true, message: { select: { id: true, senderId: true, createdAt: true } } },
    orderBy: { message: { createdAt: 'desc' } },
    take: q.limit,
  });
  res.json({
    files: atts.map((a) => ({ ...fileDto(a.file), messageId: a.message.id, sharedAt: a.message.createdAt, sharedBy: a.message.senderId })),
  });
});

export function isWorkspaceAdmin(u: Parameters<typeof isAdmin>[0]) {
  return isAdmin(u);
}

