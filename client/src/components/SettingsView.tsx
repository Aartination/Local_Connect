import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  Laptop,
  Lock,
  LogOut,
  Menu,
  Mic,
  Settings as SettingsIcon,
  ShieldAlert,
  Trash2,
  Wifi,
} from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { User } from '../types';
import { Avatar } from './Avatar';

export function SettingsView({ pwaPrompt, onInstallPwa }: { pwaPrompt: any; onInstallPwa: () => void }) {
  const { me, systemInfo, leftSidebarOpen, setLeftSidebar, upsertUser, logout, toast } = useAppStore();

  const [displayName, setDisplayName] = useState(me?.displayName || '');
  const [username, setUsername] = useState(me?.username || '');
  const [statusText, setStatusText] = useState(me?.statusText || '');
  const [bio, setBio] = useState(me?.bio || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [sessions, setSessions] = useState<any[]>([]);
  const [mediaCheck, setMediaCheck] = useState<string>('');
  const avatarInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api<{ sessions: any[] }>('/auth/sessions')
      .then((d) => setSessions(d.sessions))
      .catch(() => {});
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { user } = await patch<{ user: User }>('/users/me', {
        displayName,
        username,
        statusText,
        bio,
      });
      upsertUser(user);
      toast('Profile updated.', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function uploadAvatar(file: File) {
    try {
      const res = await fetch('/api/users/me/avatar', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Avatar upload failed');
      upsertUser(json.user);
      toast('Profile picture updated.', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function removeAvatar() {
    const { user } = await del<{ user: User }>('/users/me/avatar');
    upsertUser(user);
    toast('Profile picture removed.', 'info');
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast('Password updated. Other devices were signed out.', 'success');
      api<{ sessions: any[] }>('/auth/sessions').then((d) => setSessions(d.sessions));
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function testMediaDevices() {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setMediaCheck('Blocked: switch to the HTTPS LAN URL below to unlock microphone & camera.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMediaCheck('Microphone is working and ready for voice messages and calls!');
    } catch (err: any) {
      setMediaCheck(`Error: ${err?.message || 'Permission denied or no microphone detected.'}`);
    }
  }

  const primaryLan = systemInfo?.lanAddresses?.[0]?.address;
  const httpsUrl =
    systemInfo?.httpsEnabled && primaryLan ? `https://${primaryLan}:${systemInfo.httpsPort}` : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#101114]">
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center gap-3 shrink-0">
        {!leftSidebarOpen && (
          <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
            <Menu className="w-4 h-4" />
          </button>
        )}
        <SettingsIcon className="w-5 h-5 text-[#6C8CFF]" />
        <h1 className="text-sm font-semibold">Account &amp; Network Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5 max-w-3xl w-full mx-auto space-y-5">
        {/* Profile */}
        <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold">Profile</h2>
          <div className="flex items-center gap-4">
            <Avatar user={me} size="xl" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) uploadAvatar(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => avatarInput.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/10 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" /> Change Photo
                </button>
                {me?.avatarUrl && (
                  <button
                    onClick={removeAvatar}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 text-xs cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#9296A3]">JPG, PNG, WEBP or GIF up to 8 MB.</p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#9296A3] mb-1">Display Name</label>
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9296A3] mb-1">Username</label>
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#9296A3] mb-1">Status Message</label>
              <input
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                placeholder="Working on designs, In a meeting..."
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9296A3] mb-1">Bio</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <button type="submit" className="px-4 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium cursor-pointer">
              Save Profile
            </button>
          </form>
        </section>

        {/* Password */}
        <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#6C8CFF]" /> Change Password
          </h2>
          <form onSubmit={changePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
            />
            <input
              required
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (8+ chars)"
              className="bg-[#20232B] border border-white/10 rounded-xl px-3 py-2 text-xs"
            />
            <button type="submit" className="px-4 py-2 rounded-xl bg-[#20232B] hover:bg-[#6C8CFF] text-xs font-medium transition cursor-pointer">
              Update Password
            </button>
          </form>
        </section>

        {/* Active Devices & Logout All */}
        <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Laptop className="w-4 h-4 text-[#21C7A8]" /> Signed-In Devices ({sessions.length})
            </h2>
            <button
              onClick={() => logout(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout All Devices
            </button>
          </div>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#20232B] text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-[#F5F5F7] flex items-center gap-2">
                    <span className="font-mono">{s.ip || 'localhost'}</span>
                    {s.current && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21C7A8]/15 text-[#21C7A8]">This device</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#9296A3] truncate">{s.userAgent}</div>
                  <div className="text-[10px] text-[#9296A3]/70">Last active {formatRelative(s.lastActiveAt)}</div>
                </div>
                {!s.current && (
                  <button
                    onClick={() =>
                      del(`/auth/sessions/${s.id}`).then(() => setSessions((l) => l.filter((x) => x.id !== s.id)))
                    }
                    className="p-1.5 rounded-lg bg-rose-500/15 text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* LAN, HTTPS, Audio/Video & PWA */}
        <section className="bg-[#181A20] border border-white/[0.07] rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Wifi className="w-4 h-4 text-[#6C8CFF]" /> LAN Connection, Audio/Video &amp; Desktop App (PWA)
          </h2>
          <div className="flex items-center gap-2 text-xs">
            {window.isSecureContext ? (
              <span className="inline-flex items-center gap-1.5 text-[#21C7A8]">
                <CheckCircle2 className="w-4 h-4" /> Secure context active — Voice messages, WebRTC calls &amp; PWA are enabled.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <ShieldAlert className="w-4 h-4" /> Plain HTTP over LAN IP — switch to HTTPS below to use microphone &amp; camera.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={testMediaDevices}
              className="px-3.5 py-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/10 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-[#21C7A8]" /> Test Microphone
            </button>
            {httpsUrl && !window.isSecureContext && (
              <a
                href={httpsUrl}
                className="px-3.5 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium"
              >
                Open HTTPS ({httpsUrl})
              </a>
            )}
            {systemInfo?.hasCaCert && (
              <a
                href="/api/system/ca.crt"
                className="px-3.5 py-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] border border-white/10 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download LAN CA Certificate
              </a>
            )}
            {pwaPrompt && (
              <button
                onClick={onInstallPwa}
                className="px-3.5 py-2 rounded-xl bg-[#21C7A8] text-[#0A1311] text-xs font-semibold cursor-pointer"
              >
                Install Desktop App (PWA)
              </button>
            )}
          </div>
          {mediaCheck && <div className="text-xs text-[#9296A3] bg-[#20232B] rounded-xl px-3 py-2">{mediaCheck}</div>}
        </section>
      </div>
    </div>
  );
}

