import { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { downloadWithProgress } from '../lib/api';
import { formatDuration } from '../lib/format';

interface VoicePlayerProps {
  src: string;
  downloadUrl?: string | null;
  filename: string;
  duration?: number | null;
  waveform?: number[] | null;
  compact?: boolean;
}

const DEFAULT_BARS = [
  0.22, 0.45, 0.62, 0.35, 0.8, 0.92, 0.54, 0.4, 0.72, 0.88, 0.6, 0.3, 0.55, 0.78, 0.95, 0.66, 0.42, 0.68,
  0.5, 0.32, 0.74, 0.85, 0.58, 0.38, 0.64, 0.48, 0.28, 0.52, 0.7, 0.4, 0.3, 0.2,
];

const SPEEDS = [1, 1.5, 2];

export function VoicePlayer({ src, downloadUrl, filename, duration, waveform, compact }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const bars = waveform && waveform.length >= 8 ? waveform : DEFAULT_BARS;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setTotalDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.playbackRate = SPEEDS[speedIdx];
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  function seek(fraction: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : totalDuration;
    if (dur > 0) {
      audio.currentTime = Math.max(0, Math.min(dur, dur * fraction));
      setCurrentTime(audio.currentTime);
    }
  }

  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl bg-[#181A20] border border-white/[0.08] ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5 min-w-[260px] max-w-[360px]'
      }`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        className="w-9 h-9 rounded-full bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white flex items-center justify-center shrink-0 transition cursor-pointer"
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-7 cursor-pointer select-none"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
        >
          {bars.map((amp, idx) => {
            const barFrac = idx / bars.length;
            const active = barFrac <= progress;
            return (
              <div
                key={idx}
                style={{ height: `${Math.max(16, Math.round(amp * 100))}%` }}
                className={`flex-1 rounded-full transition-colors ${
                  active ? 'bg-[#6C8CFF]' : 'bg-[#9296A3]/35 hover:bg-[#9296A3]/55'
                }`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] text-[#9296A3] mt-1 font-mono">
          <span>
            {formatDuration(currentTime)} / {formatDuration(totalDuration)}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleSpeed}
              className="px-1.5 py-0.5 rounded bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] text-[10px] font-semibold cursor-pointer transition"
              title="Playback speed"
            >
              {SPEEDS[speedIdx]}x
            </button>
            {downloadUrl && (
              <button
                type="button"
                onClick={() => downloadWithProgress(downloadUrl, filename)}
                className="p-1 rounded hover:bg-white/10 text-[#9296A3] hover:text-[#F5F5F7] cursor-pointer transition"
                title="Download audio"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

