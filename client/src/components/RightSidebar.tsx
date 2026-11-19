import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  MessageSquare,
  Pin,
  Users,
  X,
} from 'lucide-react';
import { api, downloadWithProgress } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { FileItem, Message } from '../types';
import { Avatar } from './Avatar';

export function RightSidebar() {
  const {
    me,
    users,
    conversations,
    activeView,
    activeConversationId,
    rightSidebarOpen,
    rightTab,
    setRightSidebar,
    openDirectChat,
    openLightbox,
    selectConversation,
  } = useAppStore();

  const [media, setMedia] = useState<FileItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [pins, setPins] = useState<Message[]>([]);

  const activeConv = activeConversationId ? conversations[activeConversationId] : null;
  const inChat = activeView === 'chat' && !!activeConv;

  useEffect(() => {
    if (!rightSidebarOpen || !inChat || !activeConv) return;
    if (rightTab === 'media') {
      api<{ files: FileItem[] }>(`/conversations/${activeConv.id}/files?kind=media&limit=50`)
        .then((d) => setMedia(d.files))
        .catch(() => {});
    } else if (rightTab === 'files') {
      api<{ files: FileItem[] }>(`/conversations/${activeConv.id}/files?kind=files&limit=50`)
        .then((d) => setFiles(d.files))
        .catch(() => {});
    } else if (rightTab === 'pins') {
      api<{ messages: Message[] }>(`/conversations/${activeConv.id}/pins`)
        .then((d) => setPins(d.messages))
        .catch(() => {});
    }
  }, [rightSidebarOpen, inChat, activeConv?.id, rightTab, activeConv?.lastMessageAt]);

  if (!rightSidebarOpen) return null;

  const memberUsers = inChat && activeConv
    ? activeConv.members.map((m) => ({ member: m, user: users[m.userId] })).filter((x) => x.user)
    : Object.values(users)
        .filter((u) => u.isActive)
        .map((u) => ({ member: null, user: u }));

  const onlineMembers = memberUsers.filter((x) => x.user.online);
  const offlineMembers = memberUsers.filter((x) => !x.user.online);

  const tabs: Array<{ id: 'members' | 'media' | 'files' | 'pins'; label: string; icon: any }> = [
    { id: 'members', label: 'Members', icon: Users },
    { id: 'media', label: 'Media', icon: ImageIcon },
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'pins', label: 'Pins', icon: Pin },
  ];

  return (
    <aside className="hidden xl:flex w-[288px] shrink-0 bg-[#181A20] border-l border-white/[0.07] flex-col select-none">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-white/[0.07] shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#9296A3]">
          {inChat ? 'Conversation Info' : 'Team Members'}
        </span>
        <button
          onClick={() => setRightSidebar(false)}
          className="p-1.5 rounded-lg hover:bg-white/5 text-[#9296A3] hover:text-[#F5F5F7] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs when inside a conversation */}
      {inChat && (
        <div className="grid grid-cols-4 gap-1 p-2 border-b border-white/[0.07] shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = rightTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setRightSidebar(true, t.id)}
                className={`py-1.5 rounded-lg flex flex-col items-center gap-0.5 text-[10px] font-medium transition cursor-pointer ${
                  active ? 'bg-[#20232B] text-[#F5F5F7]' : 'text-[#9296A3] hover:text-[#F5F5F7] hover:bg-white/[0.04]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#6C8CFF]' : ''}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {(!inChat || rightTab === 'members') && (
          <>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#21C7A8] px-1 mb-2">
                Online — {onlineMembers.length}
              </div>
              <div className="space-y-1">
                {onlineMembers.map(({ user, member }) => (
                  <div
                    key={user.id}
                    className="group flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-white/[0.04] transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar user={user} size="sm" showStatus />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#F5F5F7] truncate flex items-center gap-1.5">
                          <span className="truncate">{user.displayName}</span>
                          {(user.role === 'OWNER' || member?.role === 'ADMIN') && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#6C8CFF]/15 text-[#6C8CFF] font-semibold uppercase">
                              {user.role === 'OWNER' ? 'Owner' : 'Admin'}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#9296A3] truncate">
                          {user.statusText || `@${user.username}`}
                        </div>
                      </div>
                    </div>
                    {user.id !== me?.id && (
                      <button
                        onClick={() => openDirectChat(user.id)}
                        title={`Message ${user.displayName}`}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-[#20232B] hover:bg-[#6C8CFF] text-[#9296A3] hover:text-white transition cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {offlineMembers.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9296A3]/70 px-1 mb-2">
                  Offline — {offlineMembers.length}
                </div>
                <div className="space-y-1">
                  {offlineMembers.map(({ user }) => (
                    <div
                      key={user.id}
                      className="group flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-white/[0.04] transition opacity-75"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar user={user} size="sm" showStatus />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#F5F5F7] truncate">{user.displayName}</div>
                          <div className="text-[11px] text-[#9296A3] truncate">
                            Last seen {formatRelative(user.lastSeenAt)}
                          </div>
                        </div>
                      </div>
                      {user.id !== me?.id && (
                        <button
                          onClick={() => openDirectChat(user.id)}
                          title={`Message ${user.displayName}`}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-[#20232B] hover:bg-[#6C8CFF] text-[#9296A3] hover:text-white transition cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {inChat && rightTab === 'media' && (
          media.length === 0 ? (
            <div className="text-center py-10 text-xs text-[#9296A3]">No photos or videos shared here yet.</div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {media.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openLightbox(f, media)}
                  className="aspect-square rounded-lg overflow-hidden bg-[#20232B] relative group cursor-pointer border border-white/5"
                >
                  {f.thumbUrl || (f.category === 'IMAGE' && f.url) ? (
                    <img
                      src={f.thumbUrl || f.url!}
                      alt={f.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#9296A3]">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  {f.category === 'VIDEO' && (
                    <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/75 text-[9px] text-white font-mono">
                      VID
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        )}

        {inChat && rightTab === 'files' && (
          files.length === 0 ? (
            <div className="text-center py-10 text-xs text-[#9296A3]">No documents shared here yet.</div>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#20232B] border border-white/[0.06] hover:border-white/15 transition"
                >
                  <button
                    onClick={() => openLightbox(f, files)}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#6C8CFF]/15 text-[#6C8CFF] flex items-center justify-center shrink-0 text-[10px] font-bold uppercase">
                      {f.ext.slice(0, 4)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#F5F5F7] truncate">{f.name}</div>
                      <div className="text-[11px] text-[#9296A3]">{formatBytes(f.size)}</div>
                    </div>
                  </button>
                  {f.downloadUrl && (
                    <button
                      onClick={() => downloadWithProgress(f.downloadUrl!, f.name)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-[#F5F5F7] cursor-pointer"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {inChat && rightTab === 'pins' && (
          pins.length === 0 ? (
            <div className="text-center py-10 text-xs text-[#9296A3]">No pinned messages yet.</div>
          ) : (
            <div className="space-y-2">
              {pins.map((m) => (
                <button
                  key={m.id}
                  onClick={() => activeConv && selectConversation(activeConv.id, m.id)}
                  className="w-full text-left p-3 rounded-xl bg-[#20232B] border border-white/[0.06] hover:border-[#6C8CFF]/40 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] text-[#9296A3] mb-1">
                    <span className="font-medium text-[#F5F5F7]">
                      {(m.senderId && users[m.senderId]?.displayName) || 'Member'}
                    </span>
                    <span>{formatRelative(m.createdAt)}</span>
                  </div>
                  <p className="text-xs text-[#F5F5F7]/85 line-clamp-3">
                    {m.content || (m.attachments[0] ? `Attachment: ${m.attachments[0].name}` : 'Pinned item')}
                  </p>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </aside>
  );
}

