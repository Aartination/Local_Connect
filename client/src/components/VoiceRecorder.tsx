import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Trash2 } from 'lucide-react';
import { formatDuration } from '../lib/format';
import { VoicePlayer } from './VoicePlayer';

interface VoiceRecorderProps {
  onSend: (blob: Blob, filename: string, duration: number, waveform: number[]) => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}

export function VoiceRecorder({ onSend, onCancel, onError }: VoiceRecorderProps) {
  const [state, setState] = useState<'recording' | 'preview' | 'sending'>('recording');
  const [elapsed, setElapsed] = useState(0);
  const [liveBars, setLiveBars] = useState<number[]>(new Array(32).fill(0.15));
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalWaveform, setFinalWaveform] = useState<number[]>([]);
  const [mimeExt, setMimeExt] = useState('webm');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let active = true;

    async function start() {
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        onError('Voice recording requires HTTPS over LAN IP. Switch to the HTTPS address in Settings.');
        onCancel();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        onError('Your browser does not support audio recording.');
        onCancel();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Pick best supported container
        const candidates = [
          { mime: 'audio/webm;codecs=opus', ext: 'weba' },
          { mime: 'audio/webm', ext: 'weba' },
          { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
          { mime: 'audio/mp4', ext: 'm4a' },
        ];
        const picked = candidates.find((c) => MediaRecorder.isTypeSupported(c.mime));
        setMimeExt(picked?.ext || 'weba');

        const recorder = picked ? new MediaRecorder(stream, { mimeType: picked.mime }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        samplesRef.current = [];
        startTimeRef.current = Date.now();

        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunksRef.current.push(ev.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          setRecordedBlob(blob);
          setPreviewUrl(url);
          // Downsample collected peaks to 40 crisp waveform bars
          const raw = samplesRef.current;
          const bars: number[] = [];
          const count = 40;
          if (raw.length > 0) {
            for (let i = 0; i < count; i++) {
              const start = Math.floor((i / count) * raw.length);
              const end = Math.max(start + 1, Math.floor(((i + 1) / count) * raw.length));
              let sum = 0;
              for (let j = start; j < end && j < raw.length; j++) sum += raw[j];
              bars.push(Math.max(0.12, Math.min(1, sum / (end - start))));
            }
          }
          setFinalWaveform(bars);
          setState('preview');
        };

        // Live waveform visualizer
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          ctxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          let lastSample = 0;
          const tick = () => {
            if (!active) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const level = Math.min(1, sum / data.length / 90);
            const now = Date.now();
            setElapsed((now - startTimeRef.current) / 1000);
            if (now - lastSample > 80) {
              lastSample = now;
              samplesRef.current.push(level);
              setLiveBars((prev) => [...prev.slice(1), Math.max(0.12, level)]);
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }

        recorder.start(250);
      } catch (err: any) {
        onError(
          err?.name === 'NotAllowedError'
            ? 'Microphone permission denied.'
            : 'Could not start recording. Check your microphone.',
        );
        onCancel();
      }
    }

    start();

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function stopRecording() {
    cancelAnimationFrame(rafRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
  }

  async function handleSend() {
    if (!recordedBlob) return;
    setState('sending');
    try {
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
      await onSend(recordedBlob, `voice-${stamp}.${mimeExt}`, elapsed, finalWaveform);
    } catch (err: any) {
      onError(err?.message || 'Failed to send voice message.');
      setState('preview');
    }
  }

  return (
    <div className="flex items-center gap-3 w-full bg-[#20232B] border border-[#6C8CFF]/35 rounded-2xl px-3.5 py-2.5">
      {state === 'recording' ? (
        <>
          <div className="flex items-center gap-2 text-rose-400 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <Mic className="w-4 h-4" />
            <span className="text-xs font-mono text-[#F5F5F7] min-w-[38px]">{formatDuration(elapsed)}</span>
          </div>

          <div className="flex-1 flex items-end gap-[3px] h-7 overflow-hidden">
            {liveBars.map((b, i) => (
              <div
                key={i}
                style={{ height: `${Math.round(b * 100)}%` }}
                className="flex-1 rounded-full bg-[#6C8CFF]/80 transition-all duration-75"
              />
            ))}
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-xl hover:bg-white/10 text-[#9296A3] hover:text-rose-400 transition cursor-pointer"
            title="Discard recording"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={stopRecording}
            className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Stop
          </button>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            {previewUrl && (
              <VoicePlayer
                src={previewUrl}
                filename={`voice.${mimeExt}`}
                duration={elapsed}
                waveform={finalWaveform}
                compact
              />
            )}
          </div>
          <button
            type="button"
            disabled={state === 'sending'}
            onClick={onCancel}
            className="p-2 rounded-xl hover:bg-white/10 text-[#9296A3] hover:text-rose-400 transition cursor-pointer"
            title="Discard"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={state === 'sending'}
            onClick={handleSend}
            className="px-3.5 py-2 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" /> {state === 'sending' ? 'Sending...' : 'Send Voice'}
          </button>
        </>
      )}
    </div>
  );
}

