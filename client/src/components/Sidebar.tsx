import {
  CheckSquare,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  LayoutGrid,
  LogOut,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { AppView, Conversation } from '../types';
import { Avatar } from './Avatar';

interface SidebarProps {
  onNewDm: () => void;
  onNewGroup: () => void;
}

export function Sidebar({ onNewDm, onNewGroup }: SidebarProps) {
  const {
    me,
    isAdmin,
    systemInfo,
    connection,
    users,
    conversations,
    activeView,
    activeConversationId,
    leftSidebarOpen,
    setView,
    selectConversation,
    setLeftSidebar,
    setSearchModalOpen,
    logout,
  } = useAppStore();

  const convList = Object.values(conversations).sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );
  const teamConv = convList.find((c) => c.type === 'TEAM');
  const groups = convList.filter((c) => c.type === 'GROUP');
  const directs = convList.filter((c) => c.type === 'DIRECT');

  const onlineCount = Object.values(users).filter((u) => u.online && u.isActive).length;

  function otherUserOf(conv: Conversation) {
    const member = conv.members.find((m) => m.userId !== me?.id);
    return member ? users[member.userId] : null;
  }

  function navTo(view: AppView) {
    setView(view);
    if (window.innerWidth < 1024) setLeftSidebar(false);
  }

  function openConv(id: string) {
    selectConversation(id);
    if (window.innerWidth < 1024) setLeftSidebar(false);
  }

  const navItems: Array<{ id: AppView; label: string; icon: any; adminOnly?: boolean }> = [
    { id: 'workspace', label: 'Workspace', icon: LayoutGrid },
    { id: 'files', label: 'Shared Files', icon: FolderOpen },
    { id: 'gallery', label: 'Media Gallery', icon: ImageIcon },
    { id: 'tasks', label: 'Tasks & To-Dos', icon: CheckSquare },
    { id: 'admin', label: 'Admin Dashboard', icon: Shield, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const statusDot =
    connection === 'connected'
      ? 'bg-[#21C7A8]'
      : connection === 'reconnecting' || connection === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-rose-500';

  if (!leftSidebarOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={() => setLeftSidebar(false)}
        className="fixed inset-0 bg-black/60 z-30 lg:hidden"
      />
      <aside className="fixed lg:static inset-y-0 left-0 z-40 w-[268px] shrink-0 bg-[#181A20] border-r border-white/[0.07] flex flex-col select-none">
        {/* Workspace Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon.svg" alt="LOCAL HUB" className="w-7 h-7 rounded-lg shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-[#F5F5F7] truncate">
                {systemInfo?.workspaceName || 'LOCAL HUB'}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#9296A3]">
                <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                <span className="truncate">
                  {connection === 'connected' ? `${onlineCount} online · LAN` : 'Reconnecting...'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setLeftSidebar(false)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#9296A3] hover:text-[#F5F5F7] lg:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Search Button */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={() => setSearchModalOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#101114] hover:bg-[#14161B] border border-white/[0.07] text-xs text-[#9296A3] transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5" /> Search messages...
            </span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[#20232B] text-[#9296A3] font-mono">Ctrl K</kbd>
          </button>
        </div>

        {/* Scrollable Sections */}
        <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-5">
          {/* Channels / Team */}
          <div>
            <div className="px-2 mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9296A3]/80">Channels</span>
            </div>
            {teamConv && (
              <button
                onClick={() => openConv(teamConv.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm transition cursor-pointer ${
                  activeView === 'chat' && activeConversationId === teamConv.id
                    ? 'bg-[#6C8CFF]/18 text-[#F5F5F7] font-medium'
                    : 'text-[#9296A3] hover:bg-white/[0.04] hover:text-[#F5F5F7]'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Hash className="w-4 h-4 text-[#6C8CFF] shrink-0" />
                  <span className="truncate">{teamConv.name || 'Team'}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {teamConv.activeCall && (
                    <span className="p-1 rounded-full bg-[#21C7A8]/20 text-[#21C7A8]">
                      <PhoneCall className="w-3 h-3 animate-pulse" />
                    </span>
                  )}
                  {teamConv.unreadCount > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#6C8CFF] text-white text-[11px] font-semibold flex items-center justify-center">
                      {teamConv.unreadCount}
                    </span>
                  )}
                </span>
              </button>
            )}
          </div>

          {/* Group Chats */}
          <div>
            <div className="px-2 mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9296A3]/80">Group Chats</span>
              <button
                onClick={onNewGroup}
                title="Create group chat"
                className="p-1 rounded-md hover:bg-white/10 text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {groups.length === 0 ? (
                <button
                  onClick={onNewGroup}
                  className="w-full px-2.5 py-2 rounded-xl text-xs text-[#9296A3]/70 hover:text-[#F5F5F7] hover:bg-white/[0.04] text-left transition cursor-pointer"
                >
                  + New group conversation
                </button>
              ) : (
                groups.map((g) => {
                  const active = activeView === 'chat' && activeConversationId === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => openConv(g.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm transition cursor-pointer ${
                        active
                          ? 'bg-[#6C8CFF]/18 text-[#F5F5F7] font-medium'
                          : 'text-[#9296A3] hover:bg-white/[0.04] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <span className="w-6 h-6 rounded-lg bg-[#20232B] border border-white/10 flex items-center justify-center shrink-0">
                          <Users className="w-3.5 h-3.5 text-[#21C7A8]" />
                        </span>
                        <span className="truncate">{g.name}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {g.activeCall && (
                          <span className="p-1 rounded-full bg-[#21C7A8]/20 text-[#21C7A8]">
                            <PhoneCall className="w-3 h-3 animate-pulse" />
                          </span>
                        )}
                        {g.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#6C8CFF] text-white text-[11px] font-semibold flex items-center justify-center">
                            {g.unreadCount}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Direct Messages */}
          <div>
            <div className="px-2 mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9296A3]/80">Direct Messages</span>
              <button
                onClick={onNewDm}
                title="Start direct message"
                className="p-1 rounded-md hover:bg-white/10 text-[#9296A3] hover:text-[#F5F5F7] transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {directs.length === 0 ? (
                <button
                  onClick={onNewDm}
                  className="w-full px-2.5 py-2 rounded-xl text-xs text-[#9296A3]/70 hover:text-[#F5F5F7] hover:bg-white/[0.04] text-left transition cursor-pointer"
                >
                  + Message a team member
                </button>
              ) : (
                directs.map((d) => {
                  const other = otherUserOf(d);
                  const active = activeView === 'chat' && activeConversationId === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => openConv(d.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm transition cursor-pointer ${
                        active
                          ? 'bg-[#6C8CFF]/18 text-[#F5F5F7] font-medium'
                          : 'text-[#9296A3] hover:bg-white/[0.04] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Avatar user={other} size="xs" showStatus />
                        <span className="truncate">{other?.displayName || 'User'}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {d.activeCall && (
                          <span className="p-1 rounded-full bg-[#21C7A8]/20 text-[#21C7A8]">
                            <PhoneCall className="w-3 h-3 animate-pulse" />
                          </span>
                        )}
                        {d.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#6C8CFF] text-white text-[11px] font-semibold flex items-center justify-center">
                            {d.unreadCount}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Workspace Navigation */}
          <div>
            <div className="px-2 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9296A3]/80">Workspace</span>
            </div>
            <div className="space-y-0.5">
              {navItems
                .filter((i) => !i.adminOnly || isAdmin)
                .map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => navTo(item.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition cursor-pointer ${
                        active
                          ? 'bg-[#6C8CFF]/18 text-[#F5F5F7] font-medium'
                          : 'text-[#9296A3] hover:bg-white/[0.04] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#6C8CFF]' : ''}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        {/* User Footer Profile */}
        {me && (
          <div className="p-3 border-t border-white/[0.07] bg-[#14161B] flex items-center justify-between gap-2 shrink-0">
            <button
              onClick={() => navTo('settings')}
              className="flex items-center gap-2.5 min-w-0 text-left flex-1 rounded-xl p-1 -m-1 hover:bg-white/[0.04] transition cursor-pointer"
            >
              <Avatar user={{ ...me, online: connection === 'connected' }} size="sm" showStatus />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#F5F5F7] truncate">{me.displayName}</div>
                <div className="text-[11px] text-[#9296A3] truncate">
                  {me.statusText || `@${me.username}`}
                </div>
              </div>
            </button>
            <button
              onClick={() => logout(false)}
              title="Sign out"
              className="p-2 rounded-lg hover:bg-rose-500/15 text-[#9296A3] hover:text-rose-400 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

