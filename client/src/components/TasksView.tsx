import { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  CheckSquare,
  ListTodo,
  Menu,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import type { TaskItem, TodoList } from '../types';
import { Avatar } from './Avatar';

const COLUMNS = [
  { id: 'TODO', label: 'To Do', color: 'bg-[#9296A3]' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'bg-[#6C8CFF]' },
  { id: 'REVIEW', label: 'Review', color: 'bg-amber-400' },
  { id: 'DONE', label: 'Done', color: 'bg-[#21C7A8]' },
] as const;

const PRIORITY_STYLE: Record<string, string> = {
  LOW: 'bg-white/5 text-[#9296A3]',
  MEDIUM: 'bg-[#6C8CFF]/15 text-[#6C8CFF]',
  HIGH: 'bg-amber-500/15 text-amber-300',
  URGENT: 'bg-rose-500/20 text-rose-300',
};

export function TasksView() {
  const { users, workspacePulse, leftSidebarOpen, setLeftSidebar, toast } = useAppStore();
  const [subTab, setSubTab] = useState<'board' | 'todos'>('board');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [todos, setTodos] = useState<TodoList[]>([]);
  const [filterAssignee, setFilterAssignee] = useState('');

  // New task form
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');

  // New todo list + per-list new item inputs
  const [newListTitle, setNewListTitle] = useState('');
  const [newListShared, setNewListShared] = useState(true);
  const [newItemText, setNewItemText] = useState<Record<string, string>>({});

  async function load() {
    const [t, l] = await Promise.all([
      api<{ tasks: TaskItem[] }>('/workspace/tasks'),
      api<{ lists: TodoList[] }>('/workspace/todos'),
    ]);
    setTasks(t.tasks);
    setTodos(l.lists);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [workspacePulse]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post('/workspace/tasks', {
        title,
        description,
        priority,
        assigneeId: assigneeId || null,
        dueDate: dueDate || null,
      });
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setAssigneeId('');
      setDueDate('');
      setCreating(false);
      toast('Task created.', 'success');
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function moveTask(task: TaskItem, status: string) {
    try {
      await patch(`/workspace/tasks/${task.id}`, { status });
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function createTodoList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    await post('/workspace/todos', { title: newListTitle, shared: newListShared });
    setNewListTitle('');
    load();
  }

  async function addTodoItem(listId: string) {
    const txt = (newItemText[listId] || '').trim();
    if (!txt) return;
    await post(`/workspace/todos/${listId}/items`, { text: txt });
    setNewItemText((m) => ({ ...m, [listId]: '' }));
    load();
  }

  const visibleTasks = filterAssignee ? tasks.filter((t) => t.assigneeId === filterAssignee) : tasks;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#101114]">
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!leftSidebarOpen && (
            <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <CheckSquare className="w-5 h-5 text-[#6C8CFF]" />
          <h1 className="text-sm font-semibold">Tasks &amp; To-Do Lists</h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-[#101114] border border-white/[0.08] rounded-xl p-0.5">
            <button
              onClick={() => setSubTab('board')}
              className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                subTab === 'board' ? 'bg-[#20232B] text-white' : 'text-[#9296A3]'
              }`}
            >
              Task Board
            </button>
            <button
              onClick={() => setSubTab('todos')}
              className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                subTab === 'todos' ? 'bg-[#20232B] text-white' : 'text-[#9296A3]'
              }`}
            >
              To-Do Lists
            </button>
          </div>
          {subTab === 'board' && (
            <>
              <select
                value={filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value)}
                className="hidden sm:block bg-[#20232B] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs"
              >
                <option value="">All Assignees</option>
                {Object.values(users).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setCreating((c) => !c)}
                className="px-3.5 py-1.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> New Task
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {subTab === 'board' ? (
          <div className="space-y-4">
            {creating && (
              <form
                onSubmit={createTask}
                className="bg-[#181A20] border border-[#6C8CFF]/40 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl"
              >
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  className="md:col-span-2 bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#6C8CFF]"
                />
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="md:col-span-2 bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
                />
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="LOW">Low Priority</option>
                  <option value="MEDIUM">Medium Priority</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent</option>
                </select>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="">Unassigned</option>
                  {Object.values(users)
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                </select>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="px-3 py-2 rounded-xl bg-[#20232B] text-xs text-[#9296A3] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 rounded-xl bg-[#6C8CFF] text-white text-xs font-medium cursor-pointer">
                    Create Task
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
              {COLUMNS.map((col) => {
                const colTasks = visibleTasks.filter((t) => t.status === col.id);
                return (
                  <div
                    key={col.id}
                    className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-3 space-y-2.5 min-h-[260px]"
                  >
                    <div className="flex items-center justify-between px-1 pb-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${col.color}`} />
                        <span className="text-xs font-semibold text-[#F5F5F7]">{col.label}</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#9296A3]">{colTasks.length}</span>
                    </div>

                    {colTasks.map((t) => {
                      const assignee = t.assigneeId ? users[t.assigneeId] : null;
                      return (
                        <div
                          key={t.id}
                          className="bg-[#20232B] border border-white/[0.07] rounded-xl p-3 space-y-2 hover:border-white/15 transition"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-[#F5F5F7] leading-snug">{t.title}</span>
                            <button
                              onClick={() => del(`/workspace/tasks/${t.id}`).then(load)}
                              className="p-1 rounded hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {t.description && <p className="text-xs text-[#9296A3] line-clamp-3">{t.description}</p>}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${PRIORITY_STYLE[t.priority]}`}>
                              {t.priority}
                            </span>
                            {t.dueDate && (
                              <span className="text-[10px] text-[#9296A3] inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> {new Date(t.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {assignee ? (
                                <>
                                  <Avatar user={assignee} size="xs" />
                                  <span className="text-[11px] text-[#9296A3] truncate">{assignee.displayName}</span>
                                </>
                              ) : (
                                <span className="text-[11px] text-[#9296A3]/60">Unassigned</span>
                              )}
                            </div>
                            <select
                              value={t.status}
                              onChange={(e) => moveTask(t, e.target.value)}
                              className="bg-[#181A20] border border-white/10 rounded-lg px-2 py-1 text-[10px] text-[#F5F5F7] cursor-pointer"
                            >
                              {COLUMNS.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-5">
            <form onSubmit={createTodoList} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <input
                required
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                placeholder="Create a new checklist..."
                className="flex-1 min-w-[200px] bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#6C8CFF]"
              />
              <label className="flex items-center gap-1.5 text-xs text-[#9296A3] cursor-pointer">
                <input type="checkbox" checked={newListShared} onChange={(e) => setNewListShared(e.target.checked)} />
                Shared with team
              </label>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium cursor-pointer"
              >
                Create List
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {todos.map((list) => {
                const done = list.items.filter((i) => i.done).length;
                const pct = list.items.length ? Math.round((done / list.items.length) * 100) : 0;
                return (
                  <div key={list.id} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ListTodo className="w-4 h-4 text-[#21C7A8] shrink-0" />
                        <h3 className="text-sm font-semibold truncate">{list.title}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#20232B] text-[#9296A3]">
                          {list.shared ? 'Shared' : 'Private'}
                        </span>
                      </div>
                      <button
                        onClick={() => del(`/workspace/todos/${list.id}`).then(load)}
                        className="p-1 rounded hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-[#21C7A8] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-mono text-[#9296A3]">
                        {done}/{list.items.length}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {list.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 py-1 group">
                          <button
                            onClick={() =>
                              patch(`/workspace/todos/${list.id}/items/${item.id}`, { done: !item.done }).then(load)
                            }
                            className="flex items-center gap-2.5 text-left flex-1 min-w-0 cursor-pointer"
                          >
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition ${
                                item.done ? 'bg-[#21C7A8] border-[#21C7A8] text-[#0B1210]' : 'border-white/25'
                              }`}
                            >
                              {item.done && <Check className="w-3 h-3 stroke-[3]" />}
                            </span>
                            <span
                              className={`text-xs truncate ${
                                item.done ? 'line-through text-[#9296A3]/60' : 'text-[#F5F5F7]'
                              }`}
                            >
                              {item.text}
                            </span>
                          </button>
                          <button
                            onClick={() => del(`/workspace/todos/${list.id}/items/${item.id}`).then(load)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addTodoItem(list.id);
                      }}
                      className="flex gap-2 pt-2 border-t border-white/[0.06]"
                    >
                      <input
                        value={newItemText[list.id] || ''}
                        onChange={(e) => setNewItemText((m) => ({ ...m, [list.id]: e.target.value }))}
                        placeholder="Add item..."
                        className="flex-1 bg-[#20232B] border border-white/10 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-[#6C8CFF]"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-xl bg-[#20232B] hover:bg-[#6C8CFF] text-xs font-medium text-[#F5F5F7] transition cursor-pointer"
                      >
                        Add
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

