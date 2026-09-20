import { API_URL } from './api';
import { signaling } from './signaling';

export type CallConnectionState =
  | 'idle'
  | 'requesting-mic'
  | 'mic-denied'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'ended';

export type MicErrorCode = 'denied' | 'not-found' | 'in-use' | 'secure-context' | 'unknown';

type IceServer = RTCIceServer;

export class MicPermissionError extends Error {
  code: MicErrorCode;
  constructor(code: MicErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function checkMicPermission(): Promise<PermissionState | 'unsupported'> {
  try {
    if (!navigator.permissions?.query) return 'unsupported';
    const r = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return r.state;
  } catch {
    return 'unsupported';
  }
}

export async function getMicrophoneStream(): Promise<MediaStream> {
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    throw new MicPermissionError(
      'secure-context',
      'Microphone needs HTTPS (or localhost). Open the app via your LAN IP over a secure context, or use localhost.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicPermissionError('unknown', 'This browser does not support microphone access.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new MicPermissionError('denied', 'Microphone permission was blocked. Allow mic access in browser settings and try again.');
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new MicPermissionError('not-found', 'No microphone found on this device.');
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      throw new MicPermissionError('in-use', 'Microphone is in use by another app. Close it and try again.');
    }
    throw new MicPermissionError('unknown', e instanceof Error ? e.message : 'Could not access microphone');
  }
}

async function fetchIceServers(): Promise<IceServer[]> {
  const base = API_URL || '';
  try {
    const res = await fetch(`${base}/webrtc/ice`);
    if (!res.ok) throw new Error('ice http ' + res.status);
    const data = await res.json();
    const list = (data.iceServers ?? []) as IceServer[];
    if (list.length) return list;
  } catch {
    /* fall through */
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

export type BrowserAudioCallOpts = {
  onState?: (state: CallConnectionState) => void;
  onNeedGesture?: () => void;
};

export class BrowserAudioCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private callId: string;
  private isOfferer: boolean;
  private muted = false;
  private pendingRemote: Record<string, unknown>[] = [];
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private opts: BrowserAudioCallOpts;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private ended = false;
  private makingOffer = false;

  constructor(callId: string, isOfferer: boolean, opts: BrowserAudioCallOpts = {}) {
    this.callId = callId;
    this.isOfferer = isOfferer;
    this.opts = opts;
  }

  private setState(s: CallConnectionState) {
    this.opts.onState?.(s);
  }

  async start() {
    this.setState('requesting-mic');
    try {
      this.localStream = await getMicrophoneStream();
    } catch (e) {
      this.setState('mic-denied');
      throw e;
    }

    this.setState('connecting');
    const iceServers = await fetchIceServers();
    this.pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4,
    });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        signaling.send({
          type: 'webrtc.ice',
          call_id: this.callId,
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      if (st === 'connected') {
        this.clearTimers();
        this.setState('connected');
        signaling.send({ type: 'telemetry', call_id: this.callId, field: 'webrtc_connected' });
      } else if (st === 'disconnected') {
        this.setState('reconnecting');
        this.scheduleIceRestart();
      } else if (st === 'failed') {
        this.setState('reconnecting');
        void this.tryIceRestart();
        this.scheduleFail();
      } else if (st === 'closed') {
        this.setState('ended');
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc?.iceConnectionState;
      if (st === 'disconnected') {
        this.setState('reconnecting');
        this.scheduleIceRestart();
      }
      if (st === 'failed') {
        void this.tryIceRestart();
        this.scheduleFail();
      }
    };

    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
        this.remoteAudio.setAttribute('playsInline', 'true');
      }
      this.remoteAudio.srcObject = stream;
      void this.remoteAudio.play().catch(() => {
        this.opts.onNeedGesture?.();
      });
      signaling.send({ type: 'telemetry', call_id: this.callId, field: 'audio_received' });
    };

    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    const pending = this.pendingRemote.splice(0);
    for (const msg of pending) {
      await this.handleRemote(msg);
    }

    if (this.isOfferer) {
      await this.createAndSendOffer(false);
    }

    // Hard fail if we never connect
    this.failTimer = setTimeout(() => {
      if (this.pc?.connectionState !== 'connected' && !this.ended) {
        this.setState('failed');
        signaling.send({ type: 'call.end', call_id: this.callId, reason: 'ICE_TIMEOUT' });
      }
    }, 45000);
  }

  private scheduleIceRestart() {
    if (this.iceRestartTimer) return;
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = null;
      void this.tryIceRestart();
    }, 2500);
  }

  private scheduleFail() {
    if (this.failTimer) return;
    this.failTimer = setTimeout(() => {
      if (this.pc?.connectionState !== 'connected' && !this.ended) {
        this.setState('failed');
        signaling.send({ type: 'call.end', call_id: this.callId, reason: 'ICE_FAILED' });
      }
    }, 15000);
  }

  private clearTimers() {
    if (this.iceRestartTimer) clearTimeout(this.iceRestartTimer);
    this.iceRestartTimer = null;
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = null;
  }

  private async tryIceRestart() {
    if (!this.pc || this.ended || !this.isOfferer) return;
    if (this.pc.connectionState === 'connected') return;
    try {
      await this.createAndSendOffer(true);
    } catch {
      /* ignore */
    }
  }

  private async createAndSendOffer(iceRestart: boolean) {
    if (!this.pc || this.makingOffer) return;
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await this.pc.setLocalDescription(offer);
      signaling.send({
        type: 'webrtc.offer',
        call_id: this.callId,
        sdp: offer.sdp,
        ice_restart: iceRestart,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  async handleRemote(msg: Record<string, unknown>) {
    if (!this.pc) {
      this.pendingRemote.push(msg);
      return;
    }
    if (msg.type === 'webrtc.offer' && !this.isOfferer) {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp as string });
      this.remoteSet = true;
      await this.flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      signaling.send({ type: 'webrtc.answer', call_id: this.callId, sdp: answer.sdp });
      signaling.send({ type: 'telemetry', call_id: this.callId, field: 'audio_sent' });
    } else if (msg.type === 'webrtc.answer' && this.isOfferer) {
      if (this.pc.signalingState === 'have-local-offer' || this.pc.signalingState === 'have-local-pranswer') {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp as string });
        this.remoteSet = true;
        await this.flushIce();
        signaling.send({ type: 'telemetry', call_id: this.callId, field: 'audio_sent' });
      }
    } else if (msg.type === 'webrtc.ice' && msg.candidate) {
      const c = msg.candidate as RTCIceCandidateInit;
      if (!this.remoteSet || !this.pc.remoteDescription) {
        this.pendingIce.push(c);
        return;
      }
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* ignore stale */
      }
    }
  }

  private async flushIce() {
    const batch = this.pendingIce.splice(0);
    for (const c of batch) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }

  /** Call after a user gesture if autoplay was blocked. */
  async unlockAudio() {
    try {
      await this.remoteAudio?.play();
    } catch {
      /* ignore */
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  isMuted() {
    return this.muted;
  }

  async stop() {
    this.ended = true;
    this.clearTimers();
    this.setState('ended');
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    this.pc?.close();
    this.pc = null;
  }
}
