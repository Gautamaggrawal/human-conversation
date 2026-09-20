# Human Conversation — V1

## Architecture

- React Native (Expo) clients
- Go monolith: auth verify, presence+lease, matching, WebSocket signaling, billing ledger
- Supabase: Email OTP + Postgres (local Docker Postgres for dev)
- coturn TURN (separable ICE config via `GET /webrtc/ice`)

## Call states

`CALL_MATCHED → CALL_ACCEPTED → WEBRTC_NEGOTIATING → WEBRTC_CONNECTED → MEDIA_CONFIRMED → ACTIVE`

Billing starts at **ACTIVE**. Client telemetry (`*_webrtc_connected_at`, `*_audio_received_at`) is analytics-only.

## Wallet

Buckets: AVAILABLE / HELD / EARNED / PAID_OUT / REFUNDED  
Hold full duration → charge actual minutes → release remainder.

## Presence lease

Heartbeat every 10s, lease TTL 30s. Match requires AVAILABLE + fresh lease + live send channel.

## Local run

```bash
cd infrastructure && docker compose up -d postgres
cd backend && cp .env.example .env && go run ./cmd/server
cd mobile && npm install && npx expo start
cd admin && npm install && npm run dev
```

Dev auth: `POST /auth/dev-login {"email":"..."}` when `DEV_AUTH=true`.

Approve listeners: Admin UI or `POST /admin/listeners/{id}/approve` with `X-Admin-Key`.
