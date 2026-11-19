import type { User } from '../types';

const PALETTE = [
  'from-[#6C8CFF] to-[#4A68D8]',
  'from-[#21C7A8] to-[#13987F]',
  'from-[#9D7BFF] to-[#6B4CD8]',
  'from-[#F59E0B] to-[#D97706]',
  'from-[#EC4899] to-[#BE185D]',
  'from-[#38BDF8] to-[#0284C7]',
];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialsOf(name: string) {
  const parts = (name || '?').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

interface AvatarProps {
  user?: Pick<User, 'id' | 'displayName' | 'username' | 'avatarUrl' | 'online' | 'isActive'> | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
  className?: string;
}

const SIZES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
  xl: 'w-16 h-16 text-lg',
};

const DOT_SIZES = {
  xs: 'w-2 h-2 border',
  sm: 'w-2.5 h-2.5 border-2',
  md: 'w-2.5 h-2.5 border-2',
  lg: 'w-3 h-3 border-2',
  xl: 'w-3.5 h-3.5 border-2',
};

export function Avatar({ user, name, size = 'md', showStatus = false, className = '' }: AvatarProps) {
  const label = user?.displayName || name || '?';
  const seed = user?.id || label;
  const online = !!user?.online && user?.isActive !== false;

  return (
    <div className={`relative inline-flex shrink-0 select-none ${className}`}>
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={label}
          className={`${SIZES[size]} rounded-full object-cover bg-[#20232B] ring-1 ring-white/10`}
        />
      ) : (
        <div
          className={`${SIZES[size]} rounded-full bg-gradient-to-br ${colorFor(seed)} font-semibold text-white flex items-center justify-center shadow-sm ring-1 ring-white/10`}
        >
          {initialsOf(label)}
        </div>
      )}
      {showStatus && (
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-[#181A20] ${DOT_SIZES[size]} ${
            online ? 'bg-[#21C7A8]' : 'bg-[#5B6070]'
          }`}
        />
      )}
    </div>
  );
}

