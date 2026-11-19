import type { File as DbFile, User } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, forbidden } from '../utils/http.js';
import { emitToConversation } from './realtime.js';
import { messageDto, messageInclude, type FullMessage } from './serializers.js';

/** True when `user` may read the given file. */
export async function canAccessFile(user: User, file: DbFile): Promise<boolean> {
  if (file.deletedAt) return false;
  if (file.scope === 'WORKSPACE' || file.scope === 'AVATAR') return true;
  if (file.uploaderId === user.id) return true;
  const link = await prisma.messageAttachment.findFirst({
    where: {
      fileId: file.id,
      message: {
        deletedAt: null,
        conversation: { members: { some: { userId: user.id } } },
      },
    },
    select: { id: true },
  });
  return !!link;
}

export interface NewMessageInput {
  conversationId: string;
  sender: User;
  type?: 'TEXT' | 'FILE' | 'VOICE' | 'CALL' | 'SYSTEM';
  content?: string;
  replyToId?: string | null;
  fileIds?: string[];
  forwarded?: boolean;
  meta?: Record<string, unknown>;
}

export async function createMessage(input: NewMessageInput) {
  const content = (input.content ?? '').trim();
  const fileIds = [...new Set(input.fileIds ?? [])].slice(0, 20);
  if (!content && fileIds.length === 0 && input.type !== 'CALL') {
    throw badRequest('A message needs text or at least one attachment.');
  }
  if (content.length > 8000) throw badRequest('Message is too long (max 8000 characters).');

  const files: DbFile[] = [];
  for (const id of fileIds) {
    const f = await prisma.file.findUnique({ where: { id } });
    if (!f || !(await canAccessFile(input.sender, f))) throw forbidden('One of the attachments is not available.');
    files.push(f);
  }

  if (input.replyToId) {
    const target = await prisma.message.findUnique({ where: { id: input.replyToId } });
    if (!target || target.conversationId !== input.conversationId) throw badRequest('Invalid reply target.');
  }

  let type = input.type ?? 'TEXT';
  if (type === 'TEXT' && files.length > 0) type = 'FILE';

  const msg = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.sender.id,
      type,
      content,
      replyToId: input.replyToId || null,
      forwarded: !!input.forwarded,
      meta: JSON.stringify(input.meta ?? {}),
      attachments: { create: files.map((f, i) => ({ fileId: f.id, position: i })) },
    },
    include: messageInclude,
  });
  const now = msg.createdAt;
  await prisma.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: now } });
  await prisma.conversationMember.updateMany({
    where: { conversationId: input.conversationId, userId: input.sender.id },
    data: { lastReadAt: now, lastDeliveredAt: now },
  });
  const dto = messageDto(msg as FullMessage);
  await emitToConversation(input.conversationId, 'message:new', dto);
  return dto;
}

export async function loadMessage(id: string) {
  return (await prisma.message.findUnique({ where: { id }, include: messageInclude })) as FullMessage | null;
}

