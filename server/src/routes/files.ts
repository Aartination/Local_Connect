import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAdmin, requireAuth } from '../middleware/auth.js';
import { activity, audit } from '../services/audit.js';
import { canAccessFile } from '../services/messages.js';
import { emitToAll } from '../services/realtime.js';
import { fileDto } from '../services/serializers.js';
import { getSettings } from '../services/settings.js';
import {
  getSharp,
  makeImageThumbnail,
  moveFile,
  newStoredName,
  relPathFor,
  sanitizeFileName,
  sha256File,
  storagePath,
  tmpPath,
  verifyFileType,
} from '../services/storage.js';
import { badRequest, forbidden, notFound, param, parse, safeJson } from '../utils/http.js';

export const filesRouter = Router();
filesRouter.use(requireAuth);

const INLINE_SAFE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/webm',
  'application/pdf',
  'text/plain; charset=utf-8',
  'text/markdown; charset=utf-8',
  'text/csv; charset=utf-8',
  'application/json; charset=utf-8',
]);

async function finalizeUploadedFile(opts: {
  tempFile: string;
  originalName: string;
  userId: string;
  scope: 'CHAT' | 'WORKSPACE';
  folder?: string;
  description?: string;
  audioHint?: boolean;
  duration?: number | null;
  waveform?: number[] | null;
}) {
  const settings = await getSettings();
  const maxBytes = settings.maxFileSizeMB * 1024 * 1024;
  const stat = await fsp.stat(opts.tempFile);
  if (stat.size === 0) throw badRequest('Uploaded file is empty.');
  if (stat.size > maxBytes) {
    throw badRequest(`File exceeds the maximum allowed size (${settings.maxFileSizeMB} MB).`);
  }

  const cleanName = sanitizeFileName(opts.originalName);
  const verified = await verifyFileType(opts.tempFile, cleanName, settings.allowedExtensions, {
    audioHint: opts.audioHint,
  });

  const storedName = newStoredName(verified.ext);
  const relPath = relPathFor(verified.category, storedName);
  const dest = storagePath(relPath);
  await moveFile(opts.tempFile, dest);

  const sha256 = await sha256File(dest);

  let thumbPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (verified.category === 'IMAGE') {
    const thumb = await makeImageThumbnail(dest, `${path.parse(storedName).name}.webp`);
    thumbPath = thumb.thumbRel;
    width = thumb.width ?? null;
    height = thumb.height ?? null;
  }

  const waveform =
    Array.isArray(opts.waveform) && opts.waveform.length > 0
      ? JSON.stringify(
          opts.waveform
            .slice(0, 120)
            .map((v) => Math.max(0, Math.min(1, Number.isFinite(v) ? Number(v.toFixed(3)) : 0))),
        )
      : null;

  const duration =
    typeof opts.duration === 'number' && Number.isFinite(opts.duration) && opts.duration >= 0 && opts.duration < 86400
      ? Number(opts.duration.toFixed(2))
      : null;

  const record = await prisma.file.create({
    data: {
      storedName,
      relPath,
      originalName: cleanName,
      ext: verified.ext,
      mime: verified.mime,
      size: stat.size,
      category: verified.category,
      scope: opts.scope,
      folder: (opts.folder || '').trim().slice(0, 60),
      description: (opts.description || '').trim().slice(0, 400),
      sha256,
      thumbPath,
      width,
      height,
      duration,
      waveform,
      uploaderId: opts.userId,
    },
  });

  const dto = fileDto(record);
  if (opts.scope === 'WORKSPACE') {
    emitToAll('workspace:file-added', dto);
    const uploader = await prisma.user.findUnique({ where: { id: opts.userId } });
    await activity(
      opts.userId,
      'FILE_UPLOADED',
      `${uploader?.displayName ?? 'A member'} uploaded "${record.originalName}" to shared files`,
      'file',
      record.id,
    );
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Chunked / Resumable Upload API (handles large videos & interrupted transfers)
// ---------------------------------------------------------------------------
filesRouter.post('/uploads/init', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1).max(255),
      size: z.number().int().min(1),
      purpose: z.enum(['CHAT', 'WORKSPACE', 'VOICE']).default('CHAT'),
      folder: z.string().max(60).optional(),
      description: z.string().max(400).optional(),
      duration: z.number().min(0).max(86400).optional(),
      waveform: z.array(z.number()).max(120).optional(),
    }),
    req.body,
  );
  const settings = await getSettings();
  const maxBytes = settings.maxFileSizeMB * 1024 * 1024;
  if (body.size > maxBytes) {
    throw badRequest(`File exceeds the maximum allowed size (${settings.maxFileSizeMB} MB).`);
  }
  const session = await prisma.uploadSession.create({
    data: {
      userId: req.user!.id,
      originalName: sanitizeFileName(body.name),
      size: body.size,
      received: 0,
      purpose: body.purpose,
      meta: JSON.stringify({
        folder: body.folder ?? '',
        description: body.description ?? '',
        duration: body.duration ?? null,
        waveform: body.waveform ?? null,
      }),
    },
  });
  await fsp.writeFile(tmpPath(session.id), Buffer.alloc(0));
  res.status(201).json({ uploadId: session.id, received: 0, chunkSize: 2 * 1024 * 1024 });
});

filesRouter.get('/uploads/:id', async (req, res) => {
  const session = await prisma.uploadSession.findUnique({ where: { id: param(req, 'id') } });
  if (!session || session.userId !== req.user!.id) throw notFound('Upload session not found.');
  res.json({ uploadId: session.id, received: session.received, size: session.size });
});

filesRouter.patch(
  '/uploads/:id',
  express.raw({ type: () => true, limit: '16mb' }),
  async (req, res) => {
    const id = param(req, 'id');
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user!.id) throw notFound('Upload session not found.');

    const chunk = req.body as Buffer;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) throw badRequest('Empty chunk.');

    const offsetHeader = req.headers['x-upload-offset'];
    const offset = offsetHeader !== undefined ? Number(offsetHeader) : session.received;
    if (!Number.isInteger(offset) || offset !== session.received) {
      return res.status(409).json({
        error: 'Upload offset mismatch.',
        code: 'OFFSET_MISMATCH',
        received: session.received,
      });
    }
    if (session.received + chunk.length > session.size) {
      throw badRequest('Chunk exceeds declared file size.');
    }

    const partFile = tmpPath(session.id);
    const fh = await fsp.open(partFile, 'r+');
    try {
      await fh.write(chunk, 0, chunk.length, offset);
    } finally {
      await fh.close();
    }

    const received = session.received + chunk.length;
    await prisma.uploadSession.update({ where: { id: session.id }, data: { received } });
    res.json({ uploadId: session.id, received, size: session.size });
  },
);

filesRouter.post('/uploads/:id/complete', async (req, res) => {
  const id = param(req, 'id');
  const session = await prisma.uploadSession.findUnique({ where: { id } });
  if (!session || session.userId !== req.user!.id) throw notFound('Upload session not found.');
  if (session.received !== session.size) {
    throw badRequest(`Upload incomplete (${session.received} of ${session.size} bytes received).`);
  }
  const partFile = tmpPath(session.id);
  const meta = safeJson<{
    folder?: string;
    description?: string;
    duration?: number | null;
    waveform?: number[] | null;
  }>(session.meta, {});

  try {
    const file = await finalizeUploadedFile({
      tempFile: partFile,
      originalName: session.originalName,
      userId: req.user!.id,
      scope: session.purpose === 'WORKSPACE' ? 'WORKSPACE' : 'CHAT',
      folder: meta.folder,
      description: meta.description,
      audioHint: session.purpose === 'VOICE',
      duration: meta.duration ?? null,
      waveform: meta.waveform ?? null,
    });
    await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
    res.status(201).json({ file });
  } catch (err) {
    await fsp.unlink(partFile).catch(() => {});
    await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
    throw err;
  }
});

filesRouter.delete('/uploads/:id', async (req, res) => {
  const id = param(req, 'id');
  const session = await prisma.uploadSession.findUnique({ where: { id } });
  if (!session || session.userId !== req.user!.id) throw notFound('Upload session not found.');
  await fsp.unlink(tmpPath(session.id)).catch(() => {});
  await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Direct streaming upload for convenience (any size up to maxFileSizeMB)
// ---------------------------------------------------------------------------
filesRouter.post('/upload', async (req, res) => {
  const rawName = String(req.headers['x-file-name'] || 'upload.bin');
  let originalName = rawName;
  try {
    originalName = decodeURIComponent(rawName);
  } catch {
    /* keep raw */
  }
  const scopeHeader = String(req.headers['x-file-scope'] || 'CHAT').toUpperCase();
  const scope: 'CHAT' | 'WORKSPACE' = scopeHeader === 'WORKSPACE' ? 'WORKSPACE' : 'CHAT';
  const folder = String(req.headers['x-file-folder'] || '');
  const description = String(req.headers['x-file-description'] || '');
  const audioHint = String(req.headers['x-audio-hint'] || '') === '1';
  const durationHeader = req.headers['x-media-duration'];
  const duration = durationHeader ? Number(durationHeader) : null;
  const waveformHeader = req.headers['x-audio-waveform'];
  const waveform = typeof waveformHeader === 'string' ? safeJson<number[] | null>(waveformHeader, null) : null;

  const settings = await getSettings();
  const maxBytes = settings.maxFileSizeMB * 1024 * 1024;
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw badRequest(`File exceeds the maximum allowed size (${settings.maxFileSizeMB} MB).`);
  }

  const tmpId = `direct${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  const partFile = tmpPath(tmpId);

  let received = 0;
  let aborted = false;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(partFile);
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        out.destroy();
        reject(badRequest(`File exceeds the maximum allowed size (${settings.maxFileSizeMB} MB).`));
      }
    });
    req.on('aborted', () => {
      aborted = true;
      out.destroy();
      reject(badRequest('Upload was interrupted.'));
    });
    req.on('error', (err) => {
      aborted = true;
      out.destroy();
      reject(err);
    });
    out.on('error', reject);
    out.on('finish', () => resolve());
    req.pipe(out);
  }).catch(async (err) => {
    await fsp.unlink(partFile).catch(() => {});
    throw err;
  });

  if (aborted) {
    await fsp.unlink(partFile).catch(() => {});
    throw badRequest('Upload was cancelled.');
  }

  try {
    const file = await finalizeUploadedFile({
      tempFile: partFile,
      originalName,
      userId: req.user!.id,
      scope,
      folder,
      description,
      audioHint,
      duration,
      waveform,
    });
    res.status(201).json({ file });
  } catch (err) {
    await fsp.unlink(partFile).catch(() => {});
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Attach a client-generated video thumbnail (validated & re-encoded with sharp)
// ---------------------------------------------------------------------------
filesRouter.post(
  '/:id/thumbnail',
  express.raw({ type: () => true, limit: '2mb' }),
  async (req, res) => {
    const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
    if (!file || file.deletedAt) throw notFound('File not found.');
    if (file.uploaderId !== req.user!.id && !isAdmin(req.user)) {
      throw forbidden('Only the uploader can attach a thumbnail.');
    }
    if (file.category !== 'VIDEO') throw badRequest('Thumbnails can only be uploaded for videos.');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('No image data provided.');
    const detected = await fileTypeFromBuffer(buf);
    if (!detected || !['jpg', 'png', 'webp'].includes(detected.ext)) {
      throw badRequest('Thumbnail must be a JPG, PNG, or WEBP image.');
    }
    const thumbRel = path.join('thumbnails', `${path.parse(file.storedName).name}.webp`);
    const sharp = await getSharp();
    if (sharp) {
      await sharp(buf, { animated: false })
        .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(storagePath(thumbRel));
    } else {
      await fsp.writeFile(storagePath(thumbRel), buf);
    }
    const durationHeader = req.headers['x-media-duration'];
    const duration = durationHeader && Number.isFinite(Number(durationHeader)) ? Number(durationHeader) : undefined;
    const updated = await prisma.file.update({
      where: { id: file.id },
      data: { thumbPath: thumbRel, ...(duration !== undefined ? { duration } : {}) },
    });
    res.json({ file: fileDto(updated) });
  },
);

// ---------------------------------------------------------------------------
// Listing & Searching Files
// ---------------------------------------------------------------------------
function accessibleFilesWhere(userId: string, scopeFilter: 'WORKSPACE' | 'CHAT' | 'ALL') {
  const chatFilter = {
    scope: 'CHAT',
    OR: [
      { uploaderId: userId },
      {
        attachments: {
          some: {
            message: {
              deletedAt: null,
              conversation: { members: { some: { userId } } },
            },
          },
        },
      },
    ],
  };
  if (scopeFilter === 'WORKSPACE') return { scope: 'WORKSPACE' };
  if (scopeFilter === 'CHAT') return chatFilter;
  return { OR: [{ scope: 'WORKSPACE' }, chatFilter] };
}

filesRouter.get('/', async (req, res) => {
  const q = parse(
    z.object({
      scope: z.enum(['WORKSPACE', 'CHAT', 'ALL']).default('WORKSPACE'),
      category: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'ARCHIVE', 'OTHER']).optional(),
      folder: z.string().max(60).optional(),
      pinned: z.enum(['true', 'false']).optional(),
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(80),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );

  const where: any = {
    deletedAt: null,
    AND: [
      accessibleFilesWhere(req.user!.id, q.scope),
      ...(q.category ? [{ category: q.category }] : []),
      ...(q.folder ? [{ folder: q.folder }] : []),
      ...(q.pinned !== undefined ? [{ pinned: q.pinned === 'true' }] : []),
      ...(q.q
        ? [
            {
              OR: [
                { originalName: { contains: q.q } },
                { description: { contains: q.q } },
                { folder: { contains: q.q } },
              ],
            },
          ]
        : []),
    ],
  };

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: q.limit,
      skip: q.offset,
    }),
    prisma.file.count({ where }),
  ]);

  res.json({ files: files.map(fileDto), total });
});

filesRouter.get('/gallery', async (req, res) => {
  const q = parse(
    z.object({
      kind: z.enum(['ALL', 'IMAGE', 'VIDEO']).default('ALL'),
      uploaderId: z.string().max(64).optional(),
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );
  const where: any = {
    deletedAt: null,
    category: q.kind === 'ALL' ? { in: ['IMAGE', 'VIDEO'] } : q.kind,
    AND: [
      accessibleFilesWhere(req.user!.id, 'ALL'),
      ...(q.uploaderId ? [{ uploaderId: q.uploaderId }] : []),
      ...(q.q ? [{ originalName: { contains: q.q } }] : []),
    ],
  };
  const [files, total] = await Promise.all([
    prisma.file.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    prisma.file.count({ where }),
  ]);
  res.json({ files: files.map(fileDto), total });
});

filesRouter.get('/:id', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file || !(await canAccessFile(req.user!, file))) throw notFound('File not found.');
  res.json({ file: fileDto(file) });
});

filesRouter.patch('/:id', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file || file.deletedAt) throw notFound('File not found.');
  if (file.uploaderId !== req.user!.id && !isAdmin(req.user)) {
    throw forbidden('Only the uploader or an admin can edit this file.');
  }
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(180).optional(),
      folder: z.string().trim().max(60).optional(),
      description: z.string().trim().max(400).optional(),
      pinned: z.boolean().optional(),
    }),
    req.body,
  );
  const updated = await prisma.file.update({
    where: { id: file.id },
    data: {
      ...(body.name ? { originalName: sanitizeFileName(body.name) } : {}),
      ...(body.folder !== undefined ? { folder: body.folder } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    },
  });
  const dto = fileDto(updated);
  if (updated.scope === 'WORKSPACE') emitToAll('workspace:file-updated', dto);
  res.json({ file: dto });
});

filesRouter.delete('/:id', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file || file.deletedAt) throw notFound('File not found.');
  if (file.uploaderId !== req.user!.id && !isAdmin(req.user)) {
    throw forbidden('Only the uploader or an admin can delete this file.');
  }
  await prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date(), pinned: false } });
  const src = storagePath(file.relPath);
  if (fs.existsSync(src)) {
    await moveFile(src, storagePath(path.join('trash', file.storedName))).catch(() => {});
  }
  if (file.scope === 'WORKSPACE') emitToAll('workspace:file-deleted', { id: file.id });
  await audit(req, 'FILE_DELETED', file.originalName, { fileId: file.id, scope: file.scope });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Secure Content & Thumbnail Streaming (with HTTP Range support for media)
// ---------------------------------------------------------------------------
function contentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

filesRouter.get('/:id/content', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file || !(await canAccessFile(req.user!, file))) throw notFound('File not found.');
  const abs = storagePath(file.relPath);
  if (!fs.existsSync(abs)) throw notFound('File is missing from storage.');

  const stat = await fsp.stat(abs);
  const forceDownload = req.query.download === '1' || req.query.download === 'true';
  const safeInline = INLINE_SAFE_MIMES.has(file.mime) && !forceDownload;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', contentDisposition(safeInline ? 'inline' : 'attachment', file.originalName));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400');

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) {
      // suffix range: bytes=-500
      const suffix = Number(match[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    }
    if (start >= stat.size || end >= stat.size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(abs, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(stat.size));
  fs.createReadStream(abs).pipe(res);
});

filesRouter.get('/:id/thumbnail', async (req, res) => {
  const file = await prisma.file.findUnique({ where: { id: param(req, 'id') } });
  if (!file || !file.thumbPath || !(await canAccessFile(req.user!, file))) throw notFound('Thumbnail not found.');
  const abs = storagePath(file.thumbPath);
  if (!fs.existsSync(abs)) throw notFound('Thumbnail missing.');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.sendFile(abs);
});

