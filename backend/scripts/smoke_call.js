#!/usr/bin/env node
/**
 * Smoke test: listener online → talker request → accept → telemetry → end
 */
const WebSocket = require('ws');

const API = process.env.API_URL || 'http://localhost:8081';

async function login(email) {
  const res = await fetch(`${API}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(text);
  return data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitFor(ws, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + type)), timeoutMs);
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
  });
}

(async () => {
  const talker = await login('talker-smoke@test.com');
  const listener = await login('listener-smoke@test.com');
  await api(talker.access_token, '/wallet/purchase', {
    method: 'POST',
    body: JSON.stringify({ credits: 1000 }),
  });
  await api(listener.access_token, '/listeners/apply', { method: 'POST', body: '{}' });

  const approve = await fetch(`${API}/admin/listeners/${listener.user_id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': 'dev-admin-key' },
  });
  if (!approve.ok) throw new Error('approve failed ' + (await approve.text()));

  const lws = await connect(listener.access_token);
  const tws = await connect(talker.access_token);

  const heartbeat = setInterval(() => {
    lws.send(JSON.stringify({ type: 'heartbeat' }));
    tws.send(JSON.stringify({ type: 'heartbeat' }));
  }, 5000);

  lws.send(JSON.stringify({ type: 'listener.available' }));
  await waitFor(lws, 'listener.available.ack');

  const incomingP = waitFor(lws, 'call.incoming');
  tws.send(JSON.stringify({ type: 'call.request', duration: 600 }));
  const matched = await waitFor(tws, 'call.matched');
  const incoming = await incomingP;
  console.log('matched', matched.call_id);

  lws.send(JSON.stringify({ type: 'call.accept', call_id: incoming.call_id }));
  await waitFor(tws, 'call.accepted');

  for (const ws of [tws, lws]) {
    ws.send(JSON.stringify({ type: 'telemetry', call_id: matched.call_id, field: 'webrtc_connected' }));
    ws.send(JSON.stringify({ type: 'telemetry', call_id: matched.call_id, field: 'audio_received' }));
  }

  // wait for ACTIVE or grace
  await new Promise((r) => setTimeout(r, 3000));

  tws.send(JSON.stringify({ type: 'call.end', call_id: matched.call_id }));
  const ended = await waitFor(tws, 'call.ended');
  console.log('ended', ended);

  const wallet = await api(talker.access_token, '/wallet');
  console.log('talker wallet', wallet);

  clearInterval(heartbeat);
  lws.close();
  tws.close();
  console.log('SMOKE OK');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
