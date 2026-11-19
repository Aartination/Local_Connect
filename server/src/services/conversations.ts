import type { Conversation, ConversationMember, User } from '@prisma/client';
import { prisma } from '../db.js';
import { forbidden, notFound } from '../utils/http.js';
import { getActiveCallForConversation } from '../socket/callState.js';
import { messageDto, messageInclude, type FullMessage } from './serializers.js';
import { emitToConversation, emitToUser } from './realtime.js';

export const directKey = (a: string, b: string) => [a, b].sort().join(':');

export async function getTeamConversation() {
  return prisma.conversation.findFirst({ where: { type: 'TEAM' } });
}

/** Creates the workspace-wide team chat if needed and adds the user to it. */
export async function addUserToTeam(userId: string) {
  let team = await getTeamConversation();
  if (!team) {
    team = await prisma.conversation.create({
      data: {
        type: 'TEAM',
        name: 'Team',
        description: 'Everyone in the workspace',
        createdById: userId,
      },
    });
  }
  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: team.id, userId } },
    create: { conversationId: team.id, userId, role: 'MEMBER' },
    update: {},
  });
  return team;
}

export async function requireMembership(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: true },
  });
  if (!member) throw notFound('Conversation not found.');
  return member;
}

export function canManageConversation(
  conv: Conversation,
  member: ConversationMember | null,
  user: User,
): boolean {
  if (user.role === 'OWNER' || user.role === 'ADMIN') return true;
  if (conv.type !== 'GROUP') return false;
  return member?.role === 'ADMIN';
}

export function assertCanPost(conv: Conversation, member: ConversationMember, user: User) {
  if (conv.onlyAdminsCanPost && !canManageConversation(conv, member, user)) {
    throw forbidden('Only group admins can post in this conversation.');
  }
}

export async function unreadCount(conversationId: string, userId: string, since: Date) {
  return prisma.message.count({
    where: {
      conversationId,
      createdAt: { gt: since },
      deletedAt: null,
      NOT: { senderId: userId },
    },
  });
}

type ConvWithMembers = Conversation & { members: ConversationMember[] };

export async function conversationDto(conv: ConvWithMembers, meId: string) {
  const me = conv.members.find((m) => m.userId === meId);
  const last = (await prisma.message.findFirst({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'desc' },
    include: messageInclude,
  })) as FullMessage | null;
  return {
    id: conv.id,
    type: conv.type,
    name: conv.name,
    description: conv.description,
    onlyAdminsCanPost: conv.onlyAdminsCanPost,
    membersCanInvite: conv.membersCanInvite,
    createdById: conv.createdById,
    createdAt: conv.createdAt,
    lastMessageAt: conv.lastMessageAt,
    members: conv.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      lastReadAt: m.lastReadAt,
      lastDeliveredAt: m.lastDeliveredAt,
    })),
    muted: me?.muted ?? false,
    myRole: me?.role ?? 'MEMBER',
    lastMessage: last ? messageDto(last) : null,
    unreadCount: me ? await unreadCount(conv.id, meId, me.lastReadAt) : 0,
    activeCall: getActiveCallForConversation(conv.id),
  };
}
export type ConversationDTO = Awaited<ReturnType<typeof conversationDto>>;

export async function loadConversation(id: string) {
  const conv = await prisma.conversation.findUnique({ where: { id }, include: { members: true } });
  if (!conv) throw notFound('Conversation not found.');
  return conv;
}

/** Sends the fresh conversation state to every member (each gets their own view). */
export async function broadcastConversation(id: string, extraUserIds: string[] = []) {
  const conv = await prisma.conversation.findUnique({ where: { id }, include: { members: true } });
  if (!conv) return;
  const ids = new Set([...conv.members.map((m) => m.userId)]);
  for (const uid of ids) emitToUser(uid, 'conversation:upsert', await conversationDto(conv, uid));
  for (const uid of extraUserIds) if (!ids.has(uid)) emitToUser(uid, 'conversation:removed', { id });
}

export async function createSystemMessage(conversationId: string, content: string, meta: object = {}) {
  const msg = await prisma.message.create({
    data: { conversationId, type: 'SYSTEM', content, meta: JSON.stringify(meta) },
    include: messageInclude,
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: msg.createdAt } });
  await emitToConversation(conversationId, 'message:new', messageDto(msg as FullMessage));
  return msg;
}
