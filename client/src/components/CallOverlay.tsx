import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { formatDuration } from '../lib/format';
import { rtc } from '../lib/webrtc';
import { useAppStore } from '../store/useAppStore';
import { Avatar } from './Avatar';

function StreamTile({
  userId,
  stream,
  isSelf,
  audioOn,
  videoOn,
  speaking,
}: {
  userId: string;
  stream: MediaStream | null;
  isSelf: boolean;
  audioOn: boolean;
  videoOn: boolean;
  speaking: boolean;
}) {
  const { users } = useAppStore();
  const user = users[userId];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasLiveVideo =
    videoOn && !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    if (!isSelf && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream, hasLiveVideo, isSelf]);

  return (
    <div
      className={`relative rounded-2xl bg-[#181A20] border overflow-hidden flex flex-col items-center justify-center min-h-[200px] transition ${
        speaking ? 'border-[#21C7A8] ring-2 ring-[#21C7A8]/35' : 'border-white/10'
      }`}
    >
      {!isSelf && <audio ref={audioRef} autoPlay playsInline />}

      {hasLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isSelf}
          className={`w-full h-full object-cover ${isSelf ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 p-6">
          <div className={`rounded-full ${speaking ? 'speaking-ring' : ''}`}>
            <Avatar user={user} size="xl" />
          </div>
          <div className="text-sm font-medium text-[#F5F5F7]">
            {user?.displayName || 'Member'} {isSelf ? '(You)' : ''}
          </div>
        </div>
      )}

      {/* Bottom overlay pill */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <span className="px-2.5 py-1 rounded-lg bg-black/65 backdrop-blur text-xs font-medium text-white truncate max-w-[75%]">
          {user?.displayName || 'Member'} {isSelf ? '(You)' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {!audioOn && (
            <span className="p-1.5 rounded-lg bg-rose-500/85 text-white">
              <MicOff className="w-3.5 h-3.5" />
            </span>
          )}
          {videoOn && (
            <span className="p-1.5 rounded-lg bg-[#6C8CFF]/80 text-white">
              <Video className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CallOverlay() {
  const {
    me,
    users,
    conversations,
    incomingCall,
    activeCall,
    callMinimized,
    localAudio,
    localVideo,
    remoteStreams,
    speakingUsers,
    acceptCall,
    declineCall,
    leaveCall,
    toggleCallAudio,
    toggleCallVideo,
    setCallMinimized,
  } = useAppStore();

  const [elapsed, setElapsed] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeCall) {
      setElapsed(0);
      return;
    }
    const tick = () => {
      const refTime = activeCall.connectedAt || activeCall.startedAt;
      setElapsed(Math.max(0, Math.floor((Date.now() - refTime) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeCall?.id, activeCall?.connectedAt]);

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }

  function callTitle(convId: string) {
    const conv = conversations[convId];
    if (!conv) return 'Call';
    if (conv.type === 'DIRECT') {
      const other = conv.members.find((m) => m.userId !== me?.id);
      return (other && users[other.userId]?.displayName) || 'Direct Call';
    }
    return conv.name || 'Team Call';
  }

  const localStream = rtc.getLocalStream();
  const participants = activeCall?.participants || [];
  const gridCols =
    participants.length <= 1
      ? 'grid-cols-1 max-w-xl mx-auto'
      : participants.length === 2
        ? 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto'
        : participants.length <= 4
          ? 'grid-cols-2 max-w-4xl mx-auto'
          : 'grid-cols-2 md:grid-cols-3 max-w-5xl mx-auto';

  return (
    <>
      {/* Incoming call modal */}
      <AnimatePresence>
        {incomingCall && !activeCall && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            className="fixed top-5 right-5 z-50 w-80 bg-[#181A20] border border-[#6C8CFF]/40 rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center gap-3.5 mb-4">
              <div className="speaking-ring rounded-full">
                <Avatar user={users[incomingCall.initiatorId]} size="lg" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#21C7A8] flex items-center gap-1.5">
                  <PhoneIncoming className="w-3.5 h-3.5" />
                  Incoming {incomingCall.video ? 'video' : 'voice'} call
                </div>
                <div className="text-base font-semibold text-[#F5F5F7] truncate">
                  {callTitle(incomingCall.conversationId)}
                </div>
                <div className="text-xs text-[#9296A3] truncate">
                  from {users[incomingCall.initiatorId]?.displayName || 'Team member'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={declineCall}
                className="flex-1 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" /> Decline
              </button>
              <button
                onClick={() => acceptCall(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#21C7A8] hover:bg-[#27d9b8] text-[#0A1311] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Phone className="w-4 h-4" /> Audio
              </button>
              {incomingCall.video && (
                <button
                  onClick={() => acceptCall(true)}
                  className="flex-1 py-2.5 rounded-xl bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Video className="w-4 h-4" /> Video
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active call minimized floating bar */}
      <AnimatePresence>
        {activeCall && callMinimized && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed bottom-5 right-5 z-40 bg-[#181A20] border border-[#21C7A8]/40 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-4"
          >
            {/* Keep remote audio playing while minimized! */}
            <div className="hidden">
              {Object.entries(remoteStreams).map(([uid, stream]) => (
                <HiddenAudio key={uid} stream={stream} />
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#21C7A8] animate-pulse" />
              <div>
                <div className="text-xs font-semibold text-[#F5F5F7]">{callTitle(activeCall.conversationId)}</div>
                <div className="text-[11px] font-mono text-[#9296A3]">
                  {activeCall.connectedAt ? formatDuration(elapsed) : 'Ringing...'} · {participants.length} in call
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleCallAudio}
                className={`p-2 rounded-xl transition cursor-pointer ${
                  localAudio ? 'bg-[#20232B] text-[#F5F5F7]' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {localAudio ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setCallMinimized(false)}
                className="p-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] transition cursor-pointer"
                title="Expand call"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={leaveCall}
                className="p-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition cursor-pointer"
                title="End call"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active call full view */}
      <AnimatePresence>
        {activeCall && !callMinimized && (
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#101114]/97 backdrop-blur-lg flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#21C7A8] animate-pulse" />
                <div>
                  <h2 className="text-base font-semibold text-[#F5F5F7]">{callTitle(activeCall.conversationId)}</h2>
                  <p className="text-xs text-[#9296A3] font-mono">
                    {activeCall.connectedAt ? formatDuration(elapsed) : 'Ringing...'} · {participants.length}{' '}
                    {participants.length === 1 ? 'participant' : 'participants'} · Direct LAN WebRTC
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCallMinimized(true)}
                  className="px-3 py-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] text-xs font-medium text-[#F5F5F7] inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Minimize2 className="w-3.5 h-3.5" /> Minimize
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-xl bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] transition cursor-pointer"
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Video / Participant Grid */}
            <div className="flex-1 p-6 overflow-y-auto flex items-center justify-center">
              <div className={`grid gap-4 w-full ${gridCols}`}>
                {participants.map((p) => {
                  const isSelf = p.userId === me?.id;
                  return (
                    <StreamTile
                      key={p.userId}
                      userId={p.userId}
                      stream={isSelf ? localStream : remoteStreams[p.userId] || null}
                      isSelf={isSelf}
                      audioOn={isSelf ? localAudio : p.audio}
                      videoOn={isSelf ? localVideo : p.video}
                      speaking={!!speakingUsers[p.userId]}
                    />
                  );
                })}
              </div>
            </div>

            {/* Waiting indicator */}
            {activeCall.invited.length > 0 && (
              <div className="text-center text-xs text-[#9296A3] pb-2">
                Ringing:{' '}
                {activeCall.invited.map((uid) => users[uid]?.displayName || 'Member').join(', ')}
              </div>
            )}

            {/* Controls dock */}
            <div className="py-5 px-6 border-t border-white/[0.07] bg-[#181A20]/80 flex items-center justify-center gap-4">
              <button
                onClick={toggleCallAudio}
                className={`w-13 h-13 rounded-2xl flex items-center justify-center transition cursor-pointer ${
                  localAudio
                    ? 'bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] border border-white/10'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/35'
                }`}
                title={localAudio ? 'Mute microphone' : 'Unmute microphone'}
              >
                {localAudio ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              <button
                onClick={toggleCallVideo}
                className={`w-13 h-13 rounded-2xl flex items-center justify-center transition cursor-pointer ${
                  localVideo
                    ? 'bg-[#6C8CFF] hover:bg-[#7E9BFF] text-white'
                    : 'bg-[#20232B] hover:bg-[#262A34] text-[#F5F5F7] border border-white/10'
                }`}
                title={localVideo ? 'Turn camera off' : 'Turn camera on'}
              >
                {localVideo ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>

              <button
                onClick={leaveCall}
                className="px-6 h-13 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-sm inline-flex items-center gap-2 transition cursor-pointer shadow-lg shadow-rose-500/25"
              >
                <PhoneOff className="w-5 h-5" /> End Call
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function HiddenAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

