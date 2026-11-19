import { useEffect, useState } from 'react';
import { Forward, Hash, Search, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { Conversation, Message } from '../types';
import { Avatar } from './Avatar';

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#181A20] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#F5F5F7]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-[#9296A3] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function NewDmModal({ onClose }: { onClose: () => void }) {
  const { me, users, openDirectChat, toast } = useAppStore();
  const others = Object.values(users).filter((u) => u.id !== me?.id && u.isActive);

  async function pick(uid: string) {
    try {
      await openDirectChat(uid);
      onClose();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  return (
    <ModalShell title="New Direct Message" onClose={onClose}>
      {others.length === 0 ? (
        <p className="text-xs text-[#9296A3] text-center py-6">
          No other team members have joined yet. Invite partners from the Admin Dashboard.
        </p>
      ) : (
        <div className="space-y-1.5">
          {others.map((u) => (
            <button
              key={u.id}
              onClick={() => pick(u.id)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#20232B] text-left transition cursor-pointer"
            >
              <Avatar user={u} size="sm" showStatus />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#F5F5F7] truncate">{u.displayName}</div>
                <div className="text-xs text-[#9296A3] truncate">
                  @{u.username} · {u.online ? 'Online' : `Last seen ${formatRelative(u.lastSeenAt)}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

export function NewGroupModal({ onClose }: { onClose: () => void }) {
  const { me, users, upsertConversation, selectConversation, toast } = useAppStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const others = Object.values(users).filter((u) => u.id !== me?.id && u.isActive);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { conversation } = await post<{ conversation: Conversation }>('/conversations/group', {
        name,
        description,
        memberIds: selected,
      });
      upsertConversation(conversation);
      selectConversation(conversation.id);
      onClose();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Create Group Chat" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label className="block text-xs text-[#9296A3] mb-1">Group Name</label>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Design Sprint, Finance, Launch..."
            className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#6C8CFF]"
          />
        </div>
        <div>
          <label className="block text-xs text-[#9296A3] mb-1">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this group about?"
            className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
          />
        </div>
        <div>
          <label className="block text-xs text-[#9296A3] mb-1.5">Add Team Members</label>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {others.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#20232B] cursor-pointer"
              >
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                <Avatar user={u} size="xs" showStatus />
                <span className="text-sm text-[#F5F5F7]">{u.displayName}</span>
              </label>
            ))}
          </div>
        </div>
        <button
          disabled={saving}
          type="submit"
          className="w-full py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-sm font-medium cursor-pointer"
        >
          {saving ? 'Creating...' : 'Create Group'}
        </button>
      </form>
    </ModalShell>
  );
}

export function GroupSettingsModal({ onClose }: { onClose: () => void }) {
  const { me, isAdmin, users, conversations, activeConversationId, toast } = useAppStore();
  const conv = activeConversationId ? conversations[activeConversationId] : null;

  const [name, setName] = useState(conv?.name || '');
  const [description, setDescription] = useState(conv?.description || '');
  const [onlyAdmins, setOnlyAdmins] = useState(!!conv?.onlyAdminsCanPost);
  const [canInvite, setCanInvite] = useState(conv?.membersCanInvite ?? true);

  if (!conv || conv.type === 'DIRECT') return null;

  const myMember = conv.members.find((m) => m.userId === me?.id);
  const canManage = isAdmin || (conv.type === 'GROUP' && myMember?.role === 'ADMIN');
  const nonMembers = Object.values(users).filter(
    (u) => u.isActive && !conv.members.some((m) => m.userId === u.id),
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await patch(`/conversations/${conv!.id}`, {
        name,
        description,
        onlyAdminsCanPost: onlyAdmins,
        membersCanInvite: canInvite,
      });
      toast('Group settings updated.', 'success');
      onClose();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  return (
    <ModalShell title={conv.type === 'TEAM' ? 'Team Channel Settings' : 'Group Settings'} onClose={onClose}>
      <div className="space-y-4">
        {canManage && (
          <form onSubmit={save} className="space-y-3 pb-4 border-b border-white/[0.07]">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-[#9296A3] cursor-pointer">
              <input type="checkbox" checked={onlyAdmins} onChange={(e) => setOnlyAdmins(e.target.checked)} />
              Only admins can send messages
            </label>
            {conv.type === 'GROUP' && (
              <label className="flex items-center gap-2 text-xs text-[#9296A3] cursor-pointer">
                <input type="checkbox" checked={canInvite} onChange={(e) => setCanInvite(e.target.checked)} />
                Members can add other team members
              </label>
            )}
            <button type="submit" className="px-4 py-2 rounded-xl bg-[#6C8CFF] text-white text-xs font-medium cursor-pointer">
              Save Changes
            </button>
          </form>
        )}

        <div>
          <div className="text-xs font-semibold text-[#9296A3] mb-2">Members ({conv.members.length})</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {conv.members.map((m) => {
              const u = users[m.userId];
              if (!u) return null;
              return (
                <div key={m.userId} className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#20232B]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar user={u} size="xs" showStatus />
                    <span className="text-xs font-medium truncate">{u.displayName}</span>
                    {m.role === 'ADMIN' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6C8CFF]/15 text-[#6C8CFF]">Admin</span>
                    )}
                  </div>
                  {conv.type === 'GROUP' && (canManage || m.userId === me?.id) && (
                    <button
                      onClick={() =>
                        del(`/conversations/${conv.id}/members/${m.userId}`).then(() => {
                          toast(m.userId === me?.id ? 'Left group.' : 'Member removed.', 'info');
                          if (m.userId === me?.id) onClose();
                        })
                      }
                      title={m.userId === me?.id ? 'Leave group' : 'Remove member'}
                      className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {conv.type === 'GROUP' && (canManage || conv.membersCanInvite) && nonMembers.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-[#9296A3] mb-2">Add to Group</div>
            <div className="flex flex-wrap gap-1.5">
              {nonMembers.map((u) => (
                <button
                  key={u.id}
                  onClick={() =>
                    post(`/conversations/${conv.id}/members`, { userIds: [u.id] }).then(() =>
                      toast(`Added ${u.displayName}`, 'success'),
                    )
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-[#20232B] hover:bg-[#6C8CFF] text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" /> {u.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {conv.type === 'GROUP' && canManage && (
          <div className="pt-3 border-t border-white/[0.07]">
            <button
              onClick={() => {
                if (confirm(`Delete group "${conv.name}" and its messages?`)) {
                  del(`/conversations/${conv.id}`).then(() => {
                    toast('Group deleted.', 'info');
                    onClose();
                  });
                }
              }}
              className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Group
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export function ForwardModal() {
  const { me, users, conversations, forwardMessage, setForwardMessage, toast } = useAppStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  if (!forwardMessage) return null;

  const list = Object.values(conversations);
  function labelOf(c: Conversation) {
    if (c.type === 'DIRECT') {
      const m = c.members.find((x) => x.userId !== me?.id);
      return (m && users[m.userId]?.displayName) || 'Direct Message';
    }
    return c.name || 'Team';
  }

  async function submit() {
    if (selected.length === 0 || !forwardMessage) return;
    setSending(true);
    try {
      await post(`/messages/${forwardMessage.id}/forward`, { conversationIds: selected });
      toast(`Forwarded to ${selected.length} conversation${selected.length > 1 ? 's' : ''}.`, 'success');
      setSelected([]);
      setForwardMessage(null);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell title="Forward Message" onClose={() => setForwardMessage(null)}>
      <div className="space-y-3">
        <div className="p-3 rounded-xl bg-[#20232B] text-xs text-[#9296A3] line-clamp-3">
          {forwardMessage.content ||
            (forwardMessage.attachments[0] ? `Attachment: ${forwardMessage.attachments[0].name}` : 'Message')}
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {list.map((c) => (
            <label key={c.id} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#20232B] cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() =>
                  setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))
                }
              />
              {c.type === 'TEAM' ? (
                <Hash className="w-4 h-4 text-[#6C8CFF]" />
              ) : c.type === 'GROUP' ? (
                <Users className="w-4 h-4 text-[#21C7A8]" />
              ) : null}
              <span className="text-sm text-[#F5F5F7]">{labelOf(c)}</span>
            </label>
          ))}
        </div>
        <button
          disabled={selected.length === 0 || sending}
          onClick={submit}
          className="w-full py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] disabled:opacity-40 text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          <Forward className="w-4 h-4" /> Forward ({selected.length})
        </button>
      </div>
    </ModalShell>
  );
}

export function SearchModal() {
  const { searchModalOpen, setSearchModalOpen, users, conversations, me, selectConversation } = useAppStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searchModalOpen) {
      setQuery('');
      setResults([]);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      api<{ messages: Message[] }>(`/messages/search?q=${encodeURIComponent(query.trim())}&limit=40`)
        .then((d) => setResults(d.messages))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [query, searchModalOpen]);

  if (!searchModalOpen) return null;

  function convName(cid: string) {
    const c = conversations[cid];
    if (!c) return 'Conversation';
    if (c.type === 'DIRECT') {
      const m = c.members.find((x) => x.userId !== me?.id);
      return (m && users[m.userId]?.displayName) || 'Direct';
    }
    return c.name;
  }

  return (
    <div
      onClick={() => setSearchModalOpen(false)}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#181A20] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
          <Search className="w-4 h-4 text-[#9296A3]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchModalOpen(false)}
            placeholder="Search messages and shared file names across all chats..."
            className="flex-1 bg-transparent text-sm text-[#F5F5F7] placeholder:text-[#9296A3]/60 focus:outline-none"
          />
          <button onClick={() => setSearchModalOpen(false)} className="p-1 text-[#9296A3] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-xs text-[#9296A3]">Searching...</div>
          ) : query.trim().length < 2 ? (
            <div className="text-center py-8 text-xs text-[#9296A3]">Type at least 2 characters to search.</div>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#9296A3]">No matching messages found.</div>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  selectConversation(m.conversationId, m.id);
                  setSearchModalOpen(false);
                }}
                className="w-full text-left p-3 rounded-xl hover:bg-[#20232B] transition cursor-pointer"
              >
                <div className="flex items-center justify-between text-[11px] text-[#9296A3] mb-0.5">
                  <span>
                    <strong className="text-[#F5F5F7]">
                      {(m.senderId && users[m.senderId]?.displayName) || 'Member'}
                    </strong>{' '}
                    in <span className="text-[#6C8CFF]">{convName(m.conversationId)}</span>
                  </span>
                  <span>{formatRelative(m.createdAt)}</span>
                </div>
                <p className="text-xs text-[#F5F5F7]/85 line-clamp-2">
                  {m.content || m.attachments.map((a) => `📎 ${a.name}`).join(', ')}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

