import { useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Menu, Play, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, formatDuration, formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { FileItem } from '../types';

export function GalleryView() {
  const { users, workspacePulse, leftSidebarOpen, setLeftSidebar, openLightbox } = useAppStore();
  const [kind, setKind] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
  const [uploaderId, setUploaderId] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ kind, limit: '150' });
    if (uploaderId) qs.set('uploaderId', uploaderId);
    if (search.trim()) qs.set('q', search.trim());
    api<{ files: FileItem[] }>(`/files/gallery?${qs}`)
      .then((d) => setItems(d.files))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [kind, uploaderId, search, workspacePulse]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#101114]">
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!leftSidebarOpen && (
            <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <ImageIcon className="w-5 h-5 text-[#21C7A8]" />
          <h1 className="text-sm font-semibold">Shared Media Gallery</h1>
          <span className="text-xs text-[#9296A3]">({items.length})</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#101114] border border-white/[0.08] rounded-xl p-0.5">
            {(['ALL', 'IMAGE', 'VIDEO'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  kind === k ? 'bg-[#20232B] text-[#F5F5F7]' : 'text-[#9296A3] hover:text-white'
                }`}
              >
                {k === 'ALL' ? 'All' : k === 'IMAGE' ? 'Photos' : 'Videos'}
              </button>
            ))}
          </div>

          <select
            value={uploaderId}
            onChange={(e) => setUploaderId(e.target.value)}
            className="hidden sm:block bg-[#20232B] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#F5F5F7] focus:outline-none"
          >
            <option value="">All Members</option>
            {Object.values(users).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>

          <div className="relative hidden md:block w-48">
            <Search className="w-3.5 h-3.5 text-[#9296A3] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter media..."
              className="w-full bg-[#20232B] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#6C8CFF]"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="text-center py-16 text-sm text-[#9296A3]">Loading media...</div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-white/10 rounded-2xl">
            <ImageIcon className="w-10 h-10 text-[#9296A3]/60 mx-auto mb-3" />
            <div className="text-sm font-medium text-[#F5F5F7]">No shared media yet</div>
            <p className="text-xs text-[#9296A3] mt-1">
              Images and videos uploaded in chats or Shared Files appear automatically here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((item) => {
              const uploader = item.uploaderId ? users[item.uploaderId] : null;
              return (
                <button
                  key={item.id}
                  onClick={() => openLightbox(item, items)}
                  className="group relative aspect-square rounded-2xl overflow-hidden bg-[#181A20] border border-white/[0.07] hover:border-[#6C8CFF]/50 transition cursor-pointer text-left"
                >
                  {item.thumbUrl || (item.category === 'IMAGE' && item.url) ? (
                    <img
                      src={item.thumbUrl || item.url!}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#9296A3] gap-2">
                      <Film className="w-8 h-8" />
                      <span className="text-[11px] px-2 truncate max-w-full">{item.name}</span>
                    </div>
                  )}

                  {item.category === 'VIDEO' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <div className="w-10 h-10 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white">
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </div>
                      {item.duration ? (
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white">
                          {formatDuration(item.duration)}
                        </span>
                      ) : null}
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 transition">
                    <div className="text-xs font-medium text-white truncate">{item.name}</div>
                    <div className="text-[10px] text-white/75 truncate">
                      {uploader?.displayName || 'Member'} · {formatBytes(item.size)} · {formatRelative(item.createdAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

