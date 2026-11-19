import type { File as DbFile, Message, Reaction, User } from '@prisma/client';
import { safeJson } from '../utils/http.js';
import { presence } from './presence.js';

export type UserDTO = ReturnType<typeof userDto>;

export function userDto(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    bio: u.bio,
    statusText: u.statusText,
    avatarUrl: u.avatarFileId ? `/api/users/${u.id}/avatar?v=${u.avatarFileId}` : null,
    isActive: u.isActive,
    lastSeenAt: u.lastSeenAt,
    online: u.isActive && presence.isOnline(u.id),
    createdAt: u.createdAt,
  };
}

export function fileDto(f: DbFile) {
  const deleted = !!f.deletedAt;
  return {
    id: f.id,
    name: f.originalName,
    ext: f.ext,
    mime: f.mime,
    size: f.size,
    category: f.category,
    scope: f.scope,
    folder: f.folder,
    description: f.description,
    width: f.width,
    height: f.height,
    duration: f.duration,
    waveform: safeJson<number[] | null>(f.waveform, null),
    pinned: f.pinned,
    uploaderId: f.uploaderId,
    createdAt: f.createdAt,
    deleted,
    url: deleted ? null : `/api/files/${f.id}/content`,
    downloadUrl: deleted ? null : `/api/files/${f.id}/content?download=1`,
    thumbUrl: !deleted && f.thumbPath ? `/api/files/${f.id}/thumbnail` : null,
  };
}
export type FileDTO = ReturnType<typeof fileDto>;

export type FullMessage = Message & {
  reactions: Reaction[];
  attachments: { position: number; file: DbFile }[];
  replyTo:
    | (Message & { attachments: { file: DbFile }[] })
    | null;
};

export const messageInclude = {
  reactions: true,
  attachments: { include: { file: true }, orderBy: { position: 'asc' as const } },
  replyTo: { include: { attachments: { include: { file: true }, take: 1 } } },
};

function groupReactions(reactions: Reaction[]) {
  const map = new Map<string, string[]>();
  for (const r of reactions.sort((a, b) => +a.createdAt - +b.createdAt)) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji)!.push(r.userId);
  }
  return [...map.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

export function messageDto(m: FullMessage) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    content: deleted ? '' : m.content,
    meta: safeJson<Record<string, unknown>>(m.meta, {}),
    forwarded: m.forwarded,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    pinnedAt: deleted ? null : m.pinnedAt,
    pinnedById: m.pinnedById,
    createdAt: m.createdAt,
    reactions: deleted ? [] : groupReactions(m.reactions),
    attachments: deleted ? [] : m.attachments.map((a) => fileDto(a.file)),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderId: m.replyTo.senderId,
          type: m.replyTo.type,
          content: m.replyTo.deletedAt ? '' : m.replyTo.content.slice(0, 200),
          deleted: !!m.replyTo.deletedAt,
          attachment:
            !m.replyTo.deletedAt && m.replyTo.attachments[0]
              ? fileDto(m.replyTo.attachments[0].file)
              : null,
        }
      : null,
  };
}
export type MessageDTO = ReturnType<typeof messageDto>;

