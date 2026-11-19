import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Download,
  KeyRound,
  Lock,
  Network,
  ShieldCheck,
  UserPlus,
  Wifi,
} from 'lucide-react';
import { api, post } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import type { User } from '../types';

export function AuthScreen() {
  const { systemInfo, onAuthenticated, toast } = useAppStore();
  const needsSetup = !!systemInfo?.needsSetup;

  // Support /invite/CODE links cleanly
  const inviteFromUrl =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/invite/')
      ? decodeURIComponent(window.location.pathname.slice('/invite/'.length)).trim().toUpperCase()
      : '';

  const [mode, setMode] = useState<'login' | 'register'>(inviteFromUrl ? 'register' : 'login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Setup state
  const [setupCode, setSetupCode] = useState('');
  const [workspaceName, setWorkspaceName] = useState('LOCAL HUB');

  // Shared account fields
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [inviteStatus, setInviteStatus] = useState<{ valid: boolean; role?: string | null } | null>(null);

  useEffect(() => {
    if (mode !== 'register' || inviteCode.trim().length < 6) {
      setInviteStatus(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ valid: boolean; role: string | null }>(`/auth/invite/${encodeURIComponent(inviteCode.trim())}`)
        .then(setInviteStatus)
        .catch(() => setInviteStatus({ valid: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [inviteCode, mode]);

  const primaryLan = systemInfo?.lanAddresses?.[0]?.address;
  const isInsecureLan =
    typeof window !== 'undefined' &&
    !window.isSecureContext &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';
  const httpsUrl =
    systemInfo?.httpsEnabled && primaryLan
      ? `https://${window.location.hostname === 'localhost' ? primaryLan : window.location.hostname}:${systemInfo.httpsPort}`
      : null;

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await post<{ user: User; sessionId: string }>('/auth/setup', {
        setupCode: setupCode.trim(),
        workspaceName: workspaceName.trim() || 'LOCAL HUB',
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        password,
      });
      await onAuthenticated(res.user, res.sessionId);
      toast('Workspace initialized! Welcome to LOCAL HUB.', 'success');
    } catch (err: any) {
      setError(err.message || 'Setup failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await post<{ user: User; sessionId: string }>('/auth/login', {
        username: username.trim().toLowerCase(),
        password,
      });
      await onAuthenticated(res.user, res.sessionId);
    } catch (err: any) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await post<{ user: User; sessionId: string }>('/auth/register', {
        inviteCode: inviteCode.trim().toUpperCase(),
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        password,
      });
      if (window.location.pathname.startsWith('/invite/')) {
        window.history.replaceState({}, '', '/');
      }
      await onAuthenticated(res.user, res.sessionId);
      toast('Account created! Welcome to the team.', 'success');
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#101114] text-[#F5F5F7] flex flex-col items-center justify-center p-4 overflow-y-auto relative">
      {/* Ambient radial glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[360px] rounded-full bg-[#6C8CFF]/10 blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 w-[520px] h-[320px] rounded-full bg-[#21C7A8]/8 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-[440px] relative z-10"
      >
        {/* Brand header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-[#181A20] border border-white/10 shadow-xl flex items-center justify-center mb-3">
            <img src="/icon.svg" alt="LOCAL HUB" className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F7]">
            {systemInfo?.workspaceName || 'LOCAL HUB'}
          </h1>
          <p className="text-sm text-[#9296A3] mt-1 flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-[#21C7A8]" />
            Private LAN Workspace
            {primaryLan && (
              <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-[#20232B] text-[#9296A3] border border-white/5">
                {primaryLan}:{systemInfo?.httpPort}
              </span>
            )}
          </p>
        </div>

        {/* Main card */}
        <div className="bg-[#181A20] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
          {needsSetup ? (
            <>
              <div className="flex items-center gap-2.5 mb-4 pb-4 border-b border-white/[0.07]">
                <div className="w-9 h-9 rounded-xl bg-[#6C8CFF]/15 text-[#6C8CFF] flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-base">First-Time Host Setup</h2>
                  <p className="text-xs text-[#9296A3]">Create the Owner account to initialize your LAN workspace</p>
                </div>
              </div>

              <form onSubmit={handleSetup} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-[#9296A3] mb-1.5">
                    Setup Code <span className="text-[#6C8CFF]">(shown in host server terminal)</span>
                  </label>
                  <input
                    required
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                    placeholder="e.g. 482910-A1B2"
                    className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono uppercase tracking-wider focus:outline-none focus:border-[#6C8CFF] transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Workspace Name</label>
                  <input
                    required
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="LOCAL HUB"
                    className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Display Name</label>
                    <input
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Username</label>
                    <input
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="alex"
                      autoComplete="username"
                      className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9296A3] mb-1.5">
                    Password <span className="text-[#9296A3]/70">(8+ chars, letters & numbers)</span>
                  </label>
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    autoComplete="new-password"
                    className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                  />
                </div>

                {error && (
                  <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  disabled={loading}
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer shadow-lg shadow-[#6C8CFF]/20"
                >
                  {loading ? 'Creating workspace...' : 'Initialize Workspace'}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Mode switcher */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[#101114] border border-white/[0.06] mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    mode === 'login' ? 'bg-[#20232B] text-[#F5F5F7] shadow-sm' : 'text-[#9296A3] hover:text-[#F5F5F7]'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" /> Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    mode === 'register' ? 'bg-[#20232B] text-[#F5F5F7] shadow-sm' : 'text-[#9296A3] hover:text-[#F5F5F7]'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" /> Join with Invite
                </button>
              </div>

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Username</label>
                    <input
                      required
                      autoFocus
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your.username"
                      autoComplete="username"
                      className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Password</label>
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                    />
                  </div>

                  {error && (
                    <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2">
                      {error}
                    </div>
                  )}

                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer shadow-lg shadow-[#6C8CFF]/20"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Invitation Code</label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#9296A3] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder="LH-XXXX-XXXX"
                        className="w-full bg-[#20232B] border border-white/10 rounded-xl pl-9 pr-3.5 py-2.5 text-sm font-mono uppercase tracking-wider focus:outline-none focus:border-[#6C8CFF] transition"
                      />
                    </div>
                    {inviteStatus && (
                      <p className={`text-xs mt-1.5 flex items-center gap-1 ${inviteStatus.valid ? 'text-[#21C7A8]' : 'text-rose-400'}`}>
                        {inviteStatus.valid ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Valid invitation ({inviteStatus.role})
                          </>
                        ) : (
                          'Invalid or expired invitation code.'
                        )}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Display Name</label>
                      <input
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Jordan Kim"
                        className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#9296A3] mb-1.5">Username</label>
                      <input
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="jordan"
                        autoComplete="username"
                        className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9296A3] mb-1.5">
                      Password <span className="text-[#9296A3]/70">(8+ chars, letters & numbers)</span>
                    </label>
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
                      autoComplete="new-password"
                      className="w-full bg-[#20232B] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#6C8CFF] transition"
                    />
                  </div>

                  {error && (
                    <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2">
                      {error}
                    </div>
                  )}

                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-[#21C7A8] hover:bg-[#27d9b8] disabled:opacity-50 text-[#0B1210] font-semibold text-sm transition cursor-pointer"
                  >
                    {loading ? 'Creating account...' : 'Create Account & Join'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* LAN HTTPS & Voice/Video helper */}
        {isInsecureLan && httpsUrl && (
          <div className="mt-4 bg-[#181A20]/90 border border-[#6C8CFF]/25 rounded-2xl p-4 text-xs text-[#9296A3] space-y-2">
            <div className="flex items-center gap-2 text-[#F5F5F7] font-medium">
              <Network className="w-4 h-4 text-[#6C8CFF]" />
              Using voice messages or calls over Wi-Fi?
            </div>
            <p className="leading-relaxed">
              Browsers only allow microphone &amp; camera access over HTTPS on LAN IP addresses. Open the local HTTPS
              address or install this host&apos;s private certificate once:
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={httpsUrl}
                className="px-3 py-1.5 rounded-lg bg-[#6C8CFF]/15 text-[#6C8CFF] hover:bg-[#6C8CFF]/25 font-medium transition"
              >
                Switch to HTTPS ({systemInfo?.httpsPort})
              </a>
              {systemInfo?.hasCaCert && (
                <a
                  href="/api/system/ca.crt"
                  className="px-3 py-1.5 rounded-lg bg-[#20232B] text-[#F5F5F7] hover:bg-[#262A34] border border-white/10 inline-flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" /> Download LAN Certificate
                </a>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-[#9296A3]/60 mt-5">
          100% private local network · Zero cloud dependencies · v{systemInfo?.version || '1.0.0'}
        </p>
      </motion.div>
    </div>
  );
}

