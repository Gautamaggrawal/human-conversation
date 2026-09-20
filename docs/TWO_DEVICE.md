# Two-device / cross-network call test

Hardens WebRTC so a phone on cellular (or another Wi‑Fi) can talk to a laptop via **coturn TURN**.

## 1. Start infra

```bash
# Postgres (if not already up)
cd infrastructure && docker compose up -d postgres

# coturn (UDP 3478 + relay ports)
docker compose up -d coturn
```

Find your machine’s LAN IP:

```bash
hostname -I | awk '{print $1}'
# e.g. 192.168.1.42
```

Optional: pin TURN to that IP in `backend/.env`:

```
TURN_PUBLIC_HOST=192.168.1.42
TURN_URLS=turn:192.168.1.42:3478
```

If coturn can’t be reached from the phone, set `external-ip=<LAN_IP>` in
`infrastructure/coturn/turnserver.conf` and restart coturn.

## 2. API + web (reachable on LAN)

```bash
cd backend && go run ./cmd/server
cd web && npm run dev
# Vite already binds 0.0.0.0:5173
```

## 3. Devices

| Role | Device | URL |
|------|--------|-----|
| Listener | Laptop browser | `http://192.168.1.42:5173` |
| Talker | Phone (other network / LTE) | `http://192.168.1.42:5173` |

1. Laptop: log in → **Profile → Available to talk** (stays on).
2. Phone: different account → **Talk now** → Accept on laptop.
3. Both should hear audio. Status may briefly show **Reconnecting…** while ICE/TURN settles.

## 4. What “hardened” covers

- ICE list rewrites `localhost` → request host / `TURN_PUBLIC_HOST` so phones don’t get `turn:localhost`.
- TURN TCP candidate advertised alongside UDP.
- ICE candidate buffering until remote SDP is set.
- `iceRestart` on disconnect/failed; fail call after timeout.
- Hangup is idempotent; WS drop ends the call (`PEER_DISCONNECTED`).
- Mic preflight with clear errors + in-call **Allow mic & retry** / **Tap to hear them**.

## 5. Sanity check ICE payload

From the phone’s browser (or curl with the LAN Host):

```bash
curl -s http://192.168.1.42:5173/webrtc/ice | jq .
# urls should show turn:192.168.1.42:3478 — not localhost
```

## Notes

- Mobile browsers require a **secure context** for mic except localhost. Same-LAN `http://IP` often works on Android Chrome; iOS Safari may require HTTPS for mic on non-localhost.
- Firewall: allow UDP **3478** and **49152–49200** inbound to the host running coturn.
