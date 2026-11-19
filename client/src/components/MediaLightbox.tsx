import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { downloadWithProgress } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { VoicePlayer } from './VoicePlayer';

const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json', 'log']);

export function MediaLightbox() {
  const { lightboxFile, lightboxList, openLightbox, closeLightbox, users, toast } = useAppStore();
  const [zoom, setZoom] = useState(1);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState<number | null>(null);

  const index = lightboxFile ? lightboxList.findIndex((f) => f.id === lightboxFile.id) : -1;

  useEffect(() => {
    setZoom(1);
    setTextPreview(null);
    setDlProgress(null);
    if (!lightboxFile?.url) return;
    if (TEXT_EXTS.has(lightboxFile.ext) && lightboxFile.size < 2 * 1024 * 1024) {
      fetch(lightboxFile.url, { credentials: 'include' })
        .then((r) => r.text())
        .then((t) => setTextPreview(t))
        .catch(() => setTextPreview('Could not preview this text file.'));
    }
  }, [lightboxFile?.id]);

  useEffect(() => {
    if (!lightboxFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight' && index >= 0 && index < lightboxList.length - 1) {
        openLightbox(lightboxList[index + 1], lightboxList);
      }
      if (e.key === 'ArrowLeft' && index > 0) {
        openLightbox(lightboxList[index - 1], lightboxList);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxFile, index, lightboxList]);

  async function handleDownload() {
    if (!lightboxFile?.downloadUrl) return;
    try {
      setDlProgress(0);
      await downloadWithProgress(lightboxFile.downloadUrl, lightboxFile.name, (pct) => setDlProgress(pct));
      setTimeout(() => setDlProgress(null), 900);
    } catch {
      setDlProgress(null);
      toast('Download failed.', 'error');
    }
  }

  const uploader = lightboxFile?.uploaderId ? users[lightboxFile.uploaderId] : null;

  return (
    <AnimatePresence>
      {lightboxFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col"
          onClick={closeLightbox}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-5 py-3.5 bg-[#101114]/85 border-b border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#F5F5F7] truncate">{lightboxFile.name}</div>
              <div className="text-xs text-[#9296A3] flex items-center gap-2">
                <span>{formatBytes(lightboxFile.size)}</span>
                <span>·</span>
                <span>{lightboxFile.ext.toUpperCase()}</span>
                {uploader && (
                  <>
                    <span>·</span>
                    <span>Uploaded by {uploader.displayName}</span>
                  </>
                )}
                <span>·</span>
                <span>{formatRelative(lightboxFile.createdAt)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {lightboxFile.category === 'IMAGE' && (
                <>
                  <button
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    className="p-2 rounded-lg bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] transition cursor-pointer"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                    className="p-2 rounded-lg bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] transition cursor-pointer"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </>
              )}
              {lightboxFile.url && (
                <a
                  href={lightboxFile.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-lg bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] transition"
                  title="Open in new tab"
                >
                  <Maximize2 className="w-4 h-4" />
                </a>
              )}
              <button
                onClick={handleDownload}
                className="px-3 py-2 rounded-lg bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {dlProgress !== null ? `${dlProgress}%` : 'Download'}
              </button>
              <button
                onClick={closeLightbox}
                className="p-2 rounded-lg bg-[#20232B] hover:bg-rose-500/20 hover:text-rose-300 text-[#9296A3] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 relative flex items-center justify-center p-6 overflow-auto">
            {index > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openLightbox(lightboxList[index - 1], lightboxList);
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-[#20232B]/90 hover:bg-[#262A34] border border-white/10 text-white flex items-center justify-center transition cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {index >= 0 && index < lightboxList.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openLightbox(lightboxList[index + 1], lightboxList);
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-[#20232B]/90 hover:bg-[#262A34] border border-white/10 text-white flex items-center justify-center transition cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full flex items-center justify-center">
              {lightboxFile.category === 'IMAGE' && lightboxFile.url ? (
                <img
                  src={lightboxFile.url}
                  alt={lightboxFile.name}
                  style={{ transform: `scale(${zoom})` }}
                  className="max-h-[82vh] max-w-[90vw] object-contain rounded-xl shadow-2xl transition-transform duration-150"
                />
              ) : lightboxFile.category === 'VIDEO' && lightboxFile.url ? (
                <video
                  src={lightboxFile.url}
                  controls
                  autoPlay
                  className="max-h-[82vh] max-w-[90vw] rounded-xl shadow-2xl bg-black"
                />
              ) : lightboxFile.category === 'AUDIO' && lightboxFile.url ? (
                <div className="bg-[#181A20] border border-white/10 rounded-2xl p-6 min-w-[340px]">
                  <p className="text-sm font-medium mb-4 truncate">{lightboxFile.name}</p>
                  <VoicePlayer
                    src={lightboxFile.url}
                    downloadUrl={lightboxFile.downloadUrl}
                    filename={lightboxFile.name}
                    duration={lightboxFile.duration}
                    waveform={lightboxFile.waveform}
                  />
                </div>
              ) : lightboxFile.mime === 'application/pdf' && lightboxFile.url ? (
                <iframe
                  src={lightboxFile.url}
                  title={lightboxFile.name}
                  className="w-[85vw] h-[82vh] rounded-xl bg-white border border-white/10"
                />
              ) : textPreview !== null ? (
                <pre className="w-[82vw] max-h-[80vh] overflow-auto bg-[#181A20] border border-white/10 rounded-xl p-5 text-xs font-mono text-[#F5F5F7] whitespace-pre-wrap break-words">
                  {textPreview}
                </pre>
              ) : (
                <div className="bg-[#181A20] border border-white/10 rounded-2xl p-10 text-center max-w-md">
                  <FileText className="w-12 h-12 text-[#6C8CFF] mx-auto mb-3" />
                  <div className="text-base font-medium mb-1">{lightboxFile.name}</div>
                  <p className="text-xs text-[#9296A3] mb-5">
                    Preview is not available for .{lightboxFile.ext} files in the browser. Download it to open locally.
                  </p>
                  <button
                    onClick={handleDownload}
                    className="px-4 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Download ({formatBytes(lightboxFile.size)})
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

