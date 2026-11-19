import { create } from 'zustand';
import { api, post } from '../lib/api';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import { playMessageSound, startRingtone, stopRingtone } from '../lib/sound';
import { rtc } from '../lib/webrtc';
import type {
  AppView,
  CallSummary,
  Conversation,
  FileItem,
  Message,
  SystemInfo,
  User,
} from '../types';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface MessagesBucket {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

interface AppState {
  booting: boolean;
  systemInfo: SystemInfo | null;
  me: User | null;
  sessionId: string | null;
  isAdmin: boolean;
  connection: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

  users: Record<string, User>;
  conversations: Record<string, Conversation>;
  messagesByConv: Record<string, MessagesBucket>;
  typingByConv: Record<string, Record<string, number>>; // convId -> userId -> expiresAt

  activeView: AppView;
  activeConversationId: string | null;
  jumpToMessageId: string | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  rightTab: 'members' | 'media' | 'files' | 'pins';

  // Lightbox & modals
  lightboxFile: FileItem | null;
  lightboxList: FileItem[];
  forwardMessage: Message | null;
  searchModalOpen: boolean;

  // Calls
  incomingCall: CallSummary | null;
  activeCall: CallSummary | null;
  callMinimized: boolean;
  localAudio: boolean;
  localVideo: boolean;
  remoteStreams: Record<string, MediaStream>;
  speakingUsers: Record<string, boolean>;

  // Realtime workspace event counter to trigger lightweight refreshes
  workspacePulse: number;
  toasts: Toast[];

  // Actions
  boot: () => Promise<void>;
  refreshSystemInfo: () => Promise<void>;
  onAuthenticated: (user: User, sessionId: string) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;

  setView: (view: AppView) => void;
  selectConversation: (id: string, jumpToMessageId?: string) => void;
  clearJump: () => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean, tab?: AppState['rightTab']) => void;

  openLightbox: (file: FileItem, list?: FileItem[]) => void;
  closeLightbox: () => void;
  setForwardMessage: (msg: Message | null) => void;
  setSearchModalOpen: (open: boolean) => void;

  loadMessages: (conversationId: string, opts?: { before?: string; around?: string }) => Promise<void>;
  markRead: (conversationId: string) => void;
  openDirectChat: (userId: string) => Promise<void>;
  upsertUser: (user: User) => void;
  upsertConversation: (conv: Conversation) => void;

  // Call actions
  startCall: (conversationId: string, video: boolean) => Promise<void>;
  acceptCall: (video: boolean) => Promise<void>;
  joinExistingCall: (call: CallSummary, video: boolean) => Promise<void>;
  declineCall: () => void;
  leaveCall: () => void;
  toggleCallAudio: () => void;
  toggleCallVideo: () => Promise<void>;
  setCallMinimized: (min: boolean) => void;
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  );
}

let socketListenersBound = false;

export const useAppStore = create<AppState>((set, get) => {
  rtc.setListeners(
    (streams) => set({ remoteStreams: streams }),
    (speaking) => set({ speakingUsers: speaking }),
  );

  function bindSocket() {
    const socket = connectSocket();
    if (socketListenersBound) return;
    socketListenersBound = true;

    set({ connection: 'connecting' });

    socket.on('connect', () => {
      set({ connection: 'connected' });
      // Resync conversations & users after reconnect
      if (get().me) {
        syncCoreData().catch(() => {});
      }
    });

    socket.on('disconnect', () => {
      set((s) => ({ connection: s.me ? 'reconnecting' : 'disconnected' }));
    });

    socket.io.on('reconnect_attempt', () => {
      set({ connection: 'reconnecting' });
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') {
        get().logout(false).catch(() => {});
      }
    });

    socket.on('session:revoked', ({ reason }: { reason?: string }) => {
      rtc.cleanup();
      stopRingtone();
      disconnectSocket();
      socketListenersBound = false;
      set({
        me: null,
        sessionId: null,
        isAdmin: false,
        connection: 'disconnected',
        activeCall: null,
        incomingCall: null,
      });
      if (reason === 'account_deactivated') {
        get().toast('Your account was deactivated by an administrator.', 'error');
      } else if (reason === 'logout_all') {
        get().toast('Signed out from all devices.', 'info');
      } else if (reason === 'password_changed' || reason === 'password_reset') {
        get().toast('Your password was updated. Please sign in again.', 'info');
      }
    });

    socket.on('presence:snapshot', ({ onlineUserIds }: { onlineUserIds: string[] }) => {
      const onlineSet = new Set(onlineUserIds);
      set((s) => {
        const users = { ...s.users };
        for (const id of Object.keys(users)) {
          users[id] = { ...users[id], online: users[id].isActive && onlineSet.has(id) };
        }
        return { users };
      });
    });

    socket.on('presence:update', ({ userId, online, lastSeenAt }: { userId: string; online: boolean; lastSeenAt: string | null }) => {
      set((s) => {
        const u = s.users[userId];
        if (!u) return s;
        return {
          users: {
            ...s.users,
            [userId]: { ...u, online, lastSeenAt: lastSeenAt ?? u.lastSeenAt },
          },
        };
      });
    });

    socket.on('user:upsert', (user: User) => {
      set((s) => ({
        users: { ...s.users, [user.id]: user },
        me: s.me?.id === user.id ? user : s.me,
        isAdmin: s.me?.id === user.id ? user.role === 'OWNER' || user.role === 'ADMIN' : s.isAdmin,
      }));
    });

    socket.on('user:removed', ({ id }: { id: string }) => {
      set((s) => {
        const users = { ...s.users };
        delete users[id];
        return { users };
      });
    });

    socket.on('workspace:renamed', ({ workspaceName }: { workspaceName: string }) => {
      set((s) => ({
        systemInfo: s.systemInfo ? { ...s.systemInfo, workspaceName } : s.systemInfo,
      }));
    });

    socket.on('conversation:upsert', (conv: Conversation) => {
      set((s) => ({
        conversations: { ...s.conversations, [conv.id]: conv },
      }));
    });

    socket.on('conversation:removed', ({ id }: { id: string }) => {
      set((s) => {
        const conversations = { ...s.conversations };
        delete conversations[id];
        const nextActive =
          s.activeConversationId === id ? Object.keys(conversations)[0] ?? null : s.activeConversationId;
        return { conversations, activeConversationId: nextActive };
      });
    });

    socket.on('message:new', (msg: Message) => {
      const state = get();
      const meId = state.me?.id;
      const isViewing =
        state.activeView === 'chat' &&
        state.activeConversationId === msg.conversationId &&
        document.visibilityState === 'visible';

      set((s) => {
        const bucket = s.messagesByConv[msg.conversationId] || {
          items: [],
          hasMore: true,
          loading: false,
          loaded: false,
        };
        const conv = s.conversations[msg.conversationId];
        const nextConvs = { ...s.conversations };
        if (conv) {
          const incrementUnread = msg.senderId !== meId && msg.type !== 'SYSTEM' && !isViewing;
          nextConvs[msg.conversationId] = {
            ...conv,
            lastMessage: msg,
            lastMessageAt: msg.createdAt,
            unreadCount: isViewing ? 0 : conv.unreadCount + (incrementUnread ? 1 : 0),
          };
        }
        // Clear typing indicator for sender
        const typingForConv = { ...(s.typingByConv[msg.conversationId] || {}) };
        if (msg.senderId) delete typingForConv[msg.senderId];

        return {
          messagesByConv: {
            ...s.messagesByConv,
            [msg.conversationId]: { ...bucket, items: mergeMessages(bucket.items, [msg]) },
          },
          conversations: nextConvs,
          typingByConv: { ...s.typingByConv, [msg.conversationId]: typingForConv },
        };
      });

      if (msg.senderId && msg.senderId !== meId) {
        if (isViewing) {
          socket.emit('conversation:read', { conversationId: msg.conversationId });
        } else {
          socket.emit('conversation:delivered', { conversationId: msg.conversationId });
          const conv = get().conversations[msg.conversationId];
          if (!conv?.muted && msg.type !== 'SYSTEM') {
            playMessageSound();
          }
        }
      }
    });

    socket.on('message:updated', (msg: Message) => {
      set((s) => {
        const bucket = s.messagesByConv[msg.conversationId];
        const nextBuckets = bucket
          ? {
              ...s.messagesByConv,
              [msg.conversationId]: {
                ...bucket,
                items: bucket.items.map((m) => (m.id === msg.id ? msg : m)),
              },
            }
          : s.messagesByConv;
        const conv = s.conversations[msg.conversationId];
        const nextConvs =
          conv && conv.lastMessage?.id === msg.id
            ? { ...s.conversations, [conv.id]: { ...conv, lastMessage: msg } }
            : s.conversations;
        return { messagesByConv: nextBuckets, conversations: nextConvs };
      });
    });

    socket.on('conversation:read', ({ conversationId, userId, at }: { conversationId: string; userId: string; at: string }) => {
      set((s) => {
        const conv = s.conversations[conversationId];
        if (!conv) return s;
        return {
          conversations: {
            ...s.conversations,
            [conversationId]: {
              ...conv,
              unreadCount: userId === s.me?.id ? 0 : conv.unreadCount,
              members: conv.members.map((m) =>
                m.userId === userId ? { ...m, lastReadAt: at, lastDeliveredAt: at } : m,
              ),
            },
          },
        };
      });
    });

    socket.on('conversation:delivered', ({ conversationId, userId, at }: { conversationId: string; userId: string; at: string }) => {
      set((s) => {
        const conv = s.conversations[conversationId];
        if (!conv) return s;
        return {
          conversations: {
            ...s.conversations,
            [conversationId]: {
              ...conv,
              members: conv.members.map((m) =>
                m.userId === userId ? { ...m, lastDeliveredAt: at } : m,
              ),
            },
          },
        };
      });
    });

    socket.on('typing:update', ({ conversationId, userId, typing }: { conversationId: string; userId: string; typing: boolean }) => {
      set((s) => {
        const cur = { ...(s.typingByConv[conversationId] || {}) };
        if (typing) cur[userId] = Date.now() + 5000;
        else delete cur[userId];
        return { typingByConv: { ...s.typingByConv, [conversationId]: cur } };
      });
    });

    // ---- Call events ----
    socket.on('call:incoming', ({ call }: { call: CallSummary }) => {
      const state = get();
      if (state.activeCall) return;
      startRingtone();
      set({ incomingCall: call });
    });

    socket.on('call:dismissed', ({ callId }: { callId: string }) => {
      if (get().incomingCall?.id === callId) {
        stopRingtone();
        set({ incomingCall: null });
      }
    });

    socket.on('call:state', ({ conversationId, call }: { conversationId: string; call: CallSummary | null }) => {
      set((s) => {
        const conv = s.conversations[conversationId];
        const conversations = conv
          ? { ...s.conversations, [conversationId]: { ...conv, activeCall: call } }
          : s.conversations;
        const activeCall = s.activeCall?.id === call?.id ? call : s.activeCall;
        const incomingCall = s.incomingCall?.id === call?.id ? call : s.incomingCall;
        return { conversations, activeCall, incomingCall };
      });
    });

    socket.on('call:ended', ({ callId, conversationId, reason }: { callId: string; conversationId: string; reason: string }) => {
      const s = get();
      if (s.activeCall?.id === callId) {
        rtc.cleanup();
        set({ activeCall: null, callMinimized: false, remoteStreams: {}, speakingUsers: {} });
        if (reason === 'declined') s.toast('Call was declined.', 'info');
        else if (reason === 'missed') s.toast('No answer.', 'info');
      }
      if (s.incomingCall?.id === callId) {
        stopRingtone();
        set({ incomingCall: null });
      }
      set((st) => {
        const conv = st.conversations[conversationId];
        if (!conv) return st;
        return { conversations: { ...st.conversations, [conversationId]: { ...conv, activeCall: null } } };
      });
    });

    socket.on('call:participant-left', ({ callId, userId }: { callId: string; userId: string }) => {
      if (get().activeCall?.id === callId) {
        rtc.removePeer(userId);
      }
    });

    socket.on('call:signal', ({ callId, fromUserId, payload }: { callId: string; fromUserId: string; payload: any }) => {
      rtc.handleSignal(callId, fromUserId, payload).catch(() => {});
    });

    // ---- Workspace real-time updates ----
    for (const ev of [
      'workspace:announcement',
      'workspace:note',
      'workspace:task',
      'workspace:todo',
      'workspace:link',
      'workspace:file-added',
      'workspace:file-updated',
      'workspace:file-deleted',
      'activity:new',
    ]) {
      socket.on(ev, () => set((s) => ({ workspacePulse: s.workspacePulse + 1 })));
    }

    socket.on('system:reloaded', () => {
      get().toast('Workspace was restored from backup. Refreshing...', 'info');
      setTimeout(() => window.location.reload(), 1200);
    });
  }

  async function syncCoreData() {
    const [{ users }, { conversations }] = await Promise.all([
      api<{ users: User[] }>('/users'),
      api<{ conversations: Conversation[] }>('/conversations'),
    ]);
    const userMap: Record<string, User> = {};
    for (const u of users) userMap[u.id] = u;
    const convMap: Record<string, Conversation> = {};
    for (const c of conversations) convMap[c.id] = c;

    set((s) => {
      let activeId = s.activeConversationId;
      if (!activeId || !convMap[activeId]) {
        const team = conversations.find((c) => c.type === 'TEAM');
        activeId = team?.id ?? conversations[0]?.id ?? null;
      }
      return { users: userMap, conversations: convMap, activeConversationId: activeId };
    });

    const activeId = get().activeConversationId;
    if (activeId) {
      await get().loadMessages(activeId);
    }
  }

  return {
    booting: true,
    systemInfo: null,
    me: null,
    sessionId: null,
    isAdmin: false,
    connection: 'disconnected',

    users: {},
    conversations: {},
    messagesByConv: {},
    typingByConv: {},

    activeView: 'chat',
    activeConversationId: null,
    jumpToMessageId: null,
    leftSidebarOpen: true,
    rightSidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1200 : true,
    rightTab: 'members',

    lightboxFile: null,
    lightboxList: [],
    forwardMessage: null,
    searchModalOpen: false,

    incomingCall: null,
    activeCall: null,
    callMinimized: false,
    localAudio: true,
    localVideo: false,
    remoteStreams: {},
    speakingUsers: {},

    workspacePulse: 0,
    toasts: [],

    toast(message, tone = 'info') {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, tone }] }));
      setTimeout(() => get().dismissToast(id), 4200);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    async refreshSystemInfo() {
      const info = await api<SystemInfo>('/system/info');
      set({ systemInfo: info });
    },

    async boot() {
      set({ booting: true });
      try {
        const info = await api<SystemInfo>('/system/info');
        set({ systemInfo: info });
        if (!info.needsSetup) {
          try {
            const auth = await api<{ user: User; sessionId: string; isAdmin: boolean }>('/auth/me');
            await get().onAuthenticated(auth.user, auth.sessionId);
          } catch {
            // Not signed in
          }
        }
      } catch {
        // Server unreachable
      } finally {
        set({ booting: false });
      }
    },

    async onAuthenticated(user, sessionId) {
      set({
        me: user,
        sessionId,
        isAdmin: user.role === 'OWNER' || user.role === 'ADMIN',
      });
      await get().refreshSystemInfo().catch(() => {});
      await syncCoreData();
      bindSocket();
    },

    async logout(allDevices = false) {
      try {
        await post(allDevices ? '/auth/logout-all' : '/auth/logout');
      } catch {
        /* ignore */
      }
      rtc.cleanup();
      stopRingtone();
      disconnectSocket();
      socketListenersBound = false;
      set({
        me: null,
        sessionId: null,
        isAdmin: false,
        connection: 'disconnected',
        conversations: {},
        messagesByConv: {},
        users: {},
        activeConversationId: null,
        activeCall: null,
        incomingCall: null,
        activeView: 'chat',
      });
    },

    setView(view) {
      set({ activeView: view });
    },

    selectConversation(id, jumpToMessageId) {
      set({
        activeView: 'chat',
        activeConversationId: id,
        jumpToMessageId: jumpToMessageId ?? null,
      });
      if (jumpToMessageId) {
        get().loadMessages(id, { around: jumpToMessageId }).catch(() => {});
      } else {
        const bucket = get().messagesByConv[id];
        if (!bucket?.loaded) get().loadMessages(id).catch(() => {});
      }
      get().markRead(id);
    },

    clearJump() {
      set({ jumpToMessageId: null });
    },

    setLeftSidebar(open) {
      set({ leftSidebarOpen: open });
    },

    setRightSidebar(open, tab) {
      set((s) => ({ rightSidebarOpen: open, rightTab: tab ?? s.rightTab }));
    },

    openLightbox(file, list) {
      set({ lightboxFile: file, lightboxList: list && list.length ? list : [file] });
    },

    closeLightbox() {
      set({ lightboxFile: null, lightboxList: [] });
    },

    setForwardMessage(msg) {
      set({ forwardMessage: msg });
    },

    setSearchModalOpen(open) {
      set({ searchModalOpen: open });
    },

    async loadMessages(conversationId, opts = {}) {
      set((s) => {
        const cur = s.messagesByConv[conversationId] || { items: [], hasMore: true, loading: false, loaded: false };
        return {
          messagesByConv: { ...s.messagesByConv, [conversationId]: { ...cur, loading: true } },
        };
      });
      try {
        const qs = new URLSearchParams({ limit: '45' });
        if (opts.before) qs.set('before', opts.before);
        if (opts.around) qs.set('around', opts.around);
        const data = await api<{ messages: Message[]; hasMore: boolean }>(
          `/conversations/${conversationId}/messages?${qs}`,
        );
        set((s) => {
          const cur = s.messagesByConv[conversationId] || { items: [], hasMore: true, loading: false, loaded: false };
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [conversationId]: {
                items: mergeMessages(cur.items, data.messages),
                hasMore: opts.around ? true : data.hasMore,
                loading: false,
                loaded: true,
              },
            },
          };
        });
      } catch {
        set((s) => {
          const cur = s.messagesByConv[conversationId];
          if (!cur) return s;
          return { messagesByConv: { ...s.messagesByConv, [conversationId]: { ...cur, loading: false } } };
        });
      }
    },

    markRead(conversationId) {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('conversation:read', { conversationId });
      } else {
        post(`/conversations/${conversationId}/read`).catch(() => {});
      }
      set((s) => {
        const conv = s.conversations[conversationId];
        if (!conv || conv.unreadCount === 0) return s;
        return { conversations: { ...s.conversations, [conversationId]: { ...conv, unreadCount: 0 } } };
      });
    },

    async openDirectChat(userId) {
      const { conversation } = await post<{ conversation: Conversation }>('/conversations/direct', { userId });
      set((s) => ({
        conversations: { ...s.conversations, [conversation.id]: conversation },
      }));
      get().selectConversation(conversation.id);
    },

    upsertUser(user) {
      set((s) => ({
        users: { ...s.users, [user.id]: user },
        me: s.me?.id === user.id ? user : s.me,
      }));
    },

    upsertConversation(conv) {
      set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
    },

    // ---- Call Actions ----
    async startCall(conversationId, video) {
      const check = rtc.isMediaSupported();
      if (!check.ok) {
        get().toast(check.reason || 'Media capture unavailable.', 'error');
        return;
      }
      const socket = getSocket();
      const me = get().me;
      if (!socket?.connected || !me) {
        get().toast('Not connected to server.', 'error');
        return;
      }
      try {
        await rtc.acquireMedia(video);
      } catch (err: any) {
        get().toast(err.message, 'error');
        return;
      }
      const res = await new Promise<{ ok: boolean; call?: any; error?: string }>((resolve) =>
        socket.emit('call:start', { conversationId, video }, resolve),
      );
      if (!res.ok || !res.call) {
        rtc.cleanup();
        get().toast(res.error || 'Could not start call.', 'error');
        return;
      }
      const peersToOffer: string[] = res.call.peersToOffer || [];
      await rtc.begin(res.call.id, me.id, video, peersToOffer);
      const hasVideoTrack = (rtc.getLocalStream()?.getVideoTracks().length ?? 0) > 0;
      set({
        activeCall: res.call,
        callMinimized: false,
        localAudio: true,
        localVideo: hasVideoTrack,
      });
    },

    async acceptCall(video) {
      const incoming = get().incomingCall;
      if (!incoming) return;
      stopRingtone();
      set({ incomingCall: null });
      await get().joinExistingCall(incoming, video);
    },

    async joinExistingCall(call, video) {
      const check = rtc.isMediaSupported();
      if (!check.ok) {
        get().toast(check.reason || 'Media capture unavailable.', 'error');
        return;
      }
      const socket = getSocket();
      const me = get().me;
      if (!socket?.connected || !me) return;
      try {
        await rtc.acquireMedia(video);
      } catch (err: any) {
        get().toast(err.message, 'error');
        return;
      }
      const hasVideoTrack = (rtc.getLocalStream()?.getVideoTracks().length ?? 0) > 0;
      const res = await new Promise<{ ok: boolean; call?: any; error?: string }>((resolve) =>
        socket.emit('call:join', { callId: call.id, audio: true, video: hasVideoTrack }, resolve),
      );
      if (!res.ok || !res.call) {
        rtc.cleanup();
        get().toast(res.error || 'Could not join call.', 'error');
        return;
      }
      await rtc.begin(res.call.id, me.id, hasVideoTrack, res.call.peersToOffer || []);
      set({
        activeCall: res.call,
        callMinimized: false,
        localAudio: true,
        localVideo: hasVideoTrack,
      });
    },

    declineCall() {
      const incoming = get().incomingCall;
      stopRingtone();
      if (incoming) {
        getSocket()?.emit('call:decline', { callId: incoming.id });
      }
      set({ incomingCall: null });
    },

    leaveCall() {
      const call = get().activeCall;
      if (call) {
        getSocket()?.emit('call:leave', { callId: call.id });
      }
      rtc.cleanup();
      set({
        activeCall: null,
        callMinimized: false,
        remoteStreams: {},
        speakingUsers: {},
        localAudio: true,
        localVideo: false,
      });
    },

    toggleCallAudio() {
      const enabled = rtc.toggleAudio();
      set({ localAudio: enabled });
    },

    async toggleCallVideo() {
      try {
        const enabled = await rtc.toggleVideo();
        set({ localVideo: enabled });
      } catch (err: any) {
        get().toast(err?.message || 'Camera is not available.', 'error');
      }
    },

    setCallMinimized(min) {
      set({ callMinimized: min });
    },
  };
});

