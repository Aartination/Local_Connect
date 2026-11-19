import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  FileAudio,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Menu,
  Pin,
  PinOff,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { api, del, downloadWithProgress, patch, uploadFile } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { FileItem } from '../types';

const CATEGORIES = [
  { id: '', label: 'All' },
  { id: 'DOCUMENT', label: 'Documents' },
  { id: 'IMAGE', label: 'Images' },
  { id: 'VIDEO', label: 'Videos' },
  { id: 'AUDIO', label: 'Audio' },
  { id: 'ARCHIVE', label: 'Archives' },
];

export function FilesView() {
  const { me, isAdmin, users, workspacePulse, leftSidebarOpen, setLeftSidebar, openLightbox, toast } = useAppStore();
  const [scope, setScope] = useState<'WORKSPACE' | 'ALL' | 'CHAT'>('WORKSPACE');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; pct: number }>>([]);
  const [dlPct, setDlPct] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ scope, limit: '150' });
      if (category) qs.set('category', category);
      if (search.trim()) qs.set('q', search.trim());
      const res = await api<{ files: FileItem[] }>(`/files?${qs}`);
      setFiles(res.files);
    } catch {
      toast('Could not load files.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 200 : 0);
    return () => clearTimeout(t);
  }, [scope, category, search, workspacePulse]);

  async function handleFiles(fileList: FileList | File[]) {
    for (const f of Array.from(fileList)) {
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setUploads((u) => [...u, { id: uid, name: f.name, pct: 0 }]);
      try {
        await uploadFile(f, f.name, {
          scope: 'WORKSPACE',
          folder: folder.trim(),
          onProgress: (pct) => setUploads((u) => u.map((x) => (x.id === uid ? { ...x, pct } : x))),
        });
        toast(`Uploaded "${f.name}"`, 'success');
      } catch (err: any) {
        toast(err?.message || `Failed to upload "${f.name}"`, 'error');
      } finally {
        setUploads((u) => u.filter((x) => x.id !== uid));
      }
    }
    load();
  }

  async function togglePin(f: FileItem) {
    try {
      await patch(`/files/${f.id}`, { pinned: !f.pinned });
      load();
    } catch (err: any) {
      toast(err?.message || 'Could not update pin.', 'error');
    }
  }

  async function deleteFile(f: FileItem) {
    if (!confirm(`Delete "${f.name}"?`)) return;
    try {
      await del(`/files/${f.id}`);
      toast('File removed.', 'info');
      load();
    } catch (err: any) {
      toast(err?.message || 'Could not delete file.', 'error');
    }
  }

  async function handleDownload(f: FileItem) {
    if (!f.downloadUrl) return;
    setDlPct((p) => ({ ...p, [f.id]: 1 }));
    try {
      await downloadWithProgress(f.downloadUrl, f.name, (pct) => setDlPct((p) => ({ ...p, [f.id]: pct })));
    } catch {
      toast('Download failed.', 'error');
    } finally {
      setTimeout(() => {
        setDlPct((p) => {
          const n = { ...p };
          delete n[f.id];
          return n;
        });
      }, 800);
    }
  }

  function iconFor(cat: string) {
    if (cat === 'IMAGE') return ImageIcon;
    if (cat === 'VIDEO') return Film;
    if (cat === 'AUDIO') return FileAudio;
    if (cat === 'ARCHIVE') return FileArchive;
    return FileText;
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-[#101114] relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="absolute inset-0 z-30 bg-[#101114]/90 border-2 border-dashed border-[#6C8CFF] m-4 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-12 h-12 text-[#6C8CFF] mb-3" />
          <div className="text-base font-semibold">Drop files to upload to Shared Repository</div>
        </div>
      )}

      {/* Header */}
      <header className="h-14 px-5 border-b border-white/[0.07] bg-[#181A20]/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!leftSidebarOpen && (
            <button onClick={() => setLeftSidebar(true)} className="p-2 rounded-lg hover:bg-white/5 text-[#9296A3] cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <FolderOpen className="w-5 h-5 text-[#6C8CFF]" />
          <h1 className="text-sm font-semibold">Shared File Repository</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Folder tag (optional)"
            className="hidden sm:block bg-[#20232B] border border-white/10 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-[#6C8CFF] w-40"
          />
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="px-3.5 py-1.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition"
          >
            <UploadCloud className="w-4 h-4" /> Upload Files
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="px-5 py-3 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['WORKSPACE', 'ALL', 'CHAT'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                scope === s ? 'bg-[#6C8CFF]/20 text-[#6C8CFF]' : 'text-[#9296A3] hover:bg-white/5 hover:text-white'
              }`}
            >
              {s === 'WORKSPACE' ? 'Shared Repo' : s === 'ALL' ? 'All Accessible' : 'From Chats'}
            </button>
          ))}
          <span className="h-4 w-px bg-white/10 mx-1" />
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                category === c.id ? 'bg-[#20232B] text-[#F5F5F7] border border-white/10' : 'text-[#9296A3] hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#9296A3] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files, folders..."
            className="w-full bg-[#181A20] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#6C8CFF]"
          />
        </div>
      </div>

      {/* Upload progress strip */}
      {uploads.length > 0 && (
        <div className="px-5 py-2.5 bg-[#181A20] border-b border-white/[0.07] space-y-1.5">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-xs">
              <span className="truncate flex-1 text-[#F5F5F7]">Uploading {u.name}</span>
              <div className="w-36 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[#21C7A8] transition-all" style={{ width: `${u.pct}%` }} />
              </div>
              <span className="font-mono text-[#9296A3] w-9 text-right">{u.pct}%</span>
            </div>
          ))}
        </div>
      )}

      {/* File Table / Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="text-center py-16 text-sm text-[#9296A3]">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-white/10 rounded-2xl">
            <UploadCloud className="w-10 h-10 text-[#6C8CFF] mx-auto mb-3 opacity-75" />
            <div className="text-sm font-medium text-[#F5F5F7]">No files found</div>
            <p className="text-xs text-[#9296A3] mt-1">Drag and drop files here or click Upload Files above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {files.map((f) => {
              const Icon = iconFor(f.category);
              const uploader = f.uploaderId ? users[f.uploaderId] : null;
              const canEdit = isAdmin || f.uploaderId === me?.id;
              return (
                <div
                  key={f.id}
                  className="group bg-[#181A20] hover:bg-[#1D2028] border border-white/[0.07] rounded-2xl p-3.5 flex flex-col gap-3 transition"
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => openLightbox(f, files)}
                      className="w-12 h-12 rounded-xl bg-[#20232B] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer"
                    >
                      {f.thumbUrl || (f.category === 'IMAGE' && f.url) ? (
                        <img src={f.thumbUrl || f.url!} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <Icon className="w-5 h-5 text-[#6C8CFF]" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => openLightbox(f, files)}
                        className="text-sm font-medium text-[#F5F5F7] hover:text-[#6C8CFF] truncate block w-full text-left cursor-pointer"
                      >
                        {f.name}
                      </button>
                      <div className="text-[11px] text-[#9296A3] mt-0.5 flex items-center flex-wrap gap-1.5">
                        <span className="uppercase font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#20232B]">{f.ext}</span>
                        <span>{formatBytes(f.size)}</span>
                        {f.folder && (
                          <span className="px-1.5 py-0.5 rounded bg-[#6C8CFF]/15 text-[#6C8CFF] text-[10px]">{f.folder}</span>
                        )}
                        {f.pinned && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px]">Pinned</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {dlPct[f.id] !== undefined && (
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-[#21C7A8] transition-all" style={{ width: `${dlPct[f.id]}%` }} />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-[11px] text-[#9296A3]">
                    <span className="truncate">
                      {uploader?.displayName || 'Member'} · {formatRelative(f.createdAt)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDownload(f)}
                        title="Download"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-white cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && f.scope === 'WORKSPACE' && (
                        <button
                          onClick={() => togglePin(f)}
                          title={f.pinned ? 'Unpin document' : 'Pin document'}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-[#9296A3] hover:text-amber-300 cursor-pointer"
                        >
                          {f.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => deleteFile(f)}
                          title="Delete"
                          className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[#9296A3] hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

