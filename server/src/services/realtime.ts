import type { Server } from 'socket.io';
import { prisma } from '../db.js';

/** Thin wrapper around the Socket.IO server so services can broadcast events. */
let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}
export function getIo(): Server | null {
  return io;
}

export const userRoom = (userId: string) => `user:${userId}`;

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(userRoom)).emit(event, payload);
}

export function emitToAll(event: string, payload: unknown) {
  io?.to('authenticated').emit(event, payload);
}

export async function conversationMemberIds(conversationId: string): Promise<string[]> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function emitToConversation(conversationId: string, event: string, payload: unknown) {
  emitToUsers(await conversationMemberIds(conversationId), event, payload);
}

/** Forcefully disconnects every socket belonging to a user. */
export async function disconnectUser(userId: string, reason = 'session_revoked') {
  if (!io) return;
  io.to(userRoom(userId)).emit('session:revoked', { reason });
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const s of sockets) s.disconnect(true);
}

export async function disconnectSession(sessionId: string, reason = 'session_revoked') {
  if (!io) return;
  const sockets = await io.fetchSockets();
  for (const s of sockets) {
    if (s.data?.sessionId === sessionId) {
      s.emit('session:revoked', { reason });
      s.disconnect(true);
    }
  }
}

