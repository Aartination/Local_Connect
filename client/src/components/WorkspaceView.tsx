import { useEffect, useState } from 'react';
import {
  Activity,
  ExternalLink,
  FileText,
  LayoutGrid,
  Link2,
  Megaphone,
  Menu,
  Pin,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { ActivityItem, Announcement, FileItem, LinkItem, NoteItem } from '../types';
import { Avatar } from './Avatar';

const NOTE_COLORS: Record<string, string> = {
  default: 'border-white/[0.08] bg-[#181A20]',
  indigo: 'border-[#6C8CFF]/35 bg-[#6C8CFF]/[0.07]',
  teal: 'border-[#21C7A8]/35 bg-[#21C7A8]/[0.07]',
  amber: 'border-amber-400/35 bg-amber-400/[0.07]',
  rose: 'border-rose-400/35 bg-rose-400/[0.07]',
};

export function WorkspaceView() {
  const { me, isAdmin, users, workspacePulse, leftSidebarOpen, setLeftSidebar, openLightbox, setView, toast } =
    useAppStore();
  const [tab, setTab] = useState<'overview' | 'announcements' | 'notes' | 'links' | 'activity'>('overview');

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [pinnedDocs, setPinnedDocs] = useState<FileItem[]>([]);
  const [recentUploads, setRecentUploads] = useState<FileItem[]>([]);
  const [taskCounts, setTaskCounts] = useState({ TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 });

  // Forms
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPin, setAnnPin] = useState(false);

  const [editingNote, setEditingNote] = useState<Partial<NoteItem> | null>(null);

  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDesc, setLinkDesc] = useState('');

  async function loadAll() {
    try {
      const [ov, anns, ns, ls, acts] = await Promise.all([
        api<any>('/workspace/overview'),
        api<{ announcements: Announcement[] }>('/workspace/announcements'),
        api<{ notes: NoteItem[] }>('/workspace/notes'),
        api<{ links: LinkItem[] }>('/workspace/links'),
        api<{ activities: ActivityItem[] }>('/workspace/activity?limit=60'),
      ]);
      setPinnedDocs(ov.pinnedDocs || []);
      setRecentUploads(ov.recentUploads || []);
      setTaskCounts(ov.taskCounts || { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 });
      setAnnouncements(anns.announcements);
      setNotes(ns.notes);
      setLinks(ls.links);
      setActivities(acts.activities);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadAll();
  }, [workspacePulse]);

  async function createAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post('/workspace/announcements', { title: annTitle, body: annBody, pinned: annPin });
      setAnnTitle('');
      setAnnBody('');
      setAnnPin(false);
      toast('Announcement posted.', 'success');
      loadAll();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!editingNote?.title?.trim()) return;
    try {
      if (editingNote.id) {
        await patch(`/workspace/notes/${editingNote.id}`, {
          title: editingNote.title,
          content: editingNote.content || '',
          color: editingNote.color || 'default',
          pinned: !!editingNote.pinned,
        });
      } else {
        await post('/workspace/notes', {
          title: editingNote.title,
          content: editingNote.content || '',
          color: editingNote.color || 'default',
          pinned: !!editingNote.pinned,
        });
      }
      setEditingNote(null);
      toast('Note saved.', 'success');
      loadAll();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post('/workspace/links', { title: linkTitle, url: linkUrl, description: linkDesc });
      setLinkTitle('');
      setLinkUrl('');
      setLinkDesc('');
      toast('Link added.', 'success');
      loadAll();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
    { id: 'notes', label: 'Shared Notes', icon: StickyNote },
    { id: 'links', label: 'Important Links', icon: Link2 },
    { id: 'activity', label: 'Activity Feed', icon: Activity },
  ] as const;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#101114]">
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!leftSidebarOpen && (
            <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <LayoutGrid className="w-5 h-5 text-[#6C8CFF]" />
          <h1 className="text-sm font-semibold">Team Workspace</h1>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  tab === t.id ? 'bg-[#6C8CFF]/20 text-[#6C8CFF]' : 'text-[#9296A3] hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 max-w-6xl w-full mx-auto space-y-6">
        {tab === 'overview' && (
          <>
            {/* Summary KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                onClick={() => setView('tasks')}
                className="bg-[#181A20] hover:bg-[#1E212A] border border-white/[0.07] rounded-2xl p-4 text-left transition cursor-pointer"
              >
                <div className="text-xs text-[#9296A3]">Open Tasks</div>
                <div className="text-2xl font-semibold mt-1 text-[#F5F5F7]">
                  {taskCounts.TODO + taskCounts.IN_PROGRESS + taskCounts.REVIEW}
                </div>
                <div className="text-[11px] text-[#21C7A8] mt-1">{taskCounts.DONE} completed</div>
              </button>
              <button
                onClick={() => setTab('notes')}
                className="bg-[#181A20] hover:bg-[#1E212A] border border-white/[0.07] rounded-2xl p-4 text-left transition cursor-pointer"
              >
                <div className="text-xs text-[#9296A3]">Shared Notes</div>
                <div className="text-2xl font-semibold mt-1 text-[#F5F5F7]">{notes.length}</div>
                <div className="text-[11px] text-[#9296A3] mt-1">Synced live across team</div>
              </button>
              <button
                onClick={() => setView('files')}
                className="bg-[#181A20] hover:bg-[#1E212A] border border-white/[0.07] rounded-2xl p-4 text-left transition cursor-pointer"
              >
                <div className="text-xs text-[#9296A3]">Pinned Documents</div>
                <div className="text-2xl font-semibold mt-1 text-[#F5F5F7]">{pinnedDocs.length}</div>
                <div className="text-[11px] text-[#6C8CFF] mt-1">{recentUploads.length} recent uploads</div>
              </button>
              <button
                onClick={() => setTab('announcements')}
                className="bg-[#181A20] hover:bg-[#1E212A] border border-white/[0.07] rounded-2xl p-4 text-left transition cursor-pointer"
              >
                <div className="text-xs text-[#9296A3]">Announcements</div>
                <div className="text-2xl font-semibold mt-1 text-[#F5F5F7]">{announcements.length}</div>
                <div className="text-[11px] text-[#9296A3] mt-1">{links.length} bookmarked links</div>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Left 2 cols: Announcements + Pinned Docs + Recent Uploads */}
              <div className="lg:col-span-2 space-y-5">
                <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Megaphone className="w-4 h-4 text-[#6C8CFF]" /> Latest Announcements
                    </h2>
                    <button onClick={() => setTab('announcements')} className="text-xs text-[#6C8CFF] hover:underline cursor-pointer">
                      Manage
                    </button>
                  </div>
                  {announcements.length === 0 ? (
                    <p className="text-xs text-[#9296A3] py-4">No announcements yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {announcements.slice(0, 3).map((a) => (
                        <div key={a.id} className="p-3 rounded-xl bg-[#20232B] border border-white/[0.06]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-[#F5F5F7]">{a.title}</span>
                            {a.pinned && <Pin className="w-3.5 h-3.5 text-amber-300 shrink-0" />}
                          </div>
                          <p className="text-xs text-[#9296A3] mt-1 whitespace-pre-wrap">{a.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#21C7A8]" /> Pinned Documents &amp; Recent Uploads
                    </h2>
                    <button onClick={() => setView('files')} className="text-xs text-[#6C8CFF] hover:underline cursor-pointer">
                      Open Repository
                    </button>
                  </div>
                  {[...pinnedDocs, ...recentUploads.filter((r) => !pinnedDocs.some((p) => p.id === r.id))].slice(0, 6)
                    .length === 0 ? (
                    <p className="text-xs text-[#9296A3] py-4">Upload shared files to pin and access them here.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[...pinnedDocs, ...recentUploads.filter((r) => !pinnedDocs.some((p) => p.id === r.id))]
                        .slice(0, 6)
                        .map((f) => (
                          <button
                            key={f.id}
                            onClick={() => openLightbox(f, recentUploads)}
                            className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/[0.06] text-left transition cursor-pointer"
                          >
                            <FileText className="w-4 h-4 text-[#6C8CFF] shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-[#F5F5F7] truncate">{f.name}</div>
                              <div className="text-[10px] text-[#9296A3]">
                                {formatBytes(f.size)} · {formatRelative(f.createdAt)}
                              </div>
                            </div>
                            {f.pinned && <Pin className="w-3 h-3 text-amber-300 shrink-0" />}
                          </button>
                        ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Right col: Activity Feed */}
              <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-[#21C7A8]" /> Team Activity
                </h2>
                <div className="space-y-3">
                  {activities.slice(0, 12).map((act) => (
                    <div key={act.id} className="flex items-start gap-2.5 text-xs">
                      <Avatar user={act.userId ? users[act.userId] : null} size="xs" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[#F5F5F7]/90 leading-snug">{act.summary}</p>
                        <span className="text-[10px] text-[#9296A3]">{formatRelative(act.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && <p className="text-xs text-[#9296A3]">No recent activity.</p>}
                </div>
              </section>
            </div>
          </>
        )}

        {tab === 'announcements' && (
          <div className="space-y-5">
            <form onSubmit={createAnnouncement} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
              <h2 className="text-sm font-semibold">Post Team Announcement</h2>
              <input
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement headline"
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#6C8CFF]"
              />
              <textarea
                required
                rows={3}
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                placeholder="Share updates, schedules, or milestones with all team members..."
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#6C8CFF]"
              />
              <div className="flex items-center justify-between">
                {isAdmin ? (
                  <label className="flex items-center gap-2 text-xs text-[#9296A3] cursor-pointer">
                    <input type="checkbox" checked={annPin} onChange={(e) => setAnnPin(e.target.checked)} />
                    Pin announcement to top
                  </label>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium cursor-pointer"
                >
                  Publish
                </button>
              </div>
            </form>

            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a.id} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-[#F5F5F7]">{a.title}</h3>
                        {a.pinned && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-medium">
                            Pinned
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#9296A3] mt-0.5">
                        Posted by {(a.authorId && users[a.authorId]?.displayName) || 'Member'} ·{' '}
                        {formatRelative(a.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isAdmin && (
                        <button
                          onClick={() => patch(`/workspace/announcements/${a.id}`, { pinned: !a.pinned }).then(loadAll)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-amber-300 cursor-pointer"
                          title={a.pinned ? 'Unpin' : 'Pin'}
                        >
                          <Pin className="w-4 h-4" />
                        </button>
                      )}
                      {(isAdmin || a.authorId === me?.id) && (
                        <button
                          onClick={() => del(`/workspace/announcements/${a.id}`).then(loadAll)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-[#F5F5F7]/90 mt-3 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#9296A3]">Collaborative shared notes editable by everyone on the team.</p>
              <button
                onClick={() => setEditingNote({ title: '', content: '', color: 'default', pinned: false })}
                className="px-3.5 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> New Note
              </button>
            </div>

            {editingNote && (
              <form onSubmit={saveNote} className="bg-[#181A20] border border-[#6C8CFF]/40 rounded-2xl p-4 space-y-3">
                <input
                  required
                  value={editingNote.title || ''}
                  onChange={(e) => setEditingNote({ ...editingNote, title: e.target.value })}
                  placeholder="Note title..."
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm font-medium focus:outline-none focus:border-[#6C8CFF]"
                />
                <textarea
                  rows={6}
                  value={editingNote.content || ''}
                  onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                  placeholder="Write meeting notes, specs, checklists, or ideas..."
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-[#6C8CFF]"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {(['default', 'indigo', 'teal', 'amber', 'rose'] as const).map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setEditingNote({ ...editingNote, color: c })}
                        className={`px-2.5 py-1 rounded-lg text-xs capitalize border cursor-pointer ${
                          editingNote.color === c ? 'border-[#6C8CFF] text-white bg-[#20232B]' : 'border-white/10 text-[#9296A3]'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                    <label className="flex items-center gap-1.5 text-xs text-[#9296A3] ml-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!editingNote.pinned}
                        onChange={(e) => setEditingNote({ ...editingNote, pinned: e.target.checked })}
                      />
                      Pin
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingNote(null)}
                      className="px-3 py-1.5 rounded-xl bg-[#20232B] text-xs text-[#9296A3] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-xl bg-[#6C8CFF] text-white text-xs font-medium cursor-pointer"
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {notes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => setEditingNote(n)}
                  className={`rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition flex flex-col justify-between min-h-[160px] ${
                    NOTE_COLORS[n.color] || NOTE_COLORS.default
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-semibold text-[#F5F5F7]">{n.title}</h3>
                      <div className="flex items-center gap-1">
                        {n.pinned && <Pin className="w-3.5 h-3.5 text-amber-300" />}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete note "${n.title}"?`)) del(`/workspace/notes/${n.id}`).then(loadAll);
                          }}
                          className="p-1 rounded hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#F5F5F7]/80 whitespace-pre-wrap line-clamp-6">{n.content || 'Empty note'}</p>
                  </div>
                  <div className="text-[10px] text-[#9296A3] mt-3 pt-2 border-t border-white/[0.06]">
                    Updated by {(n.updatedById && users[n.updatedById]?.displayName) || 'Member'} ·{' '}
                    {formatRelative(n.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'links' && (
          <div className="space-y-5">
            <form onSubmit={addLink} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                required
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Link title"
                className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
              />
              <input
                required
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://... or http://192.168..."
                className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
              />
              <input
                value={linkDesc}
                onChange={(e) => setLinkDesc(e.target.value)}
                placeholder="Short description (optional)"
                className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium cursor-pointer"
              >
                Add Link
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {links.map((l) => (
                <div
                  key={l.id}
                  className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[#6C8CFF] hover:underline inline-flex items-center gap-1.5"
                    >
                      {l.title} <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <div className="text-xs text-[#9296A3] truncate mt-0.5">{l.url}</div>
                    {l.description && <p className="text-xs text-[#F5F5F7]/80 mt-1">{l.description}</p>}
                  </div>
                  {(isAdmin || l.createdById === me?.id) && (
                    <button
                      onClick={() => del(`/workspace/links/${l.id}`).then(loadAll)}
                      className="p-2 rounded-lg hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'activity' && (
          <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 divide-y divide-white/[0.06]">
            {activities.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={a.userId ? users[a.userId] : null} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm text-[#F5F5F7]">{a.summary}</div>
                    <div className="text-[11px] text-[#9296A3]">{a.type.replace(/_/g, ' ')}</div>
                  </div>
                </div>
                <span className="text-xs text-[#9296A3] shrink-0">{formatRelative(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

