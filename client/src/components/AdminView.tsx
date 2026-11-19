import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  HardDrive,
  KeyRound,
  Menu,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Server,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { formatBytes, formatRelative, formatUptime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Avatar } from './Avatar';

type AdminTab = 'overview' | 'users' | 'groups' | 'storage' | 'backups' | 'settings' | 'logs';

export function AdminView() {
  const { me, leftSidebarOpen, setLeftSidebar, toast } = useAppStore();
  const isOwner = me?.role === 'OWNER';
  const [tab, setTab] = useState<AdminTab>('overview');

  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [consistency, setConsistency] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [serverLogs, setServerLogs] = useState<{ dates: string[]; lines: string[] }>({ dates: [], lines: [] });
  const [logDate, setLogDate] = useState('');

  // Forms
  const [invNote, setInvNote] = useState('');
  const [invRole, setInvRole] = useState<'PARTNER' | 'ADMIN'>('PARTNER');
  const [invHours, setInvHours] = useState(72);

  const [newUser, setNewUser] = useState({ username: '', displayName: '', password: '', role: 'PARTNER' });
  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null);
  const [resetPw, setResetPw] = useState('');

  const [settingsForm, setSettingsForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function loadTab(current: AdminTab) {
    try {
      if (current === 'overview') {
        setOverview(await api('/admin/overview'));
      } else if (current === 'users') {
        const [u, inv, ses] = await Promise.all([
          api<{ users: any[] }>('/admin/users'),
          api<{ invitations: any[] }>('/admin/invitations'),
          api<{ sessions: any[] }>('/admin/sessions'),
        ]);
        setUsers(u.users);
        setInvites(inv.invitations);
        setSessions(ses.sessions);
      } else if (current === 'groups') {
        const g = await api<{ conversations: any[] }>('/admin/conversations');
        setGroups(g.conversations);
      } else if (current === 'storage') {
        const [ov, fl] = await Promise.all([api('/admin/overview'), api<{ files: any[] }>('/admin/files?limit=120')]);
        setOverview(ov);
        setFiles(fl.files);
      } else if (current === 'backups') {
        const b = await api<{ backups: any[] }>('/admin/backups');
        setBackups(b.backups);
      } else if (current === 'settings') {
        const s = await api<any>('/admin/settings');
        setSettingsForm({
          workspaceName: s.runtime.workspaceName,
          maxFileSizeMB: s.runtime.maxFileSizeMB,
          allowedExtensions: s.runtime.allowedExtensions.join(', '),
          maxUsers: s.runtime.maxUsers,
          port: s.serverConfig.port,
          httpsPort: s.serverConfig.httpsPort,
          enableHttps: s.serverConfig.enableHttps,
          storageDir: s.serverConfig.storageDir,
          sessionDays: s.serverConfig.sessionDays,
        });
      } else if (current === 'logs') {
        const [aud, lg] = await Promise.all([
          api<{ logs: any[] }>('/admin/audit?limit=150'),
          api<{ dates: string[]; lines: string[] }>(`/admin/logs?lines=250${logDate ? `&date=${logDate}` : ''}`),
        ]);
        setAuditLogs(aud.logs);
        setServerLogs(lg);
      }
    } catch (err: any) {
      toast(err.message || 'Failed to load admin data.', 'error');
    }
  }

  useEffect(() => {
    loadTab(tab);
  }, [tab, logDate]);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { invitation } = await post<{ invitation: any }>('/admin/invitations', {
        role: invRole,
        note: invNote,
        expiresInHours: invHours,
      });
      setInvNote('');
      navigator.clipboard?.writeText(invitation.code).catch(() => {});
      toast(`Invitation ${invitation.code} created & copied!`, 'success');
      loadTab('users');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function createUserDirect(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post('/admin/users', newUser);
      setNewUser({ username: '', displayName: '', password: '', role: 'PARTNER' });
      toast('User account created.', 'success');
      loadTab('users');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function submitResetPw(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      await post(`/admin/users/${resetTarget.id}/reset-password`, { newPassword: resetPw });
      toast(`Password reset for @${resetTarget.username}. All their sessions were signed out.`, 'success');
      setResetTarget(null);
      setResetPw('');
      loadTab('users');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function runBackup(includeFiles: boolean) {
    setBusy(true);
    try {
      const { backup } = await post<{ backup: any }>('/admin/backups', { includeFiles });
      toast(`Backup "${backup.name}" created (${formatBytes(backup.totalSize)}).`, 'success');
      loadTab('backups');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(name: string) {
    if (!confirm(`Restore backup "${name}"?\n\nA safety snapshot of the current database will be created first.`)) return;
    setBusy(true);
    try {
      await post(`/admin/backups/${encodeURIComponent(name)}/restore`);
      toast('Backup restored successfully!', 'success');
      loadTab('backups');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsForm) return;
    setBusy(true);
    try {
      const exts = String(settingsForm.allowedExtensions)
        .split(/[\s,]+/)
        .map((x) => x.replace(/^\./, '').toLowerCase())
        .filter(Boolean);
      const res = await patch<{ restartRequired: boolean }>('/admin/settings', {
        workspaceName: settingsForm.workspaceName,
        maxFileSizeMB: Number(settingsForm.maxFileSizeMB),
        allowedExtensions: exts,
        maxUsers: Number(settingsForm.maxUsers),
        port: Number(settingsForm.port),
        httpsPort: Number(settingsForm.httpsPort),
        enableHttps: Boolean(settingsForm.enableHttps),
        storageDir: settingsForm.storageDir,
        sessionDays: Number(settingsForm.sessionDays),
      });
      toast(
        res.restartRequired
          ? 'Settings saved. Restart the server to apply port or storage path changes.'
          : 'Settings saved.',
        'success',
      );
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: Server },
    { id: 'users', label: 'Users & Invites', icon: Users },
    { id: 'groups', label: 'Groups', icon: Shield },
    { id: 'storage', label: 'Storage & Files', icon: HardDrive },
    { id: 'backups', label: 'Backups', icon: Database },
    { id: 'settings', label: 'Server Config', icon: Settings },
    { id: 'logs', label: 'Logs & Audit', icon: ScrollText },
  ];

  const primaryIp = overview?.server?.lanAddresses?.[0]?.address || '127.0.0.1';
  const disk = overview?.storage?.disk;
  const diskUsedPct = disk ? Math.min(100, Math.round(((disk.total - disk.free) / disk.total) * 100)) : 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#101114]">
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!leftSidebarOpen && (
            <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <Shield className="w-5 h-5 text-[#6C8CFF]" />
          <h1 className="text-sm font-semibold">Admin Dashboard</h1>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
                  tab === t.id ? 'bg-[#6C8CFF]/20 text-[#6C8CFF]' : 'text-[#9296A3] hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 max-w-6xl w-full mx-auto space-y-5">
        {tab === 'overview' && overview && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Registered Users" value={`${overview.users.active} / ${overview.users.maxUsers}`} sub={`${overview.users.online} online now`} accent="text-[#21C7A8]" />
              <StatCard label="Total Messages" value={String(overview.messages.total)} sub="Persisted in SQLite" />
              <StatCard label="Uploaded Files" value={String(overview.files.total)} sub={`${formatBytes(overview.storage.totalBytes)} used`} accent="text-[#6C8CFF]" />
              <StatCard label="Server Uptime" value={formatUptime(overview.server.uptimeSeconds)} sub={`${overview.sessions.active} sessions · ${overview.server.memoryMB} MB RAM`} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LAN Access Panel */}
              <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Host LAN Network Addresses</h2>
                  <span className="px-2 py-0.5 rounded-full bg-[#21C7A8]/15 text-[#21C7A8] text-[10px] font-semibold">
                    ONLINE · 0.0.0.0
                  </span>
                </div>
                <p className="text-xs text-[#9296A3]">
                  Share either address below with your team on the same Wi-Fi/LAN. Use HTTPS for voice messages and calls.
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'LAN HTTP', url: `http://${primaryIp}:${overview.server.httpPort}` },
                    ...(overview.server.httpsEnabled
                      ? [{ label: 'LAN HTTPS (Voice/Video)', url: `https://${primaryIp}:${overview.server.httpsPort}` }]
                      : []),
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#20232B] border border-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] text-[#9296A3] uppercase">{item.label}</div>
                        <div className="text-xs font-mono text-[#F5F5F7] truncate">{item.url}</div>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(item.url);
                          toast('Address copied!', 'success');
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-[#9296A3] pt-1">
                  Host: <span className="text-[#F5F5F7] font-mono">{overview.server.hostname}</span> · Node{' '}
                  {overview.server.nodeVersion}
                </div>
              </div>

              {/* Disk & Storage summary */}
              <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
                <h2 className="text-sm font-semibold">Storage &amp; Disk Health</h2>
                {disk && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#9296A3]">Host Disk Space</span>
                      <span className="font-mono text-[#F5F5F7]">
                        {formatBytes(disk.free)} free of {formatBytes(disk.total)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-[#6C8CFF]" style={{ width: `${diskUsedPct}%` }} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {Object.entries(overview.storage.categories as Record<string, { bytes: number; files: number }>).map(
                    ([cat, st]) => (
                      <div key={cat} className="p-2.5 rounded-xl bg-[#20232B] border border-white/[0.05]">
                        <div className="text-[10px] text-[#9296A3]">{cat}</div>
                        <div className="text-xs font-semibold mt-0.5">{formatBytes(st.bytes)}</div>
                        <div className="text-[10px] text-[#9296A3]">{st.files} files</div>
                      </div>
                    ),
                  )}
                </div>
                <div className="text-[11px] text-[#9296A3] font-mono truncate">
                  SQLite DB: {formatBytes(overview.storage.dbSize)} · Path: {overview.storage.storageDir}
                </div>
              </div>
            </div>

            {/* Recent Audit Events */}
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
              <h2 className="text-sm font-semibold mb-3">Recent Administrative &amp; Security Events</h2>
              <div className="space-y-2">
                {overview.recentAudit.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.05] last:border-0">
                    <div>
                      <span className="font-mono text-[#6C8CFF]">{a.action}</span>{' '}
                      <span className="text-[#F5F5F7]">{a.target}</span>{' '}
                      <span className="text-[#9296A3]">by {a.actor?.displayName || 'system'}</span>
                    </div>
                    <span className="text-[#9296A3]">{formatRelative(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'users' && (
          <div className="space-y-5">
            {/* Create Invitation */}
            <form onSubmit={createInvite} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="w-4 h-4 text-[#21C7A8]" /> Generate Partner Invitation Code
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  value={invNote}
                  onChange={(e) => setInvNote(e.target.value)}
                  placeholder="Note (e.g. For Maya)"
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#6C8CFF]"
                />
                <select
                  value={invRole}
                  onChange={(e) => setInvRole(e.target.value as any)}
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="PARTNER">Partner Role</option>
                  {isOwner && <option value="ADMIN">Admin Role</option>}
                </select>
                <select
                  value={invHours}
                  onChange={(e) => setInvHours(Number(e.target.value))}
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                >
                  <option value={24}>Expires in 24 hours</option>
                  <option value={72}>Expires in 3 days</option>
                  <option value={168}>Expires in 7 days</option>
                </select>
                <button type="submit" className="px-4 py-2 rounded-xl bg-[#21C7A8] text-[#0A1311] font-semibold text-xs cursor-pointer">
                  Create Invitation
                </button>
              </div>
              {invites.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  {invites.slice(0, 8).map((inv) => {
                    const active = !inv.usedAt && !inv.revokedAt && new Date(inv.expiresAt) > new Date();
                    const inviteLink = `${window.location.origin}/invite/${inv.code}`;
                    return (
                      <div
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#20232B] text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-semibold text-[#F5F5F7]">{inv.code}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#9296A3]">{inv.role}</span>
                          {inv.note && <span className="text-[#9296A3]">· {inv.note}</span>}
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              inv.usedAt
                                ? 'bg-[#6C8CFF]/15 text-[#6C8CFF]'
                                : active
                                  ? 'bg-[#21C7A8]/15 text-[#21C7A8]'
                                  : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {inv.usedAt ? `Used by ${inv.usedBy?.username || 'member'}` : active ? 'Active' : 'Revoked/Expired'}
                          </span>
                        </div>
                        {active && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(inviteLink);
                                toast('Invite link copied!', 'success');
                              }}
                              className="px-2 py-1 rounded-lg bg-[#181A20] hover:bg-white/10 text-[11px] cursor-pointer"
                            >
                              Copy Link
                            </button>
                            <button
                              type="button"
                              onClick={() => del(`/admin/invitations/${inv.id}`).then(() => loadTab('users'))}
                              className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 text-[11px] cursor-pointer"
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </form>

            {/* User List */}
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
              <h2 className="text-sm font-semibold">Team Accounts ({users.length})</h2>
              <div className="space-y-2">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#20232B] border border-white/[0.06]"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar user={u} size="sm" showStatus />
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">
                          <span>{u.displayName}</span>
                          <span className="text-xs text-[#9296A3] font-mono">@{u.username}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6C8CFF]/15 text-[#6C8CFF] uppercase font-semibold">
                            {u.role}
                          </span>
                          {!u.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">Deactivated</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#9296A3]">
                          {u.messageCount} msgs · {u.fileCount} files · {u.sessionCount} active sessions
                        </div>
                      </div>
                    </div>

                    {u.role !== 'OWNER' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setResetTarget({ id: u.id, username: u.username })}
                          className="px-2.5 py-1.5 rounded-lg bg-[#181A20] hover:bg-white/10 text-xs cursor-pointer"
                        >
                          Reset Password
                        </button>
                        <button
                          onClick={() =>
                            patch(`/admin/users/${u.id}`, { isActive: !u.isActive }).then(() => {
                              toast(u.isActive ? 'Account deactivated.' : 'Account reactivated.', 'info');
                              loadTab('users');
                            })
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                            u.isActive ? 'bg-amber-500/15 text-amber-300' : 'bg-[#21C7A8]/15 text-[#21C7A8]'
                          }`}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {isOwner && (
                          <button
                            onClick={() => {
                              if (confirm(`Permanently remove @${u.username}?`)) {
                                del(`/admin/users/${u.id}`).then(() => loadTab('users'));
                              }
                            }}
                            className="p-1.5 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {resetTarget && (
                <form onSubmit={submitResetPw} className="p-3 rounded-xl bg-[#101114] border border-[#6C8CFF]/40 flex flex-wrap items-center gap-2">
                  <span className="text-xs">New password for @{resetTarget.username}:</span>
                  <input
                    required
                    type="password"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    placeholder="Min 8 chars (letters & numbers)"
                    className="flex-1 min-w-[200px] bg-[#20232B] border border-white/10 rounded-lg px-3 py-1.5 text-xs"
                  />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-[#6C8CFF] text-white text-xs cursor-pointer">
                    Reset
                  </button>
                  <button type="button" onClick={() => setResetTarget(null)} className="px-3 py-1.5 rounded-lg bg-[#20232B] text-xs cursor-pointer">
                    Cancel
                  </button>
                </form>
              )}
            </div>

            {/* Direct Add User */}
            <form onSubmit={createUserDirect} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserPlus className="w-4 h-4 text-[#6C8CFF]" /> Add User Directly
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                <input
                  required
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                  placeholder="Display name"
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                />
                <input
                  required
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="username"
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                />
                <input
                  required
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Initial password (8+ chars)"
                  className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
                />
                <button type="submit" className="px-4 py-2 rounded-xl bg-[#6C8CFF] text-white text-xs font-medium cursor-pointer">
                  Create Account
                </button>
              </div>
            </form>

            {/* Active Sessions */}
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-2">
              <h2 className="text-sm font-semibold mb-2">Active Sessions ({sessions.length})</h2>
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#20232B] text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-[#F5F5F7]">{s.user.displayName}</span>{' '}
                    <span className="text-[#9296A3] font-mono">({s.ip || 'local'})</span>
                    {s.current && <span className="ml-2 text-[#21C7A8]">Current</span>}
                    <div className="text-[10px] text-[#9296A3] truncate">{s.userAgent}</div>
                  </div>
                  {!s.current && (
                    <button
                      onClick={() => del(`/admin/sessions/${s.id}`).then(() => loadTab('users'))}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 text-[11px] cursor-pointer shrink-0"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'groups' && (
          <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Group &amp; Channel Permissions</h2>
            {groups.map((g) => (
              <div key={g.id} className="p-3.5 rounded-xl bg-[#20232B] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{g.name} <span className="text-[10px] text-[#6C8CFF] uppercase ml-1">{g.type}</span></div>
                  <div className="text-xs text-[#9296A3]">{g.memberCount} members · {g.messageCount} messages</div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={g.onlyAdminsCanPost}
                      onChange={(e) =>
                        patch(`/admin/conversations/${g.id}`, { onlyAdminsCanPost: e.target.checked }).then(() =>
                          loadTab('groups'),
                        )
                      }
                    />
                    Only admins can post
                  </label>
                  {g.type === 'GROUP' && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={g.membersCanInvite}
                        onChange={(e) =>
                          patch(`/admin/conversations/${g.id}`, { membersCanInvite: e.target.checked }).then(() =>
                            loadTab('groups'),
                          )
                        }
                      />
                      Members can add others
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'storage' && (
          <div className="space-y-4">
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Storage Maintenance &amp; Integrity</h2>
                <p className="text-xs text-[#9296A3] mt-0.5">
                  Trash: {formatBytes(overview?.storage?.trash?.bytes || 0)} ({overview?.storage?.trash?.files || 0} files)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const res = await post('/admin/storage/consistency-check');
                    setConsistency(res);
                    toast(res.healthy ? 'All files and DB records match!' : 'Consistency issues detected.', res.healthy ? 'success' : 'info');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/10 text-xs font-medium cursor-pointer"
                >
                  Run Consistency Check
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('Permanently delete all files in trash?')) return;
                    const res = await post<{ freedBytes: number }>('/admin/storage/purge-trash');
                    toast(`Purged trash (${formatBytes(res.freedBytes)} freed).`, 'success');
                    loadTab('storage');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium cursor-pointer"
                >
                  Empty Trash
                </button>
              </div>
            </div>

            {consistency && (
              <div className="bg-[#181A20] border border-[#21C7A8]/30 rounded-2xl p-4 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-[#21C7A8]">
                  <CheckCircle2 className="w-4 h-4" /> Consistency Check Result
                </div>
                <div>Files checked: {consistency.checked} · Missing on disk: {consistency.missingOnDisk.length} · Untracked on disk: {consistency.untrackedOnDisk.length} · Stale uploads cleaned: {consistency.staleUploadsCleaned}</div>
              </div>
            )}

            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-2">
              <h2 className="text-sm font-semibold mb-2">All Uploaded Files ({files.length})</h2>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#20232B] text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-[#F5F5F7] truncate">{f.name}</div>
                      <div className="text-[11px] text-[#9296A3]">
                        {f.category} · {formatBytes(f.size)} · {f.scope} · by {f.uploader?.displayName || 'Unknown'} · {formatRelative(f.createdAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${f.name}"?`)) {
                          del(`/admin/files/${f.id}?permanent=1`).then(() => {
                            toast('File deleted.', 'info');
                            loadTab('storage');
                          });
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 shrink-0 cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'backups' && (
          <div className="space-y-4">
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Database &amp; File Backups</h2>
                <p className="text-xs text-[#9296A3] mt-0.5">
                  Snapshots are stored locally in the host&apos;s <code className="text-[#F5F5F7]">backups/</code> directory.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => runBackup(false)}
                  className="px-3.5 py-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/10 text-xs font-medium cursor-pointer"
                >
                  Database Only
                </button>
                <button
                  disabled={busy}
                  onClick={() => runBackup(true)}
                  className="px-3.5 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium cursor-pointer"
                >
                  {busy ? 'Working...' : 'Create Full Backup (DB + Files)'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {backups.length === 0 ? (
                <div className="text-center py-12 text-xs text-[#9296A3] bg-[#181A20] rounded-2xl border border-white/[0.07]">
                  No backups yet. Create your first snapshot above.
                </div>
              ) : (
                backups.map((b) => (
                  <div
                    key={b.name}
                    className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-mono font-medium text-[#F5F5F7]">{b.name}</div>
                      <div className="text-xs text-[#9296A3] mt-0.5">
                        {new Date(b.createdAt).toLocaleString()} · DB {formatBytes(b.dbSize)}
                        {b.includeFiles ? ` · ${b.fileCount} files (${formatBytes(b.filesSize)})` : ' · Database only'}
                      </div>
                      {b.note && <div className="text-[11px] text-[#6C8CFF] mt-0.5">{b.note}</div>}
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-2">
                        <button
                          disabled={busy}
                          onClick={() => doRestore(b.name)}
                          className="px-3 py-1.5 rounded-xl bg-[#21C7A8]/15 hover:bg-[#21C7A8]/25 text-[#21C7A8] text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Delete backup "${b.name}"?`)) {
                              del(`/admin/backups/${encodeURIComponent(b.name)}`).then(() => loadTab('backups'));
                            }
                          }}
                          className="p-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'settings' && settingsForm && (
          <form onSubmit={saveSettings} className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-5 space-y-4 max-w-3xl">
            <h2 className="text-sm font-semibold">Workspace &amp; Server Configuration</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Workspace Name">
                <input
                  value={settingsForm.workspaceName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, workspaceName: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Max Active Members">
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={settingsForm.maxUsers}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maxUsers: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Max File Upload Size (MB)">
                <input
                  type="number"
                  min={1}
                  max={10240}
                  value={settingsForm.maxFileSizeMB}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maxFileSizeMB: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Session Duration (days)">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settingsForm.sessionDays}
                  onChange={(e) => setSettingsForm({ ...settingsForm, sessionDays: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </Field>
              <Field label="HTTP Port (restart required)">
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settingsForm.port}
                  onChange={(e) => setSettingsForm({ ...settingsForm, port: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </Field>
              <Field label="HTTPS Port (restart required)">
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settingsForm.httpsPort}
                  onChange={(e) => setSettingsForm({ ...settingsForm, httpsPort: e.target.value })}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </Field>
            </div>

            <Field label="Storage Directory (relative to project root or absolute Windows path)">
              <input
                disabled={!isOwner}
                value={settingsForm.storageDir}
                onChange={(e) => setSettingsForm({ ...settingsForm, storageDir: e.target.value })}
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono disabled:opacity-60"
              />
            </Field>

            <Field label="Allowed File Extensions (comma-separated)">
              <textarea
                rows={3}
                value={settingsForm.allowedExtensions}
                onChange={(e) => setSettingsForm({ ...settingsForm, allowedExtensions: e.target.value })}
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono"
              />
            </Field>

            <label className="flex items-center gap-2 text-xs text-[#F5F5F7] cursor-pointer">
              <input
                type="checkbox"
                checked={settingsForm.enableHttps}
                onChange={(e) => setSettingsForm({ ...settingsForm, enableHttps: e.target.checked })}
              />
              Enable built-in LAN HTTPS server (recommended for voice messages, calls &amp; PWA)
            </label>

            <button
              disabled={busy}
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-sm font-medium cursor-pointer"
            >
              {busy ? 'Saving...' : 'Save Configuration'}
            </button>
          </form>
        )}

        {tab === 'logs' && (
          <div className="space-y-4">
            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Server Logs</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="bg-[#20232B] border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono"
                  >
                    <option value="">Today</option>
                    {serverLogs.dates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => loadTab('logs')}
                    className="p-1.5 rounded-lg bg-[#20232B] hover:bg-[#262A34] cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <pre className="bg-[#101114] border border-white/[0.06] rounded-xl p-3 text-[11px] font-mono text-[#9296A3] max-h-72 overflow-auto whitespace-pre-wrap">
                {serverLogs.lines.join('\n') || 'No log lines recorded yet.'}
              </pre>
            </div>

            <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4 space-y-2">
              <h2 className="text-sm font-semibold mb-2">Administrative Audit Log</h2>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {auditLogs.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#20232B] text-xs">
                    <div className="min-w-0">
                      <span className="font-mono text-[#6C8CFF]">{a.action}</span>{' '}
                      <span className="text-[#F5F5F7]">{a.target}</span>{' '}
                      <span className="text-[#9296A3]">
                        by {a.actor?.displayName || 'system'} ({a.ip || 'local'})
                      </span>
                    </div>
                    <span className="text-[11px] text-[#9296A3] shrink-0">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = 'text-[#F5F5F7]' }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-4">
      <div className="text-xs text-[#9296A3]">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent}`}>{value}</div>
      <div className="text-[11px] text-[#9296A3] mt-1">{sub}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#9296A3] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

