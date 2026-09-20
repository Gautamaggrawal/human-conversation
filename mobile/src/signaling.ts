import { WS_URL } from './config';
import { getToken } from './api';

type Handler = (msg: any) => void;

export class SignalingSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async connect() {
    const token = await getToken();
    if (!token) throw new Error('not authenticated');
    await this.disconnect();
    this.ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        this.handlers.forEach((h) => h(msg));
      } catch {
        /* ignore */
      }
    };
    this.ws.onopen = () => {
      this.heartbeatTimer = setInterval(() => {
        this.send({ type: 'heartbeat' });
      }, 10000);
    };
    return new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('no ws'));
      this.ws.onopen = () => {
        this.heartbeatTimer = setInterval(() => {
          this.send({ type: 'heartbeat' });
        }, 10000);
        resolve();
      };
      this.ws.onerror = () => reject(new Error('ws error'));
    });
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

  async disconnect() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}

export const signaling = new SignalingSocket();
