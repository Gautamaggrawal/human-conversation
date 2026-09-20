import { api } from './api';
import { signaling } from './signaling';

const PREF_KEY = 'hc_listener_available';

export function isListenerAvailablePreferred(): boolean {
  return localStorage.getItem(PREF_KEY) === '1';
}

export function setListenerAvailablePreferred(on: boolean) {
  if (on) localStorage.setItem(PREF_KEY, '1');
  else localStorage.removeItem(PREF_KEY);
}

function announceAvailable() {
  if (!isListenerAvailablePreferred()) return;
  signaling.send({ type: 'listener.available' });
}

// After every WS open (including auto-reconnect), re-announce if still opted in.
signaling.afterConnect = () => {
  announceAvailable();
};

/** Re-announce AVAILABLE if the user opted in (after refresh / reconnect / call end). */
export async function ensureListenerPresence(): Promise<boolean> {
  if (!isListenerAvailablePreferred()) return false;
  try {
    await goListenerOnline({ persist: false });
    return true;
  } catch {
    return false;
  }
}

export async function goListenerOnline(opts?: { persist?: boolean }): Promise<void> {
  if (opts?.persist !== false) setListenerAvailablePreferred(true);
  signaling.autoReconnect = true;
  await api('/listeners/apply', { method: 'POST', body: '{}' });
  await signaling.connect();
  signaling.send({ type: 'listener.available' });
  // wait briefly for ack / error
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), 1500);
    const off = signaling.onMessage((msg) => {
      if (msg.type === 'listener.available.ack') {
        clearTimeout(t);
        off();
        resolve();
      }
      if (msg.type === 'error') {
        clearTimeout(t);
        off();
        reject(new Error(String(msg.reason || 'LISTENER_ERROR')));
      }
    });
  });
}

export async function goListenerOffline(): Promise<void> {
  setListenerAvailablePreferred(false);
  signaling.autoReconnect = false;
  signaling.send({ type: 'listener.offline' });
}
