import { API_URL } from './config';
import { signaling } from './signaling';

/**
 * WebRTC audio session.
 * Uses react-native-webrtc when available (custom Expo dev client).
 * Falls back to a stub that still drives signaling/telemetry for UI development.
 */

type IceServer = { urls: string | string[]; username?: string; credential?: string };

async function fetchIceServers(): Promise<IceServer[]> {
  const res = await fetch(`${API_URL}/webrtc/ice`);
  if (!res.ok) {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  const data = await res.json();
  return data.iceServers ?? [];
}

let RTCPeerConnection: any;
let mediaDevices: any;
let webrtcAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webrtc = require('react-native-webrtc');
  RTCPeerConnection = webrtc.RTCPeerConnection;
  mediaDevices = webrtc.mediaDevices;
  webrtcAvailable = true;
} catch {
  webrtcAvailable = false;
}

export class AudioCallSession {
  private pc: any = null;
  private localStream: any = null;
  private callId: string;
  private isOfferer: boolean;
  private muted = false;

  constructor(callId: string, isOfferer: boolean) {
    this.callId = callId;
    this.isOfferer = isOfferer;
  }

  async start() {
    if (!webrtcAvailable) {
      // Stub: report telemetry so call can advance in server grace path
      signaling.send({ type: 'telemetry', call_id: this.callId, field: 'webrtc_connected' });
      setTimeout(() => {
        signaling.send({ type: 'telemetry', call_id: this.callId, field: 'audio_received' });
      }, 500);
      return { stub: true };
    }

    const iceServers = await fetchIceServers();
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.onicecandidate = (ev: any) => {
      if (ev.candidate) {
        signaling.send({
          type: 'webrtc.ice',
          call_id: this.callId,
          candidate: ev.candidate,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'connected') {
        signaling.send({ type: 'telemetry', call_id: this.callId, field: 'webrtc_connected' });
      }
    };

    this.pc.ontrack = () => {
      signaling.send({ type: 'telemetry', call_id: this.callId, field: 'audio_received' });
    };

    this.localStream = await mediaDevices.getUserMedia({ audio: true, video: false });
    this.localStream.getTracks().forEach((track: any) => {
      this.pc.addTrack(track, this.localStream);
    });

    if (this.isOfferer) {
      const offer = await this.pc.createOffer({});
      await this.pc.setLocalDescription(offer);
      signaling.send({ type: 'webrtc.offer', call_id: this.callId, sdp: offer.sdp });
    }

    return { stub: false };
  }

  async handleRemote(msg: any) {
    if (!this.pc) return;
    if (msg.type === 'webrtc.offer' && !this.isOfferer) {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      signaling.send({ type: 'webrtc.answer', call_id: this.callId, sdp: answer.sdp });
    } else if (msg.type === 'webrtc.answer' && this.isOfferer) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'webrtc.ice' && msg.candidate) {
      try {
        await this.pc.addIceCandidate(msg.candidate);
      } catch {
        /* ignore */
      }
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.localStream?.getAudioTracks()?.forEach((t: any) => {
      t.enabled = !muted;
    });
  }

  isMuted() {
    return this.muted;
  }

  async stop() {
    this.localStream?.getTracks()?.forEach((t: any) => t.stop());
    this.pc?.close();
    this.pc = null;
  }
}

export function isWebRTCNativeAvailable() {
  return webrtcAvailable;
}
