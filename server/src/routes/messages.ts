import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAdmin, requireAuth } from '../middleware/auth.js';
import {
  assertCanPost,
  canManageConversation,
  createSystemMessage,
  requireMembership,
} from '../services/conversations.js';
import { createMessage, loadMessage } from '../services/messages.js';
import { emitToConversation } from '../services/realtime.js';
import { messageDto, messageInclude, type FullMessage } from '../services/serializers.js';
import { badRequest, forbidden, notFound, param, parse } from '../utils/http.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

async function loadAccessible(req: any) {
  const msg = await loadMessage(param(req, 'id'));
  if (!msg) throw notFound('Message not found.');
  const member = await requireMembership(msg.conversationId, req.user.id);
  return { msg, member };
}

messagesRouter.get('/search', async (req, res) => {
  const q = parse(
    z.object({
      q: z.string().trim().min(1).max(100),
      conversationId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }),
    req.query,
  );
  const rows = await prisma.message.findMany({
    where: {
      deletedAt: null,
      type: { in: ['TEXT', 'FILE', 'VOICE'] },
      conversation: { members: { some: { userId: req.user!.id } } },
      ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      OR: [
        { content: { contains: q.q } },
        { attachments: { some: { file: { originalName: { contains: q.q } } } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    include: messageInclude,
  });
  res.json({ messages: (rows as FullMessage[]).map(messageDto) });
});

messagesRouter.patch('/:id', async (req, res) => {
  const { msg } = await loadAccessible(req);
  if (msg.senderId !== req.user!.id) throw forbidden('You can only edit your own messages.');
  if (msg.deletedAt) throw badRequest('This message was deleted.');
  if (!['TEXT', 'FILE'].includes(msg.type)) throw badRequest('This message cannot be edited.');
  const { content } = parse(z.object({ content: z.string().trim().max(8000) }), req.body);
  if (!content && msg.attachments.length === 0) throw badRequest('Message cannot be empty.');
  const updated = (await prisma.message.update({
    where: { id: msg.id },
    data: { content, editedAt: new Date() },
    include: messageInclude,
  })) as FullMessage;
  const dto = messageDto(updated);
  await emitToConversation(msg.conversationId, 'message:updated', dto);
  res.json({ message: dto });
});

messagesRouter.delete('/:id', async (req, res) => {
  const { msg, member } = await loadAccessible(req);
  const own = msg.senderId === req.user!.id;
  if (!own && !canManageConversation(member.conversation, member, req.user!)) {
    throw forbidden('You can only delete your own messages.');
  }
  if (msg.type === 'SYSTEM' && !isAdmin(req.user)) throw forbidden('System messages cannot be deleted.');
  const updated = (await prisma.message.update({
    where: { id: msg.id },
    data: { deletedAt: new Date(), content: '', pinnedAt: null, pinnedById: null },
    include: messageInclude,
  })) as FullMessage;
  await prisma.reaction.deleteMany({ where: { messageId: msg.id } });
  const dto = messageDto(updated);
  await emitToConversation(msg.conversationId, 'message:updated', dto);
  res.json({ message: dto });
});

messagesRouter.post('/:id/reactions', async (req, res) => {
  const { msg } = await loadAccessible(req);
  if (msg.deletedAt) throw badRequest('This message was deleted.');
  const { emoji } = parse(
    z.object({ emoji: z.string().min(1).max(16).refine((e) => !/[<>\s]/.test(e), 'invalid emoji') }),
    req.body,
  );
  const key = { messageId_userId_emoji: { messageId: msg.id, userId: req.user!.id, emoji } };
  const existing = await prisma.reaction.findUnique({ where: key });
  if (existing) await prisma.reaction.delete({ where: { id: existing.id } });
  else await prisma.reaction.create({ data: { messageId: msg.id, userId: req.user!.id, emoji } });
  const dto = messageDto((await loadMessage(msg.id))!);
  await emitToConversation(msg.conversationId, 'message:updated', dto);
  res.json({ message: dto });
});

messagesRouter.post('/:id/pin', async (req, res) => {
  const { msg, member } = await loadAccessible(req);
  if (msg.deletedAt) throw badRequest('This message was deleted.');
  if (member.conversation.onlyAdminsCanPost && !canManageConversation(member.conversation, member, req.user!)) {
    throw forbidden('Only group admins can pin messages here.');
  }
  const { pinned } = parse(z.object({ pinned: z.boolean() }), req.body);
  const updated = (await prisma.message.update({
    where: { id: msg.id },
    data: pinned ? { pinnedAt: new Date(), pinnedById: req.user!.id } : { pinnedAt: null, pinnedById: null },
    include: messageInclude,
  })) as FullMessage;
  const dto = messageDto(updated);
  await emitToConversation(msg.conversationId, 'message:updated', dto);
  if (pinned) {
    await createSystemMessage(msg.conversationId, `${req.user!.displayName} pinned a message`, { pinnedMessageId: msg.id });
  }
  res.json({ message: dto });
});

messagesRouter.post('/:id/forward', async (req, res) => {
  const { msg } = await loadAccessible(req);
  if (msg.deletedAt) throw badRequest('This message was deleted.');
  if (!['TEXT', 'FILE', 'VOICE'].includes(msg.type)) throw badRequest('This message cannot be forwarded.');
  const { conversationIds } = parse(
    z.object({ conversationIds: z.array(z.string().min(1).max(64)).min(1).max(20) }),
    req.body,
  );
  const results = [];
  for (const cid of [...new Set(conversationIds)]) {
    const target = await requireMembership(cid, req.user!.id);
    assertCanPost(target.conversation, target, req.user!);
    results.push(
      await createMessage({
        conversationId: cid,
        sender: req.user!,
        type: msg.type as 'TEXT' | 'FILE' | 'VOICE',
        content: msg.content,
        fileIds: msg.attachments.map((a) => a.file.id),
        forwarded: true,
      }),
    );
  }
  res.json({ messages: results });
});

