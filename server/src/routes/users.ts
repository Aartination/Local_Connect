import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { emitToAll } from '../services/realtime.js';
import { userDto } from '../services/serializers.js';
import { getSharp, processAvatar, storagePath } from '../services/storage.js';
import { fileTypeFromBuffer } from 'file-type';
import { USERNAME_RE } from '../services/auth.js';
import { badRequest, conflict, notFound, param, parse } from '../utils/http.js';
import crypto from 'node:crypto';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { displayName: 'asc' }] });
  res.json({ users: users.map(userDto) });
});

usersRouter.patch('/me', async (req, res) => {
  const body = parse(
    z.object({
      displayName: z.string().trim().min(1).max(40).optional(),
      bio: z.string().trim().max(300).optional(),
      statusText: z.string().trim().max(80).optional(),
      username: z.string().trim().toLowerCase().regex(USERNAME_RE).optional(),
    }),
    req.body,
  );
  if (body.username && body.username !== req.user!.username) {
    const taken = await prisma.user.findUnique({ where: { username: body.username } });
    if (taken) throw conflict('That username is already taken.');
  }
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
  emitToAll('user:upsert', userDto(user));
  res.json({ user: userDto(user) });
});

const AVATAR_TYPES = new Set(['jpg', 'png', 'webp', 'gif', 'avif', 'bmp']);

usersRouter.post(
  '/me/avatar',
  express.raw({ type: () => true, limit: '8mb' }),
  async (req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('No image received.');
    const type = await fileTypeFromBuffer(buf);
    if (!type || !AVATAR_TYPES.has(type.ext)) throw badRequest('Please upload a JPG, PNG, WEBP or GIF image.');
    const sharp = await getSharp();
    const avatarId = crypto.randomUUID();
    const ext = sharp ? 'webp' : type.ext;
    const out = storagePath(path.join('users', `${req.user!.id}-${avatarId}.${ext}`));
    try {
      await processAvatar(buf, out);
    } catch {
      throw badRequest('That image could not be processed.');
    }
    const old = req.user!.avatarFileId;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarFileId: `${avatarId}.${ext}` },
    });
    if (old) fs.promises.unlink(storagePath(path.join('users', `${req.user!.id}-${old}`))).catch(() => {});
    emitToAll('user:upsert', userDto(user));
    res.json({ user: userDto(user) });
  },
);

usersRouter.delete('/me/avatar', async (req, res) => {
  const old = req.user!.avatarFileId;
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: { avatarFileId: null } });
  if (old) fs.promises.unlink(storagePath(path.join('users', `${req.user!.id}-${old}`))).catch(() => {});
  emitToAll('user:upsert', userDto(user));
  res.json({ user: userDto(user) });
});

usersRouter.get('/:id/avatar', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!user?.avatarFileId || !/^[a-f0-9-]+\.[a-z]+$/.test(user.avatarFileId)) throw notFound();
  const file = storagePath(path.join('users', `${user.id}-${user.avatarFileId}`));
  if (!fs.existsSync(file)) throw notFound();
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.sendFile(file);
});

usersRouter.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!user) throw notFound('User not found.');
  res.json({ user: userDto(user) });
});

