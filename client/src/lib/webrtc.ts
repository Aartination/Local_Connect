import { getSocket } from './socket';

export interface PeerConnectionBundle {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  stream: MediaStream;
  makingOffer: boolean;
}

type StreamsListener = (streams: Record<string, MediaStream>) => void;
type SpeakingListener = (speaking: Record<string, boolean>) => void;

/**
 * Pure-LAN WebRTC Mesh Engine (1-to-1 and up to 5-member group audio/video).
 * Uses zero external STUN/TURN servers — host candidates connect directly on the LAN.
 */
class WebRtcManager {
  private callId: string | null = null;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerConnectionBundle>();
  private audioEnabled = true;
  private videoEnabled = false;
  private onStreams: StreamsListener | null = null;
  private onSpeaking: SpeakingListener | null = null;
  private analyserCtx: AudioContext | null = null;
  private analysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private speakingTimer: number | null = null;
  private speakingState: Record<string, boolean> = {};
  private localUserId = '';

  setListeners(onStreams: StreamsListener, onSpeaking: SpeakingListener) {
    this.onStreams = onStreams;
    this.onSpeaking = onSpeaking;
  }

  getLocalStream() {
    return this.localStream;
  }

  isMediaSupported(): { ok: boolean; reason?: string } {
    if (typeof window === 'undefined') return { ok: false, reason: 'Browser environment required.' };
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return {
        ok: false,
        reason:
          'Browsers require HTTPS to access the microphone or camera over a LAN IP. Switch to the HTTPS address shown in Settings or on the Login page.',
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'Your browser does not support WebRTC media capture.' };
    }
    return { ok: true };
  }

  async acquireMedia(wantVideo: boolean): Promise<MediaStream> {
    const check = this.isMediaSupported();
    if (!check.ok) throw new Error(check.reason);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      });
      this.localStream = stream;
      this.audioEnabled = true;
      this.videoEnabled = stream.getVideoTracks().length > 0;
      this.attachAnalyser(this.localUserId || 'local', stream);
      return stream;
    } catch (err: any) {
      if (wantVideo) {
        // Fallback to audio-only if user has no webcam
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          this.localStream = audioOnly;
          this.audioEnabled = true;
          this.videoEnabled = false;
          this.attachAnalyser(this.localUserId || 'local', audioOnly);
          return audioOnly;
        } catch {
          /* fall through */
        }
      }
      if (err?.name === 'NotAllowedError') {
        throw new Error('Microphone/camera permission was denied. Allow access in your browser address bar.');
      }
      if (err?.name === 'NotFoundError') {
        throw new Error('No microphone or camera was found on this computer.');
      }
      throw new Error(err?.message || 'Could not access microphone/camera.');
    }
  }

  async begin(callId: string, myUserId: string, wantVideo: boolean, peersToOffer: string[]) {
    const existingStream = this.localStream;
    this.localStream = null; // preserve stream across cleanup
    this.cleanup();
    this.callId = callId;
    this.localUserId = myUserId;
    if (existingStream && existingStream.active) {
      this.localStream = existingStream;
      this.audioEnabled = existingStream.getAudioTracks().some((t) => t.enabled);
      this.videoEnabled = existingStream.getVideoTracks().some((t) => t.enabled);
      this.attachAnalyser(myUserId, existingStream);
    } else {
      await this.acquireMedia(wantVideo);
    }
    this.startSpeakingMonitor();
    for (const peerId of peersToOffer) {
      await this.createOfferTo(peerId);
    }
  }

  private getOrCreatePeer(peerId: string): PeerConnectionBundle {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: [] });
    const stream = new MediaStream();
    const bundle: PeerConnectionBundle = { pc, pendingIce: [], stream, makingOffer: false };
    this.peers.set(peerId, bundle);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.callId) {
        getSocket()?.emit('call:signal', {
          callId: this.callId,
          toUserId: peerId,
          payload: { type: 'ice', candidate: ev.candidate.toJSON() },
        });
      }
    };

    pc.ontrack = (ev) => {
      const targetStream = ev.streams[0] || bundle.stream;
      if (ev.streams[0]) {
        bundle.stream = ev.streams[0];
      } else if (!bundle.stream.getTrackById(ev.track.id)) {
        bundle.stream.addTrack(ev.track);
      }
      this.attachAnalyser(peerId, targetStream);
      this.emitStreams();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerId);
      }
    };

    return bundle;
  }

  async createOfferTo(peerId: string) {
    if (!this.callId) return;
    const bundle = this.getOrCreatePeer(peerId);
    try {
      bundle.makingOffer = true;
      const offer = await bundle.pc.createOffer();
      await bundle.pc.setLocalDescription(offer);
      getSocket()?.emit('call:signal', {
        callId: this.callId,
        toUserId: peerId,
        payload: { type: 'sdp', description: bundle.pc.localDescription },
      });
    } finally {
      bundle.makingOffer = false;
    }
  }

  async handleSignal(callId: string, fromUserId: string, payload: any) {
    if (callId !== this.callId || !payload) return;
    const bundle = this.getOrCreatePeer(fromUserId);
    const { pc } = bundle;

    if (payload.type === 'sdp' && payload.description) {
      const desc = payload.description as RTCSessionDescriptionInit;
      const polite = this.localUserId < fromUserId;
      const offerCollision = desc.type === 'offer' && (bundle.makingOffer || pc.signalingState !== 'stable');
      if (offerCollision && !polite) return;

      await pc.setRemoteDescription(desc);
      // Drain buffered ICE candidates
      for (const ice of bundle.pendingIce.splice(0)) {
        await pc.addIceCandidate(ice).catch(() => {});
      }

      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket()?.emit('call:signal', {
          callId: this.callId,
          toUserId: fromUserId,
          payload: { type: 'sdp', description: pc.localDescription },
        });
      }
    } else if (payload.type === 'ice' && payload.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(payload.candidate).catch(() => {});
      } else {
        bundle.pendingIce.push(payload.candidate);
      }
    }
  }

  removePeer(peerId: string) {
    const bundle = this.peers.get(peerId);
    if (!bundle) return;
    bundle.pc.close();
    this.peers.delete(peerId);
    this.analysers.delete(peerId);
    delete this.speakingState[peerId];
    this.emitStreams();
  }

  toggleAudio(): boolean {
    this.audioEnabled = !this.audioEnabled;
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = this.audioEnabled;
    }
    if (this.callId) {
      getSocket()?.emit('call:media', { callId: this.callId, audio: this.audioEnabled, video: this.videoEnabled });
    }
    return this.audioEnabled;
  }

  async toggleVideo(): Promise<boolean> {
    if (!this.localStream) return false;
    const existing = this.localStream.getVideoTracks()[0];
    if (existing) {
      this.videoEnabled = !this.videoEnabled;
      existing.enabled = this.videoEnabled;
    } else {
      // Acquire camera mid-call and add to all peers with renegotiation
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const vTrack = cam.getVideoTracks()[0];
      if (!vTrack) return false;
      this.localStream.addTrack(vTrack);
      this.videoEnabled = true;
      for (const [peerId, bundle] of this.peers.entries()) {
        bundle.pc.addTrack(vTrack, this.localStream);
        await this.createOfferTo(peerId);
      }
    }
    if (this.callId) {
      getSocket()?.emit('call:media', { callId: this.callId, audio: this.audioEnabled, video: this.videoEnabled });
    }
    this.emitStreams();
    return this.videoEnabled;
  }

  private emitStreams() {
    const map: Record<string, MediaStream> = {};
    for (const [uid, b] of this.peers.entries()) map[uid] = b.stream;
    this.onStreams?.(map);
  }

  private attachAnalyser(id: string, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) return;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      if (!this.analyserCtx) this.analyserCtx = new Ctor();
      if (this.analyserCtx.state === 'suspended') this.analyserCtx.resume().catch(() => {});
      const source = this.analyserCtx.createMediaStreamSource(stream);
      const analyser = this.analyserCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analysers.set(id, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
    } catch {
      /* ignore */
    }
  }

  private startSpeakingMonitor() {
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    this.speakingTimer = window.setInterval(() => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, { analyser, data }] of this.analysers.entries()) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const speaking = avg > 18 && (id !== this.localUserId || this.audioEnabled);
        next[id] = speaking;
        if (this.speakingState[id] !== speaking) changed = true;
      }
      if (changed) {
        this.speakingState = next;
        this.onSpeaking?.({ ...next });
      }
    }, 180);
  }

  cleanup() {
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
    for (const b of this.peers.values()) b.pc.close();
    this.peers.clear();
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    this.analysers.clear();
    if (this.analyserCtx) {
      this.analyserCtx.close().catch(() => {});
      this.analyserCtx = null;
    }
    this.callId = null;
    this.audioEnabled = true;
    this.videoEnabled = false;
    this.speakingState = {};
    this.onStreams?.({});
    this.onSpeaking?.({});
  }
}

export const rtc = new WebRtcManager();
