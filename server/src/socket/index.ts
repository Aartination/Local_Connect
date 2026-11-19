import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { Server, type Socket } from 'socket.io';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { isAllowedOrigin } from '../middleware/security.js';
import { resolveSession, tokenFromHeaders } from '../services/auth.js';
import { conversationMemberIds, emitToAll, emitToConversation, emitToUser, setIo, userRoom } from '../services/realtime.js';
import { messageDto, messageInclude, type FullMessage } from '../services/serializers.js';
import { presence } from '../services/presence.js';
import { calls, callSummary, findCallOfUser, getActiveCallForConversation, type CallState } from './callState.js';

const MAX_CALL_PARTICIPANTS = 5;
const RING_TIMEOUT_MS = 45_000;

async function recordCallMessage(call: CallState, status: 'ended' | 'missed' | 'declined') {
  const durationSec = call.connectedAt ? Math.max(1, Math.round((Date.now() - call.connectedAt) / 1000)) : 0;
  const label =
    status === 'ended'
      ? `${call.video ? 'Video' : 'Voice'} call ended`
      : status === 'declined'
        ? `${call.video ? 'Video' : 'Voice'} call declined`
        : `Missed ${call.video ? 'video' : 'voice'} call`;
  try {
    const msg = await prisma.message.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.initiatorId,
        type: 'CALL',
        content: label,
        meta: JSON.stringify({
          callId: call.id,
          video: call.video,
          status,
          durationSec,
        }),
      },
      include: messageInclude,
    });
    await prisma.conversation.update({
      where: { id: call.conversationId },
      data: { lastMessageAt: msg.createdAt },
    });
    await emitToConversation(call.conversationId, 'message:new', messageDto(msg as FullMessage));
  } catch (e) {
    logger.warn('Failed to save call log message', e);
  }
}

async function finishCall(call: CallState, reason: 'ended' | 'missed' | 'declined') {
  if (!calls.has(call.id)) return;
  if (call.ringTimer) clearTimeout(call.ringTimer);
  call.ringTimer = null;
  calls.delete(call.id);
  await emitToConversation(call.conversationId, 'call:ended', {
    callId: call.id,
    conversationId: call.conversationId,
    reason,
  });
  await recordCallMessage(call, reason);
}

async function removeParticipant(call: CallState, userId: string, io: Server) {
  if (!call.participants.has(userId)) return;
  call.participants.delete(userId);
  // Notify remaining participants so they tear down their RTCPeerConnection
  for (const p of call.participants.values()) {
    io.to(p.socketId).emit('call:participant-left', { callId: call.id, userId });
  }
  if (call.participants.size === 0) {
    await finishCall(call, call.connectedAt ? 'ended' : 'missed');
    return;
  }
  // If nobody else is ringing and only 1 person remains after a call was already connected, end the call.
  const anyoneStillRinging = call.invited.size > 0;
  if (call.participants.size === 1 && (call.connectedAt || !anyoneStillRinging)) {
    await finishCall(call, call.connectedAt ? 'ended' : 'declined');
    return;
  }
  await emitToConversation(call.conversationId, 'call:state', {
    conversationId: call.conversationId,
    call: callSummary(call),
  });
}

async function isMember(conversationId: string, userId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true },
  });
  return !!m;
}

export function initSocket(servers: Array<HttpServer | HttpsServer>) {
  const io = new Server({
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1e6,
    allowRequest(req, cb) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (!isAllowedOrigin(origin, host)) return cb('Origin not allowed', false);
      cb(null, true);
    },
  });

  for (const srv of servers) io.attach(srv);
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
      const token = authToken || tokenFromHeaders(socket.handshake.headers);
      const resolved = await resolveSession(token);
      if (!resolved) return next(new Error('Unauthorized'));
      socket.data.userId = resolved.user.id;
      socket.data.username = resolved.user.username;
      socket.data.sessionId = resolved.session.id;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join('authenticated');
    socket.join(userRoom(userId));

    const becameOnline = presence.add(userId, socket.id);
    if (becameOnline) {
      emitToAll('presence:update', { userId, online: true, lastSeenAt: null });
    }

    // Send current online users snapshot to this socket
    socket.emit('presence:snapshot', { onlineUserIds: presence.onlineUserIds() });

    // Mark messages in user's conversations as delivered
    try {
      const memberships = await prisma.conversationMember.findMany({
        where: { userId },
        select: { conversationId: true },
      });
      const now = new Date();
      await prisma.conversationMember.updateMany({ where: { userId }, data: { lastDeliveredAt: now } });
      for (const m of memberships) {
        await emitToConversation(m.conversationId, 'conversation:delivered', {
          conversationId: m.conversationId,
          userId,
          at: now,
        });
      }
      // If there's an active call in any of the user's conversations, inform them
      for (const m of memberships) {
        const active = getActiveCallForConversation(m.conversationId);
        if (active) {
          socket.emit('call:state', { conversationId: m.conversationId, call: active });
        }
      }
    } catch (e) {
      logger.warn('Socket connect sync error', e);
    }

    // ---- Delivery & Read receipts ----
    socket.on('conversation:delivered', async (data: { conversationId?: string }) => {
      if (!data?.conversationId || !(await isMember(data.conversationId, userId))) return;
      const now = new Date();
      await prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: data.conversationId, userId } },
        data: { lastDeliveredAt: now },
      });
      await emitToConversation(data.conversationId, 'conversation:delivered', {
        conversationId: data.conversationId,
        userId,
        at: now,
      });
    });

    socket.on('conversation:read', async (data: { conversationId?: string }) => {
      if (!data?.conversationId || !(await isMember(data.conversationId, userId))) return;
      const now = new Date();
      await prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: data.conversationId, userId } },
        data: { lastReadAt: now, lastDeliveredAt: now },
      });
      await emitToConversation(data.conversationId, 'conversation:read', {
        conversationId: data.conversationId,
        userId,
        at: now,
      });
    });

    // ---- Typing indicators ----
    socket.on('typing:start', async (data: { conversationId?: string }) => {
      if (!data?.conversationId || !(await isMember(data.conversationId, userId))) return;
      const members = (await conversationMemberIds(data.conversationId)).filter((id) => id !== userId);
      for (const uid of members) {
        emitToUser(uid, 'typing:update', { conversationId: data.conversationId, userId, typing: true });
      }
    });

    socket.on('typing:stop', async (data: { conversationId?: string }) => {
      if (!data?.conversationId || !(await isMember(data.conversationId, userId))) return;
      const members = (await conversationMemberIds(data.conversationId)).filter((id) => id !== userId);
      for (const uid of members) {
        emitToUser(uid, 'typing:update', { conversationId: data.conversationId, userId, typing: false });
      }
    });

    // ---- WebRTC Call Signaling (1-to-1 and up to 5-member group mesh) ----
    socket.on(
      'call:start',
      async (
        data: { conversationId?: string; video?: boolean },
        ack?: (res: { ok: boolean; call?: any; error?: string }) => void,
      ) => {
        try {
          const cid = data?.conversationId;
          if (!cid || !(await isMember(cid, userId))) {
            return ack?.({ ok: false, error: 'Conversation not found.' });
          }

          const existingUserCall = findCallOfUser(userId);
          if (existingUserCall && existingUserCall.conversationId !== cid) {
            return ack?.({ ok: false, error: 'You are already in another call.' });
          }

          // If a call is already active in this conversation, join it instead.
          const active = [...calls.values()].find((c) => c.conversationId === cid);
          if (active) {
            if (active.participants.size >= MAX_CALL_PARTICIPANTS && !active.participants.has(userId)) {
              return ack?.({ ok: false, error: `Calls support up to ${MAX_CALL_PARTICIPANTS} participants.` });
            }
            const existingPeers = [...active.participants.keys()].filter((id) => id !== userId);
            active.participants.set(userId, {
              userId,
              socketId: socket.id,
              audio: true,
              video: !!data.video,
              joinedAt: Date.now(),
            });
            active.invited.delete(userId);
            if (!active.connectedAt && active.participants.size >= 2) {
              active.connectedAt = Date.now();
              if (active.ringTimer) clearTimeout(active.ringTimer);
              active.ringTimer = null;
            }
            for (const p of active.participants.values()) {
              if (p.userId !== userId) {
                io.to(p.socketId).emit('call:participant-joined', { callId: active.id, userId });
              }
            }
            await emitToConversation(cid, 'call:state', { conversationId: cid, call: callSummary(active) });
            return ack?.({ ok: true, call: { ...callSummary(active), peersToOffer: existingPeers } });
          }

          const members = await conversationMemberIds(cid);
          const others = members.filter((m) => m !== userId);
          if (others.length === 0) return ack?.({ ok: false, error: 'No other members in this conversation.' });

          const callId = crypto.randomUUID();
          const call: CallState = {
            id: callId,
            conversationId: cid,
            video: !!data.video,
            initiatorId: userId,
            startedAt: Date.now(),
            connectedAt: null,
            participants: new Map([
              [
                userId,
                {
                  userId,
                  socketId: socket.id,
                  audio: true,
                  video: !!data.video,
                  joinedAt: Date.now(),
                },
              ],
            ]),
            invited: new Set(others),
            declined: new Set(),
            ringTimer: null,
          };
          call.ringTimer = setTimeout(() => {
            if (calls.has(callId) && !call.connectedAt) {
              finishCall(call, 'missed').catch(() => {});
            }
          }, RING_TIMEOUT_MS);

          calls.set(callId, call);
          const summary = callSummary(call);
          await emitToConversation(cid, 'call:state', { conversationId: cid, call: summary });
          for (const uid of others) {
            emitToUser(uid, 'call:incoming', { call: summary });
          }
          ack?.({ ok: true, call: { ...summary, peersToOffer: [] } });
        } catch (e: any) {
          logger.error('call:start error', e);
          ack?.({ ok: false, error: 'Could not start call.' });
        }
      },
    );

    socket.on(
      'call:join',
      async (
        data: { callId?: string; audio?: boolean; video?: boolean },
        ack?: (res: { ok: boolean; call?: any; error?: string }) => void,
      ) => {
        try {
          const call = data?.callId ? calls.get(data.callId) : undefined;
          if (!call) return ack?.({ ok: false, error: 'This call has already ended.' });
          if (!(await isMember(call.conversationId, userId))) {
            return ack?.({ ok: false, error: 'Not a member of this conversation.' });
          }
          if (call.participants.size >= MAX_CALL_PARTICIPANTS && !call.participants.has(userId)) {
            return ack?.({ ok: false, error: `Calls support up to ${MAX_CALL_PARTICIPANTS} participants.` });
          }
          const existingUserCall = findCallOfUser(userId);
          if (existingUserCall && existingUserCall.id !== call.id) {
            return ack?.({ ok: false, error: 'Leave your current call first.' });
          }

          const existingPeers = [...call.participants.keys()].filter((id) => id !== userId);
          call.participants.set(userId, {
            userId,
            socketId: socket.id,
            audio: data.audio !== false,
            video: !!data.video,
            joinedAt: Date.now(),
          });
          call.invited.delete(userId);
          call.declined.delete(userId);

          if (!call.connectedAt && call.participants.size >= 2) {
            call.connectedAt = Date.now();
            if (call.ringTimer) clearTimeout(call.ringTimer);
            call.ringTimer = null;
          }

          for (const p of call.participants.values()) {
            if (p.userId !== userId) {
              io.to(p.socketId).emit('call:participant-joined', { callId: call.id, userId });
            }
          }
          const summary = callSummary(call);
          await emitToConversation(call.conversationId, 'call:state', {
            conversationId: call.conversationId,
            call: summary,
          });
          ack?.({ ok: true, call: { ...summary, peersToOffer: existingPeers } });
        } catch (e) {
          logger.error('call:join error', e);
          ack?.({ ok: false, error: 'Could not join call.' });
        }
      },
    );

    socket.on('call:decline', async (data: { callId?: string }) => {
      const call = data?.callId ? calls.get(data.callId) : undefined;
      if (!call) return;
      call.invited.delete(userId);
      call.declined.add(userId);
      // Dismiss ringing on this user's other tabs too
      emitToUser(userId, 'call:dismissed', { callId: call.id });
      if (!call.connectedAt && call.invited.size === 0 && call.participants.size <= 1) {
        await finishCall(call, 'declined');
      } else {
        await emitToConversation(call.conversationId, 'call:state', {
          conversationId: call.conversationId,
          call: callSummary(call),
        });
      }
    });

    socket.on('call:leave', async (data: { callId?: string }) => {
      const call = data?.callId ? calls.get(data.callId) : findCallOfUser(userId);
      if (!call) return;
      await removeParticipant(call, userId, io);
    });

    socket.on('call:media', async (data: { callId?: string; audio?: boolean; video?: boolean }) => {
      const call = data?.callId ? calls.get(data.callId) : findCallOfUser(userId);
      if (!call) return;
      const p = call.participants.get(userId);
      if (!p) return;
      if (typeof data.audio === 'boolean') p.audio = data.audio;
      if (typeof data.video === 'boolean') p.video = data.video;
      await emitToConversation(call.conversationId, 'call:state', {
        conversationId: call.conversationId,
        call: callSummary(call),
      });
    });

    socket.on('call:signal', (data: { callId?: string; toUserId?: string; payload?: unknown }) => {
      if (!data?.callId || !data?.toUserId) return;
      const call = calls.get(data.callId);
      if (!call || !call.participants.has(userId)) return;
      const target = call.participants.get(data.toUserId);
      if (!target) return;
      io.to(target.socketId).emit('call:signal', {
        callId: call.id,
        fromUserId: userId,
        payload: data.payload,
      });
    });

    // ---- Disconnect ----
    socket.on('disconnect', async () => {
      // Remove from any call held by this socket
      for (const call of [...calls.values()]) {
        const p = call.participants.get(userId);
        if (p && p.socketId === socket.id) {
          await removeParticipant(call, userId, io);
        }
      }

      const wentOffline = presence.remove(userId, socket.id);
      if (wentOffline) {
        const now = new Date();
        await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } }).catch(() => {});
        emitToAll('presence:update', { userId, online: false, lastSeenAt: now.toISOString() });
      }
    });
  });

  return io;
}

