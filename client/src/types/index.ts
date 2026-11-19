export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'OWNER' | 'ADMIN' | 'PARTNER' | string;
  bio: string;
  statusText: string;
  avatarUrl: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
}

export interface FileItem {
  id: string;
  name: string;
  ext: string;
  mime: string;
  size: number;
  category: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'ARCHIVE' | 'OTHER' | string;
  scope: 'CHAT' | 'WORKSPACE' | 'AVATAR' | string;
  folder: string;
  description: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform: number[] | null;
  pinned: boolean;
  uploaderId: string | null;
  createdAt: string;
  deleted: boolean;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
}

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

export interface MessageReply {
  id: string;
  senderId: string | null;
  type: string;
  content: string;
  deleted: boolean;
  attachment: FileItem | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: 'TEXT' | 'FILE' | 'VOICE' | 'SYSTEM' | 'CALL' | string;
  content: string;
  meta: Record<string, any>;
  forwarded: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  pinnedById: string | null;
  createdAt: string;
  reactions: ReactionGroup[];
  attachments: FileItem[];
  replyTo: MessageReply | null;
}

export interface ConversationMember {
  userId: string;
  role: 'ADMIN' | 'MEMBER' | string;
  joinedAt: string;
  lastReadAt: string;
  lastDeliveredAt: string;
}

export interface CallParticipantInfo {
  userId: string;
  audio: boolean;
  video: boolean;
  joinedAt: number;
}

export interface CallSummary {
  id: string;
  conversationId: string;
  video: boolean;
  initiatorId: string;
  startedAt: number;
  connectedAt: number | null;
  participants: CallParticipantInfo[];
  invited: string[];
}

export interface Conversation {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'TEAM' | string;
  name: string;
  description: string;
  onlyAdminsCanPost: boolean;
  membersCanInvite: boolean;
  createdById: string | null;
  createdAt: string;
  lastMessageAt: string;
  members: ConversationMember[];
  muted: boolean;
  myRole: string;
  lastMessage: Message | null;
  unreadCount: number;
  activeCall: CallSummary | null;
}

export interface LanAddress {
  address: string;
  iface: string;
  score: number;
  virtual: boolean;
}

export interface SystemInfo {
  version: string;
  workspaceName: string;
  needsSetup: boolean;
  hostname: string;
  lanAddresses: LanAddress[];
  httpPort: number;
  httpsPort: number;
  httpsEnabled: boolean;
  hasCaCert: boolean;
  maxFileSizeMB: number;
  uptimeSeconds: number;
  serverTime: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  color: 'default' | 'indigo' | 'teal' | 'amber' | 'rose' | string;
  pinned: boolean;
  authorId: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | string;
  position: number;
  dueDate: string | null;
  assigneeId: string | null;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TodoItem {
  id: string;
  listId: string;
  text: string;
  done: boolean;
  position: number;
  createdAt: string;
}

export interface TodoList {
  id: string;
  title: string;
  shared: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  items: TodoItem[];
}

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  description: string;
  createdById: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  userId: string | null;
  type: string;
  summary: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export type AppView =
  | 'chat'
  | 'workspace'
  | 'files'
  | 'gallery'
  | 'tasks'
  | 'admin'
  | 'settings';

