import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAdmin, requireAuth } from '../middleware/auth.js';
import { activity } from '../services/audit.js';
import { emitToAll } from '../services/realtime.js';
import { fileDto } from '../services/serializers.js';
import { badRequest, forbidden, notFound, param, parse } from '../utils/http.js';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

// ---- Overview ----
workspaceRouter.get('/overview', async (_req, res) => {
  const [announcements, pinnedDocs, recentUploads, tasks, activities, links, notes] = await Promise.all([
    prisma.announcement.findMany({ orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 5 }),
    prisma.file.findMany({ where: { scope: 'WORKSPACE', pinned: true, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.file.findMany({ where: { scope: 'WORKSPACE', deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.task.findMany({ select: { status: true } }),
    prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.link.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.note.findMany({ orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }], take: 6 }),
  ]);
  const taskCounts = {
    TODO: tasks.filter((t) => t.status === 'TODO').length,
    IN_PROGRESS: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    REVIEW: tasks.filter((t) => t.status === 'REVIEW').length,
    DONE: tasks.filter((t) => t.status === 'DONE').length,
  };
  res.json({
    announcements,
    pinnedDocs: pinnedDocs.map(fileDto),
    recentUploads: recentUploads.map(fileDto),
    taskCounts,
    activities,
    links,
    notes,
  });
});

// ---- Announcements ----
workspaceRouter.get('/announcements', async (_req, res) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ announcements });
});

workspaceRouter.post('/announcements', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(6000),
      pinned: z.boolean().optional(),
    }),
    req.body,
  );
  const item = await prisma.announcement.create({
    data: {
      title: body.title,
      body: body.body,
      pinned: isAdmin(req.user) ? !!body.pinned : false,
      authorId: req.user!.id,
    },
  });
  emitToAll('workspace:announcement', { action: 'upsert', item });
  await activity(req.user!.id, 'ANNOUNCEMENT_POSTED', `${req.user!.displayName} posted announcement "${item.title}"`, 'announcement', item.id);
  res.status(201).json({ announcement: item });
});

workspaceRouter.patch('/announcements/:id', async (req, res) => {
  const existing = await prisma.announcement.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Announcement not found.');
  if (existing.authorId !== req.user!.id && !isAdmin(req.user)) throw forbidden('Only the author or an admin can edit this.');
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(1).max(6000).optional(),
      pinned: z.boolean().optional(),
    }),
    req.body,
  );
  if (body.pinned !== undefined && !isAdmin(req.user)) throw forbidden('Only admins can pin announcements.');
  const item = await prisma.announcement.update({ where: { id: existing.id }, data: body });
  emitToAll('workspace:announcement', { action: 'upsert', item });
  res.json({ announcement: item });
});

workspaceRouter.delete('/announcements/:id', async (req, res) => {
  const existing = await prisma.announcement.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Announcement not found.');
  if (existing.authorId !== req.user!.id && !isAdmin(req.user)) throw forbidden('Only the author or an admin can delete this.');
  await prisma.announcement.delete({ where: { id: existing.id } });
  emitToAll('workspace:announcement', { action: 'delete', id: existing.id });
  res.json({ ok: true });
});

// ---- Shared Notes ----
workspaceRouter.get('/notes', async (_req, res) => {
  const notes = await prisma.note.findMany({ orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] });
  res.json({ notes });
});

workspaceRouter.post('/notes', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(120),
      content: z.string().max(40000).default(''),
      color: z.enum(['default', 'indigo', 'teal', 'amber', 'rose']).default('default'),
      pinned: z.boolean().default(false),
    }),
    req.body,
  );
  const item = await prisma.note.create({
    data: { ...body, authorId: req.user!.id, updatedById: req.user!.id },
  });
  emitToAll('workspace:note', { action: 'upsert', item });
  await activity(req.user!.id, 'NOTE_CREATED', `${req.user!.displayName} created note "${item.title}"`, 'note', item.id);
  res.status(201).json({ note: item });
});

workspaceRouter.patch('/notes/:id', async (req, res) => {
  const existing = await prisma.note.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Note not found.');
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(120).optional(),
      content: z.string().max(40000).optional(),
      color: z.enum(['default', 'indigo', 'teal', 'amber', 'rose']).optional(),
      pinned: z.boolean().optional(),
    }),
    req.body,
  );
  const item = await prisma.note.update({
    where: { id: existing.id },
    data: { ...body, updatedById: req.user!.id },
  });
  emitToAll('workspace:note', { action: 'upsert', item });
  res.json({ note: item });
});

workspaceRouter.delete('/notes/:id', async (req, res) => {
  const existing = await prisma.note.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Note not found.');
  await prisma.note.delete({ where: { id: existing.id } });
  emitToAll('workspace:note', { action: 'delete', id: existing.id });
  res.json({ ok: true });
});

// ---- Task Board ----
workspaceRouter.get('/tasks', async (_req, res) => {
  const tasks = await prisma.task.findMany({
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ tasks });
});

workspaceRouter.post('/tasks', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(160),
      description: z.string().max(4000).default(''),
      status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).default('TODO'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
      dueDate: z.string().datetime().nullish().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
      assigneeId: z.string().max(64).nullish(),
    }),
    req.body,
  );
  if (body.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: body.assigneeId } });
    if (!assignee) throw badRequest('Assignee does not exist.');
  }
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  const count = await prisma.task.count({ where: { status: body.status } });
  const item = await prisma.task.create({
    data: {
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      position: count * 1000,
      dueDate,
      assigneeId: body.assigneeId || null,
      creatorId: req.user!.id,
      completedAt: body.status === 'DONE' ? new Date() : null,
    },
  });
  emitToAll('workspace:task', { action: 'upsert', item });
  await activity(req.user!.id, 'TASK_CREATED', `${req.user!.displayName} added task "${item.title}"`, 'task', item.id);
  res.status(201).json({ task: item });
});

workspaceRouter.patch('/tasks/:id', async (req, res) => {
  const existing = await prisma.task.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Task not found.');
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().max(4000).optional(),
      status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      position: z.number().optional(),
      dueDate: z.string().datetime().nullish().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
      assigneeId: z.string().max(64).nullish(),
    }),
    req.body,
  );
  if (body.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: body.assigneeId } });
    if (!assignee) throw badRequest('Assignee does not exist.');
  }
  const data: any = { ...body };
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.status && body.status !== existing.status) {
    data.completedAt = body.status === 'DONE' ? new Date() : null;
  }
  const item = await prisma.task.update({ where: { id: existing.id }, data });
  emitToAll('workspace:task', { action: 'upsert', item });
  if (body.status && body.status !== existing.status && body.status === 'DONE') {
    await activity(req.user!.id, 'TASK_COMPLETED', `${req.user!.displayName} completed "${item.title}"`, 'task', item.id);
  }
  res.json({ task: item });
});

workspaceRouter.delete('/tasks/:id', async (req, res) => {
  const existing = await prisma.task.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Task not found.');
  await prisma.task.delete({ where: { id: existing.id } });
  emitToAll('workspace:task', { action: 'delete', id: existing.id });
  res.json({ ok: true });
});

// ---- To-Do Lists ----
workspaceRouter.get('/todos', async (req, res) => {
  const lists = await prisma.todoList.findMany({
    where: { OR: [{ shared: true }, { ownerId: req.user!.id }] },
    include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ lists });
});

workspaceRouter.post('/todos', async (req, res) => {
  const body = parse(
    z.object({ title: z.string().trim().min(1).max(100), shared: z.boolean().default(true) }),
    req.body,
  );
  const list = await prisma.todoList.create({
    data: { title: body.title, shared: body.shared, ownerId: req.user!.id },
    include: { items: true },
  });
  if (list.shared) emitToAll('workspace:todo', { action: 'upsert', list });
  res.status(201).json({ list });
});

workspaceRouter.delete('/todos/:id', async (req, res) => {
  const list = await prisma.todoList.findUnique({ where: { id: param(req, 'id') } });
  if (!list) throw notFound('List not found.');
  if (!list.shared && list.ownerId !== req.user!.id) throw forbidden();
  if (list.shared && list.ownerId !== req.user!.id && !isAdmin(req.user)) throw forbidden('Only the creator or an admin can delete a shared list.');
  await prisma.todoList.delete({ where: { id: list.id } });
  if (list.shared) emitToAll('workspace:todo', { action: 'delete', id: list.id });
  res.json({ ok: true });
});

async function loadTodoList(listId: string, userId: string) {
  const list = await prisma.todoList.findUnique({ where: { id: listId }, include: { items: true } });
  if (!list) throw notFound('List not found.');
  if (!list.shared && list.ownerId !== userId) throw forbidden();
  return list;
}

workspaceRouter.post('/todos/:id/items', async (req, res) => {
  const list = await loadTodoList(param(req, 'id'), req.user!.id);
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(240) }), req.body);
  await prisma.todoItem.create({
    data: { listId: list.id, text, position: list.items.length * 1000 },
  });
  const updated = await prisma.todoList.findUnique({
    where: { id: list.id },
    include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (updated?.shared) emitToAll('workspace:todo', { action: 'upsert', list: updated });
  res.status(201).json({ list: updated });
});

workspaceRouter.patch('/todos/:id/items/:itemId', async (req, res) => {
  const list = await loadTodoList(param(req, 'id'), req.user!.id);
  const itemId = param(req, 'itemId');
  const body = parse(
    z.object({ text: z.string().trim().min(1).max(240).optional(), done: z.boolean().optional() }),
    req.body,
  );
  const item = await prisma.todoItem.findUnique({ where: { id: itemId } });
  if (!item || item.listId !== list.id) throw notFound('Item not found.');
  await prisma.todoItem.update({ where: { id: itemId }, data: body });
  const updated = await prisma.todoList.findUnique({
    where: { id: list.id },
    include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (updated?.shared) emitToAll('workspace:todo', { action: 'upsert', list: updated });
  res.json({ list: updated });
});

workspaceRouter.delete('/todos/:id/items/:itemId', async (req, res) => {
  const list = await loadTodoList(param(req, 'id'), req.user!.id);
  const itemId = param(req, 'itemId');
  const item = await prisma.todoItem.findUnique({ where: { id: itemId } });
  if (!item || item.listId !== list.id) throw notFound('Item not found.');
  await prisma.todoItem.delete({ where: { id: itemId } });
  const updated = await prisma.todoList.findUnique({
    where: { id: list.id },
    include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (updated?.shared) emitToAll('workspace:todo', { action: 'upsert', list: updated });
  res.json({ list: updated });
});

// ---- Important Links ----
const safeUrlSchema = z
  .string()
  .trim()
  .min(4)
  .max(2000)
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must start with http:// or https://');

workspaceRouter.get('/links', async (_req, res) => {
  const links = await prisma.link.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ links });
});

workspaceRouter.post('/links', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(1).max(120),
      url: safeUrlSchema,
      description: z.string().trim().max(300).default(''),
    }),
    req.body,
  );
  const item = await prisma.link.create({ data: { ...body, createdById: req.user!.id } });
  emitToAll('workspace:link', { action: 'upsert', item });
  await activity(req.user!.id, 'LINK_ADDED', `${req.user!.displayName} shared link "${item.title}"`, 'link', item.id);
  res.status(201).json({ link: item });
});

workspaceRouter.delete('/links/:id', async (req, res) => {
  const existing = await prisma.link.findUnique({ where: { id: param(req, 'id') } });
  if (!existing) throw notFound('Link not found.');
  if (existing.createdById !== req.user!.id && !isAdmin(req.user)) throw forbidden();
  await prisma.link.delete({ where: { id: existing.id } });
  emitToAll('workspace:link', { action: 'delete', id: existing.id });
  res.json({ ok: true });
});

// ---- Team Activity Feed ----
workspaceRouter.get('/activity', async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  const activities = await prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  res.json({ activities });
});

