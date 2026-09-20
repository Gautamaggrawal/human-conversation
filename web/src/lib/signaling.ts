import { API_URL, getToken } from './api';

type Handler = (msg: Record<string, unknown>) => void;

export type CallFlags = {
  accepted: boolean;
  status: string;
  ended: boolean;
  incoming?: { duration: number; talkerId?: string };
};

function wsBase(): string {
  if (API_URL) {
    return API_URL.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export class SignalingSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectGeneration = 0;
  private callFlags = new Map<string, CallFlags>();
  private lastIncoming: { callId: string; duration: number; talkerId?: string } | null = null;
  /** When true, unexpected closes trigger reconnect. */
  autoReconnect = false;
  /** Called after every successful open (including reconnect). */
  afterConnect: (() => void) | null = null;

  async connect() {
    const token = getToken();
    if (!token) throw new Error('not authenticated');

    // Already connected — keep the same socket (preserves listener.available lease).
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const t = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(t);
            resolve();
          } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
            clearInterval(t);
            reject(new Error('ws error'));
          }
        }, 50);
      });
      return;
    }

    const gen = ++this.connectGeneration;
    this.teardown(false);

    const url = `${wsBase()}/ws?token=${encodeURIComponent(token)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      const fail = (err: Error) => {
        if (gen !== this.connectGeneration) return;
        reject(err);
      };

      ws.onopen = () => {
        if (gen !== this.connectGeneration) {
          ws.close();
          return;
        }
        this.heartbeat = setInterval(() => this.send({ type: 'heartbeat' }), 10000);
        try {
          this.afterConnect?.();
        } catch {
          /* ignore */
        }
        resolve();
      };
      ws.onerror = () => fail(new Error('ws error'));
      ws.onclose = () => {
        if (gen !== this.connectGeneration) return;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.ws = null;
        if (this.autoReconnect && getToken()) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {});
          }, 1200);
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          this.noteCallEvent(msg);
          this.handlers.forEach((h) => h(msg));
        } catch {
          /* ignore */
        }
      };
    });
  }

  private noteCallEvent(msg: Record<string, unknown>) {
    const callId = msg.call_id != null ? String(msg.call_id) : '';
    if (msg.type === 'call.incoming') {
      this.lastIncoming = {
        callId,
        duration: Number(msg.duration) || 600,
        talkerId: msg.talker_id != null ? String(msg.talker_id) : undefined,
      };
      if (callId) {
        const f = this.callFlags.get(callId) || { accepted: false, status: '', ended: false };
        f.incoming = { duration: this.lastIncoming.duration, talkerId: this.lastIncoming.talkerId };
        this.callFlags.set(callId, f);
      }
    }
    if (!callId) return;
    const f = this.callFlags.get(callId) || { accepted: false, status: '', ended: false };
    if (msg.type === 'call.accepted') f.accepted = true;
    if (msg.type === 'call.state') f.status = String(msg.status || '');
    if (msg.type === 'call.ended') f.ended = true;
    if (
      msg.type === 'call.state' &&
      (msg.status === 'CALL_ACCEPTED' ||
        msg.status === 'WEBRTC_NEGOTIATING' ||
        msg.status === 'WEBRTC_CONNECTED' ||
        msg.status === 'MEDIA_CONFIRMED' ||
        msg.status === 'ACTIVE')
    ) {
      f.accepted = true;
    }
    this.callFlags.set(callId, f);
  }

  getCallFlags(callId: string): CallFlags | undefined {
    return this.callFlags.get(callId);
  }

  peekIncoming() {
    return this.lastIncoming;
  }

  clearIncoming(callId?: string) {
    if (!callId || this.lastIncoming?.callId === callId) {
      this.lastIncoming = null;
    }
  }

  onMessage(handler: Handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private teardown(stopReconnect = true) {
    if (stopReconnect && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  async disconnect() {
    this.autoReconnect = false;
    this.connectGeneration++;
    this.teardown(true);
  }

  /** Force a fresh socket (e.g. after logout). */
  async reconnect() {
    this.connectGeneration++;
    this.teardown(false);
    await this.connect();
  }
}

export const signaling = new SignalingSocket();
