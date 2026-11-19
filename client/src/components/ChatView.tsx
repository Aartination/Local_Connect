import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  Download,
  Edit3,
  FileArchive,
  FileText,
  Film,
  Forward,
  Hash,
  Menu,
  Mic,
  PanelRight,
  Paperclip,
  Phone,
  PhoneCall,
  Pin,
  PinOff,
  Play,
  Search,
  Send,
  Settings2,
  Smile,
  Trash2,
  UploadCloud,
  Users,
  Video,
  X,
} from 'lucide-react';
import { del, downloadWithProgress, patch, post, uploadFile } from '../lib/api';
import { formatBytes, formatDateHeading, formatDuration, formatRelative, formatTime } from '../lib/format';
import { getSocket } from '../lib/socket';
import { useAppStore } from '../store/useAppStore';
import type { FileItem, Message } from '../types';
import { Avatar } from './Avatar';
import { VoicePlayer } from './VoicePlayer';
import { VoiceRecorder } from './VoiceRecorder';

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '🎉', '👀'];
const EMOJI_GRID = [
  '😀', '😂', '🥹', '😍', '🤩', '😎', '🤔', '🙌',
  '👍', '👎', '👏', '🔥', '✨', '🎉', '❤️', '💯',
  '✅', '⚡', '🚀', '💡', '📌', '📎', '📁', '🎯',
  '👀', '🙏', '🤝', '💪', '😅', '🥳', '🤯', '☕',
];

interface StagedUpload {
  localId: string;
  name: string;
  size: number;
  progress: number;
  file?: FileItem;
  error?: string;
  abort: AbortController;
}

interface ChatViewProps {
  onOpenGroupSettings: () => void;
}

export function ChatView({ onOpenGroupSettings }: ChatViewProps) {
  const {
    me,
    isAdmin,
    users,
    conversations,
    messagesByConv,
    typingByConv,
    activeConversationId,
    jumpToMessageId,
    leftSidebarOpen,
    rightSidebarOpen,
    setLeftSidebar,
    setRightSidebar,
    loadMessages,
    markRead,
    clearJump,
    openLightbox,
    setForwardMessage,
    setSearchModalOpen,
    startCall,
    joinExistingCall,
    activeCall,
    toast,
  } = useAppStore();

  const conv = activeConversationId ? conversations[activeConversationId] : null;
  const bucket = activeConversationId ? messagesByConv[activeConversationId] : undefined;
  const messages = bucket?.items ?? [];

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [staged, setStaged] = useState<StagedUpload[]>([]);
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactPickerFor, setReactPickerFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState<Record<string, number>>({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastConvRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef(0);

  // Reset composer transient state when switching conversations
  useEffect(() => {
    if (lastConvRef.current !== activeConversationId) {
      lastConvRef.current = activeConversationId;
      prevMsgCountRef.current = 0;
      setReplyTo(null);
      setEditing(null);
      setRecording(false);
      setEmojiOpen(false);
      setReactPickerFor(null);
      if (activeConversationId) {
        markRead(activeConversationId);
      }
    }
  }, [activeConversationId]);

  // Auto-scroll to bottom on initial load or when new message arrives while near bottom
  useEffect(() => {
    if (jumpToMessageId) {
      const el = document.getElementById(`msg-${jumpToMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(jumpToMessageId);
        clearJump();
        setTimeout(() => setHighlightedId(null), 2200);
        return;
      }
    }
    const container = scrollRef.current;
    if (!container) return;
    const isInitial = prevMsgCountRef.current === 0 && messages.length > 0;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
    const lastIsMine = messages[messages.length - 1]?.senderId === me?.id;
    if (isInitial || (messages.length > prevMsgCountRef.current && (nearBottom || lastIsMine))) {
      bottomRef.current?.scrollIntoView({ behavior: isInitial ? 'auto' : 'smooth' });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, jumpToMessageId, activeConversationId]);

  // Typing users active right now
  const [nowTick, setNowTick] = useState(Date.now());
  const typingMap = activeConversationId ? typingByConv[activeConversationId] : undefined;
  useEffect(() => {
    if (!typingMap || Object.keys(typingMap).length === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1200);
    return () => clearInterval(id);
  }, [typingMap]);

  const activeTypers = useMemo(() => {
    if (!typingMap) return [];
    return Object.entries(typingMap)
      .filter(([uid, exp]) => uid !== me?.id && exp > nowTick)
      .map(([uid]) => users[uid]?.displayName || 'Someone');
  }, [typingMap, nowTick, me?.id, users]);

  const otherDirectUser = useMemo(() => {
    if (!conv || conv.type !== 'DIRECT') return null;
    const m = conv.members.find((x) => x.userId !== me?.id);
    return m ? users[m.userId] : null;
  }, [conv, me?.id, users]);

  const convTitle =
    conv?.type === 'DIRECT'
      ? otherDirectUser?.displayName || 'Direct Message'
      : conv?.name || 'Conversation';

  const canManage =
    !!conv &&
    conv.type !== 'DIRECT' &&
    (isAdmin || conv.members.find((m) => m.userId === me?.id)?.role === 'ADMIN');

  const canPost = !conv?.onlyAdminsCanPost || canManage;

  function emitTyping(active: boolean) {
    if (!activeConversationId) return;
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(active ? 'typing:start' : 'typing:stop', { conversationId: activeConversationId });
  }

  function handleTextChange(val: string) {
    setText(val);
    if (val.trim()) {
      emitTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => emitTyping(false), 2600);
    } else {
      emitTyping(false);
    }
  }

  async function queueFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    for (const file of arr) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const abort = new AbortController();
      setStaged((prev) => [...prev, { localId, name: file.name, size: file.size, progress: 0, abort }]);
      uploadFile(file, file.name, {
        scope: 'CHAT',
        signal: abort.signal,
        onProgress: (pct) => {
          setStaged((prev) => prev.map((s) => (s.localId === localId ? { ...s, progress: pct } : s)));
        },
      })
        .then((uploaded) => {
          setStaged((prev) =>
            prev.map((s) => (s.localId === localId ? { ...s, progress: 100, file: uploaded } : s)),
          );
        })
        .catch((err: any) => {
          if (err?.message === 'Upload cancelled.') return;
          setStaged((prev) =>
            prev.map((s) => (s.localId === localId ? { ...s, error: err?.message || 'Upload failed' } : s)),
          );
          toast(err?.message || `Could not upload ${file.name}`, 'error');
        });
    }
  }

  function removeStaged(localId: string) {
    setStaged((prev) => {
      const item = prev.find((x) => x.localId === localId);
      if (item && !item.file) item.abort.abort();
      return prev.filter((x) => x.localId !== localId);
    });
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!conv || sending) return;
    const readyFiles = staged.filter((s) => s.file).map((s) => s.file!.id);
    const stillUploading = staged.some((s) => !s.file && !s.error);
    if (stillUploading) {
      toast('Wait for uploads to finish before sending.', 'info');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && readyFiles.length === 0) return;

    setSending(true);
    emitTyping(false);
    try {
      await post(`/conversations/${conv.id}/messages`, {
        content: trimmed,
        replyToId: replyTo?.id ?? null,
        fileIds: readyFiles,
        type: 'TEXT',
      });
      setText('');
      setReplyTo(null);
      setStaged([]);
      setEmojiOpen(false);
      textareaRef.current?.focus();
    } catch (err: any) {
      toast(err?.message || 'Could not send message.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function sendVoiceMessage(blob: Blob, filename: string, duration: number, waveform: number[]) {
    if (!conv) return;
    const uploaded = await uploadFile(blob, filename, {
      scope: 'CHAT',
      audioHint: true,
      duration,
      waveform,
    });
    await post(`/conversations/${conv.id}/messages`, {
      content: '',
      replyToId: replyTo?.id ?? null,
      fileIds: [uploaded.id],
      type: 'VOICE',
    });
    setReplyTo(null);
    setRecording(false);
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await patch(`/messages/${editing.id}`, { content: editText });
      setEditing(null);
      setEditText('');
    } catch (err: any) {
      toast(err?.message || 'Could not edit message.', 'error');
    }
  }

  async function deleteMessage(msg: Message) {
    try {
      await del(`/messages/${msg.id}`);
    } catch (err: any) {
      toast(err?.message || 'Could not delete message.', 'error');
    }
  }

  async function toggleReaction(msg: Message, emoji: string) {
    setReactPickerFor(null);
    try {
      await post(`/messages/${msg.id}/reactions`, { emoji });
    } catch (err: any) {
      toast(err?.message || 'Could not add reaction.', 'error');
    }
  }

  async function togglePin(msg: Message) {
    try {
      await post(`/messages/${msg.id}/pin`, { pinned: !msg.pinnedAt });
      toast(msg.pinnedAt ? 'Message unpinned.' : 'Message pinned.', 'success');
    } catch (err: any) {
      toast(err?.message || 'Could not update pin.', 'error');
    }
  }

  function copyMessage(msg: Message) {
    navigator.clipboard?.writeText(msg.content || msg.attachments.map((a) => a.name).join(', '));
    toast('Copied to clipboard.', 'success');
  }

  async function handleFileDownload(f: FileItem) {
    if (!f.downloadUrl) return;
    try {
      setDownloadPct((p) => ({ ...p, [f.id]: 1 }));
      await downloadWithProgress(f.downloadUrl, f.name, (pct) => {
        setDownloadPct((p) => ({ ...p, [f.id]: pct }));
      });
      setTimeout(() => {
        setDownloadPct((p) => {
          const n = { ...p };
          delete n[f.id];
          return n;
        });
      }, 900);
    } catch {
      toast('Download failed.', 'error');
      setDownloadPct((p) => {
        const n = { ...p };
        delete n[f.id];
        return n;
      });
    }
  }

  // Compute delivery / read status for my own messages
  function receiptStatus(msg: Message): { status: 'sent' | 'delivered' | 'read'; readers: string[] } {
    if (!conv || !me) return { status: 'sent', readers: [] };
    const t = new Date(msg.createdAt).getTime();
    const others = conv.members.filter((m) => m.userId !== me.id);
    const readers = others
      .filter((m) => new Date(m.lastReadAt).getTime() >= t)
      .map((m) => users[m.userId]?.displayName || 'Member');
    if (readers.length > 0) return { status: 'read', readers };
    const delivered = others.some((m) => new Date(m.lastDeliveredAt).getTime() >= t);
    return { status: delivered ? 'delivered' : 'sent', readers: [] };
  }

  if (!conv) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#101114] text-center p-8">
        <img src="/icon.svg" alt="" className="w-16 h-16 mb-4 opacity-70" />
        <h2 className="text-lg font-semibold text-[#F5F5F7]">Select a conversation</h2>
        <p className="text-sm text-[#9296A3] mt-1 max-w-sm">
          Choose a channel, group chat, or direct message from the sidebar to start communicating on your LAN.
        </p>
      </div>
    );
  }

  const allChatMedia = messages.flatMap((m) =>
    m.attachments.filter((a) => a.category === 'IMAGE' || a.category === 'VIDEO'),
  );

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[#101114] relative"
      onDragOver={(e) => {
        e.preventDefault();
        if (canPost) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (canPost && e.dataTransfer.files?.length) queueFiles(e.dataTransfer.files);
      }}
    >
      {/* Drag & drop overlay */}
      {dragging && (
        <div
          onDragLeave={() => setDragging(false)}
          className="absolute inset-0 z-30 bg-[#101114]/90 backdrop-blur-sm border-2 border-dashed border-[#6C8CFF] m-3 rounded-2xl flex flex-col items-center justify-center pointer-events-none"
        >
          <UploadCloud className="w-12 h-12 text-[#6C8CFF] mb-3" />
          <div className="text-base font-semibold text-[#F5F5F7]">Drop files to share in {convTitle}</div>
          <p className="text-xs text-[#9296A3] mt-1">Images, videos, audio, documents &amp; archives supported</p>
        </div>
      )}

      {/* Top Conversation Header */}
      <header className="h-14 px-4 border-b border-white/[0.07] bg-[#181A20]/70 backdrop-blur flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {!leftSidebarOpen && (
            <button
              onClick={() => setLeftSidebar(true)}
              className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] hover:text-[#F5F5F7] cursor-pointer"
              title="Open sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          {conv.type === 'DIRECT' ? (
            <Avatar user={otherDirectUser} size="sm" showStatus />
          ) : (
            <div className="w-8 h-8 rounded-xl bg-[#20232B] border border-white/10 flex items-center justify-center shrink-0">
              {conv.type === 'TEAM' ? (
                <Hash className="w-4 h-4 text-[#6C8CFF]" />
              ) : (
                <Users className="w-4 h-4 text-[#21C7A8]" />
              )}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-[#F5F5F7] truncate">{convTitle}</h1>
            <p className="text-[11px] text-[#9296A3] truncate">
              {activeTypers.length > 0 ? (
                <span className="text-[#21C7A8] font-medium">
                  {activeTypers.join(', ')} {activeTypers.length === 1 ? 'is' : 'are'} typing...
                </span>
              ) : conv.type === 'DIRECT' ? (
                otherDirectUser?.online ? (
                  <span className="text-[#21C7A8]">Online</span>
                ) : (
                  `Last seen ${formatRelative(otherDirectUser?.lastSeenAt)}`
                )
              ) : (
                `${conv.members.length} members · ${
                  conv.members.filter((m) => users[m.userId]?.online).length
                } online${conv.description ? ` · ${conv.description}` : ''}`
              )}
            </p>
          </div>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => startCall(conv.id, false)}
            disabled={!!activeCall}
            title="Start voice call"
            className="p-2 rounded-xl hover:bg-white/[0.06] disabled:opacity-40 text-[#9296A3] hover:text-[#21C7A8] transition cursor-pointer"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => startCall(conv.id, true)}
            disabled={!!activeCall}
            title="Start video call"
            className="p-2 rounded-xl hover:bg-white/[0.06] disabled:opacity-40 text-[#9296A3] hover:text-[#6C8CFF] transition cursor-pointer"
          >
            <Video className="w-4 h-4" />
          </button>
          <button
            onClick={() => setSearchModalOpen(true)}
            title="Search messages (Ctrl+K)"
            className="p-2 rounded-xl hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setRightSidebar(true, 'pins')}
            title="Pinned messages"
            className="p-2 rounded-xl hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer hidden xl:flex"
          >
            <Pin className="w-4 h-4" />
          </button>
          {conv.type !== 'DIRECT' && (
            <button
              onClick={onOpenGroupSettings}
              title="Group info & settings"
              className="p-2 rounded-xl hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setRightSidebar(!rightSidebarOpen)}
            title="Toggle info sidebar"
            className={`p-2 rounded-xl transition cursor-pointer hidden xl:flex ${
              rightSidebarOpen
                ? 'bg-[#6C8CFF]/15 text-[#6C8CFF]'
                : 'hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7]'
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Active call join banner */}
      {conv.activeCall && activeCall?.id !== conv.activeCall.id && (
        <div className="px-4 py-2.5 bg-[#21C7A8]/12 border-b border-[#21C7A8]/25 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 text-xs text-[#F5F5F7]">
            <PhoneCall className="w-4 h-4 text-[#21C7A8] animate-pulse" />
            <span className="font-medium">
              {conv.activeCall.video ? 'Video' : 'Voice'} call in progress ({conv.activeCall.participants.length}{' '}
              {conv.activeCall.participants.length === 1 ? 'person' : 'people'})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => joinExistingCall(conv.activeCall!, false)}
              className="px-3 py-1.5 rounded-lg bg-[#21C7A8] hover:bg-[#27d9b8] text-[#0A1311] text-xs font-semibold cursor-pointer transition"
            >
              Join Audio
            </button>
            {conv.activeCall.video && (
              <button
                onClick={() => joinExistingCall(conv.activeCall!, true)}
                className="px-3 py-1.5 rounded-lg bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-semibold cursor-pointer transition"
              >
                Join Video
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-1">
        {bucket?.hasMore && messages.length > 0 && (
          <div className="text-center pb-3">
            <button
              disabled={bucket.loading}
              onClick={() => loadMessages(conv.id, { before: messages[0].id })}
              className="px-3.5 py-1.5 rounded-full bg-[#181A20] hover:bg-[#20232B] border border-white/10 text-xs text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer"
            >
              {bucket.loading ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.length === 0 && !bucket?.loading && (
          <div className="py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#181A20] border border-white/10 flex items-center justify-center mx-auto mb-3 text-[#6C8CFF]">
              {conv.type === 'TEAM' ? <Hash className="w-6 h-6" /> : <Users className="w-6 h-6" />}
            </div>
            <h3 className="text-base font-semibold text-[#F5F5F7]">Welcome to {convTitle}</h3>
            <p className="text-xs text-[#9296A3] mt-1">
              Start the conversation — send messages, drop files, record voice notes, or start a call.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const prev = messages[idx - 1];
          const showDate =
            !prev || new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
          const sender = msg.senderId ? users[msg.senderId] : null;
          const isMine = msg.senderId === me?.id;
          const isSystem = msg.type === 'SYSTEM' || msg.type === 'CALL';
          const grouped =
            !showDate &&
            !isSystem &&
            prev &&
            prev.type !== 'SYSTEM' &&
            prev.type !== 'CALL' &&
            prev.senderId === msg.senderId &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000 &&
            !msg.replyTo;

          const receipt = isMine ? receiptStatus(msg) : null;

          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={highlightedId === msg.id ? 'msg-highlight rounded-xl' : ''}>
              {showDate && (
                <div className="flex items-center gap-3 my-4 select-none">
                  <div className="flex-1 h-px bg-white/[0.07]" />
                  <span className="text-[11px] font-medium text-[#9296A3] px-2.5 py-0.5 rounded-full bg-[#181A20] border border-white/[0.06]">
                    {formatDateHeading(msg.createdAt)}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.07]" />
                </div>
              )}

              {isSystem ? (
                <div className="flex justify-center my-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181A20] border border-white/[0.06] text-xs text-[#9296A3]">
                    {msg.type === 'CALL' && <PhoneCall className="w-3.5 h-3.5 text-[#21C7A8]" />}
                    <span>{msg.content}</span>
                    {msg.meta?.durationSec > 0 && (
                      <span className="font-mono text-[11px] text-[#21C7A8]">
                        ({formatDuration(msg.meta.durationSec)})
                      </span>
                    )}
                    <span className="text-[10px] opacity-60">{formatTime(msg.createdAt)}</span>
                  </div>
                </div>
              ) : (
                <div
                  className={`group relative flex items-start gap-3 px-2.5 py-1 rounded-xl hover:bg-white/[0.025] transition ${
                    grouped ? 'mt-0' : 'mt-2.5'
                  }`}
                >
                  {/* Avatar / Time gutter */}
                  <div className="w-9 shrink-0 flex justify-center pt-0.5">
                    {!grouped ? (
                      <Avatar user={sender} size="md" />
                    ) : (
                      <span className="text-[10px] text-[#9296A3]/0 group-hover:text-[#9296A3]/70 font-mono mt-1 select-none">
                        {formatTime(msg.createdAt)}
                      </span>
                    )}
                  </div>

                  {/* Message body */}
                  <div className="flex-1 min-w-0">
                    {!grouped && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className={`text-sm font-semibold ${isMine ? 'text-[#6C8CFF]' : 'text-[#F5F5F7]'}`}>
                          {sender?.displayName || 'Deleted User'}
                        </span>
                        <span className="text-[11px] text-[#9296A3]">{formatTime(msg.createdAt)}</span>
                        {msg.forwarded && (
                          <span className="text-[10px] text-[#9296A3] bg-[#20232B] px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                            <Forward className="w-2.5 h-2.5" /> Forwarded
                          </span>
                        )}
                        {msg.pinnedAt && (
                          <span className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </span>
                        )}
                      </div>
                    )}

                    {/* Reply quote */}
                    {msg.replyTo && !msg.deletedAt && (
                      <button
                        onClick={() => {
                          const target = document.getElementById(`msg-${msg.replyTo!.id}`);
                          if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            setHighlightedId(msg.replyTo!.id);
                            setTimeout(() => setHighlightedId(null), 1800);
                          }
                        }}
                        className="mb-1.5 pl-2.5 pr-3 py-1 rounded-lg bg-[#181A20] border-l-2 border-[#6C8CFF] text-left max-w-md block hover:bg-[#20232B] transition cursor-pointer"
                      >
                        <div className="text-[11px] font-medium text-[#6C8CFF]">
                          {(msg.replyTo.senderId && users[msg.replyTo.senderId]?.displayName) || 'Member'}
                        </div>
                        <div className="text-xs text-[#9296A3] truncate">
                          {msg.replyTo.deleted
                            ? 'Deleted message'
                            : msg.replyTo.content ||
                              (msg.replyTo.attachment ? `📎 ${msg.replyTo.attachment.name}` : 'Attachment')}
                        </div>
                      </button>
                    )}

                    {msg.deletedAt ? (
                      <p className="text-xs italic text-[#9296A3]/65">This message was deleted.</p>
                    ) : editing?.id === msg.id ? (
                      <div className="space-y-2 max-w-2xl mt-1">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit();
                            } else if (e.key === 'Escape') {
                              setEditing(null);
                            }
                          }}
                          rows={2}
                          autoFocus
                          className="w-full bg-[#20232B] border border-[#6C8CFF] rounded-xl px-3 py-2 text-sm text-[#F5F5F7] focus:outline-none"
                        />
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 rounded-lg bg-[#6C8CFF] text-white font-medium cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="px-3 py-1 rounded-lg bg-[#20232B] text-[#9296A3] hover:text-white cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.content && (
                          <div className="text-[14px] leading-relaxed text-[#F5F5F7]/95 whitespace-pre-wrap break-words">
                            {msg.content}
                            {msg.editedAt && (
                              <span className="text-[10px] text-[#9296A3] ml-1.5">(edited)</span>
                            )}
                          </div>
                        )}

                        {/* Attachments */}
                        {msg.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {msg.attachments.map((att) => {
                              if (att.deleted || !att.url) {
                                return (
                                  <div
                                    key={att.id}
                                    className="px-3 py-2 rounded-xl bg-[#181A20] border border-white/10 text-xs italic text-[#9296A3]"
                                  >
                                    File removed
                                  </div>
                                );
                              }
                              if (att.category === 'IMAGE') {
                                return (
                                  <button
                                    key={att.id}
                                    onClick={() => openLightbox(att, allChatMedia)}
                                    className="group/img relative rounded-xl overflow-hidden bg-[#181A20] border border-white/10 max-w-[340px] max-h-[280px] cursor-pointer"
                                  >
                                    <img
                                      src={att.thumbUrl || att.url}
                                      alt={att.name}
                                      loading="lazy"
                                      className="max-h-[280px] max-w-[340px] object-cover group-hover/img:brightness-105 transition"
                                    />
                                    <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover/img:opacity-100 px-2 py-0.5 rounded bg-black/75 text-[10px] text-white transition">
                                      {formatBytes(att.size)}
                                    </div>
                                  </button>
                                );
                              }
                              if (att.category === 'VIDEO') {
                                return (
                                  <div
                                    key={att.id}
                                    className="rounded-xl overflow-hidden bg-black border border-white/10 max-w-[380px]"
                                  >
                                    <video
                                      src={att.url}
                                      poster={att.thumbUrl || undefined}
                                      controls
                                      preload="metadata"
                                      className="max-h-[260px] w-full"
                                    />
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#181A20] text-xs">
                                      <button
                                        onClick={() => openLightbox(att, allChatMedia)}
                                        className="flex items-center gap-1.5 text-[#F5F5F7] hover:text-[#6C8CFF] truncate cursor-pointer"
                                      >
                                        <Film className="w-3.5 h-3.5 shrink-0 text-[#6C8CFF]" />
                                        <span className="truncate">{att.name}</span>
                                      </button>
                                      <button
                                        onClick={() => handleFileDownload(att)}
                                        className="ml-2 text-[#9296A3] hover:text-white flex items-center gap-1 shrink-0 cursor-pointer"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        {downloadPct[att.id] ? `${downloadPct[att.id]}%` : formatBytes(att.size)}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              if (att.category === 'AUDIO' || msg.type === 'VOICE') {
                                return (
                                  <VoicePlayer
                                    key={att.id}
                                    src={att.url}
                                    downloadUrl={att.downloadUrl}
                                    filename={att.name}
                                    duration={att.duration}
                                    waveform={att.waveform}
                                  />
                                );
                              }
                              // Document / Archive / Other
                              const Icon = att.category === 'ARCHIVE' ? FileArchive : FileText;
                              const dl = downloadPct[att.id];
                              return (
                                <div
                                  key={att.id}
                                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[#20232B] border border-white/[0.08] hover:border-white/15 max-w-sm transition"
                                >
                                  <button
                                    onClick={() => openLightbox(att, [att])}
                                    className="w-10 h-10 rounded-xl bg-[#6C8CFF]/15 text-[#6C8CFF] flex items-center justify-center shrink-0 cursor-pointer"
                                    title="Preview file"
                                  >
                                    <Icon className="w-5 h-5" />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    <button
                                      onClick={() => openLightbox(att, [att])}
                                      className="text-xs font-medium text-[#F5F5F7] hover:text-[#6C8CFF] truncate block text-left w-full cursor-pointer"
                                    >
                                      {att.name}
                                    </button>
                                    <div className="text-[11px] text-[#9296A3] flex items-center gap-1.5">
                                      <span>{att.ext.toUpperCase()}</span>
                                      <span>·</span>
                                      <span>{formatBytes(att.size)}</span>
                                    </div>
                                    {dl !== undefined && (
                                      <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                                        <div
                                          className="h-full bg-[#21C7A8] transition-all"
                                          style={{ width: `${dl}%` }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => handleFileDownload(att)}
                                    className="p-2 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white transition cursor-pointer"
                                    title="Download"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Reactions + Receipt footer */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {msg.reactions.map((r) => {
                            const mine = !!me && r.userIds.includes(me.id);
                            const names = r.userIds.map((uid) => users[uid]?.displayName || 'Member').join(', ');
                            return (
                              <button
                                key={r.emoji}
                                title={names}
                                onClick={() => toggleReaction(msg, r.emoji)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition cursor-pointer ${
                                  mine
                                    ? 'bg-[#6C8CFF]/20 border-[#6C8CFF]/50 text-[#F5F5F7]'
                                    : 'bg-[#20232B] border-white/[0.08] text-[#9296A3] hover:border-white/20'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className="text-[11px] font-medium">{r.userIds.length}</span>
                              </button>
                            );
                          })}
                          {receipt && (
                            <span
                              title={
                                receipt.status === 'read'
                                  ? `Read by ${receipt.readers.join(', ')}`
                                  : receipt.status === 'delivered'
                                    ? 'Delivered'
                                    : 'Sent'
                              }
                              className="inline-flex items-center ml-1 text-[#9296A3]/70"
                            >
                              {receipt.status === 'sent' ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <CheckCheck
                                  className={`w-3.5 h-3.5 ${
                                    receipt.status === 'read' ? 'text-[#21C7A8]' : 'text-[#9296A3]'
                                  }`}
                                />
                              )}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Floating hover action toolbar */}
                  {!msg.deletedAt && editing?.id !== msg.id && (
                    <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 absolute -top-3 right-3 z-10 flex items-center gap-0.5 p-1 rounded-xl bg-[#181A20] border border-white/10 shadow-xl transition">
                      {QUICK_REACTIONS.slice(0, 3).map((em) => (
                        <button
                          key={em}
                          onClick={() => toggleReaction(msg, em)}
                          className="w-7 h-7 rounded-lg hover:bg-white/10 text-sm flex items-center justify-center cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                      <button
                        onClick={() => setReactPickerFor(reactPickerFor === msg.id ? null : msg.id)}
                        title="More reactions"
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white flex items-center justify-center cursor-pointer"
                      >
                        <Smile className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setReplyTo(msg);
                          textareaRef.current?.focus();
                        }}
                        title="Reply"
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white flex items-center justify-center cursor-pointer"
                      >
                        <CornerUpLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setForwardMessage(msg)}
                        title="Forward"
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white flex items-center justify-center cursor-pointer"
                      >
                        <Forward className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => togglePin(msg)}
                        title={msg.pinnedAt ? 'Unpin' : 'Pin'}
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-amber-300 flex items-center justify-center cursor-pointer"
                      >
                        {msg.pinnedAt ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => copyMessage(msg)}
                        title="Copy"
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white flex items-center justify-center cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {isMine && ['TEXT', 'FILE'].includes(msg.type) && (
                        <button
                          onClick={() => {
                            setEditing(msg);
                            setEditText(msg.content);
                          }}
                          title="Edit"
                          className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white flex items-center justify-center cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(isMine || canManage) && (
                        <button
                          onClick={() => deleteMessage(msg)}
                          title="Delete"
                          className="w-7 h-7 rounded-lg hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Per-message reaction picker */}
                  {reactPickerFor === msg.id && (
                    <div className="absolute top-6 right-3 z-20 p-2 rounded-xl bg-[#20232B] border border-white/10 shadow-2xl grid grid-cols-8 gap-1">
                      {EMOJI_GRID.map((em) => (
                        <button
                          key={em}
                          onClick={() => toggleReaction(msg, em)}
                          className="w-7 h-7 rounded-lg hover:bg-white/10 text-base flex items-center justify-center cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="px-4 md:px-6 pb-4 pt-2 shrink-0">
        {!canPost ? (
          <div className="px-4 py-3 rounded-2xl bg-[#181A20] border border-white/[0.07] text-xs text-[#9296A3] text-center">
            Only administrators can send messages in this conversation.
          </div>
        ) : (
          <div className="space-y-2 relative">
            {/* Reply banner */}
            {replyTo && (
              <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[#181A20] border border-white/[0.08] border-l-2 border-l-[#6C8CFF]">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[#6C8CFF]">
                    Replying to {(replyTo.senderId && users[replyTo.senderId]?.displayName) || 'Member'}
                  </div>
                  <div className="text-xs text-[#9296A3] truncate">
                    {replyTo.content || (replyTo.attachments[0] ? `📎 ${replyTo.attachments[0].name}` : 'Voice message')}
                  </div>
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-[#9296A3] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Staged files upload queue */}
            {staged.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2.5 rounded-xl bg-[#181A20] border border-white/[0.08]">
                {staged.map((s) => (
                  <div
                    key={s.localId}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#20232B] border border-white/10 max-w-[240px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[#F5F5F7] truncate">{s.name}</div>
                      <div className="text-[10px] text-[#9296A3] flex items-center gap-1.5">
                        <span>{formatBytes(s.size)}</span>
                        {s.error ? (
                          <span className="text-rose-400">{s.error}</span>
                        ) : s.file ? (
                          <span className="text-[#21C7A8]">Ready</span>
                        ) : (
                          <span>{s.progress}%</span>
                        )}
                      </div>
                      {!s.file && !s.error && (
                        <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#6C8CFF] transition-all"
                            style={{ width: `${s.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeStaged(s.localId)}
                      className="p-1 rounded hover:bg-white/10 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Emoji picker popover */}
            {emojiOpen && (
              <div className="absolute bottom-16 right-12 z-20 p-3 rounded-2xl bg-[#20232B] border border-white/10 shadow-2xl grid grid-cols-8 gap-1">
                {EMOJI_GRID.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      setText((t) => t + em);
                      textareaRef.current?.focus();
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 text-lg flex items-center justify-center cursor-pointer"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}

            {recording ? (
              <VoiceRecorder
                onSend={sendVoiceMessage}
                onCancel={() => setRecording(false)}
                onError={(m) => toast(m, 'error')}
              />
            ) : (
              <form
                onSubmit={sendMessage}
                className="flex items-end gap-2 bg-[#181A20] border border-white/[0.09] focus-within:border-[#6C8CFF]/60 rounded-2xl px-3 py-2 transition"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) queueFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files"
                  className="p-2 rounded-xl hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={text}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files || []);
                    if (files.length) queueFiles(files);
                  }}
                  placeholder={`Message ${convTitle}...`}
                  className="flex-1 bg-transparent resize-none max-h-36 py-2 text-sm text-[#F5F5F7] placeholder:text-[#9296A3]/60 focus:outline-none leading-snug"
                />

                <button
                  type="button"
                  onClick={() => setEmojiOpen((o) => !o)}
                  title="Emoji"
                  className="p-2 rounded-xl hover:bg-white/[0.06] text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer shrink-0"
                >
                  <Smile className="w-4 h-4" />
                </button>

                {!text.trim() && staged.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setRecording(true)}
                    title="Record voice message"
                    className="p-2 rounded-xl bg-[#20232B] hover:bg-[#6C8CFF] text-[#F5F5F7] transition cursor-pointer shrink-0"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={sending}
                    title="Send message"
                    className="p-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] disabled:opacity-50 text-white transition cursor-pointer shrink-0 shadow-md shadow-[#6C8CFF]/20"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

