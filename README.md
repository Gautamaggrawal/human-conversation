# Human Conversation

Open the app, choose 10/20/30 minutes, and get connected to a real person for an audio conversation.

## Clients

| Path | Purpose |
|------|---------|
| `web/` | **Primary UI** — Figma design (Vite + React + Tailwind), wired to Go API |
| `mobile/` | React Native (Expo) — same flows for native later |
| `backend/` | Go monolith |
| `admin/` | Ops dashboard |
| `infrastructure/` | Postgres + coturn |

### Web UI (Figma)

```bash
cd web && npm install && npm run dev
# open http://localhost:5173
# Dev OTP: if Supabase is not configured, enter any 6-digit code (not 000000).
# With VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY set, a real email code is required.
```

Auth → profile → Talk now → match → call → rate.
Requires backend on `:8081` and an approved online listener for live calls.

Cross-network / phone testing: see [docs/TWO_DEVICE.md](docs/TWO_DEVICE.md).

## Deploy (VPS)

Single-host stack: web (nginx) + Go API + Postgres + coturn.

See [docs/DEPLOY.md](docs/DEPLOY.md).

```bash
cp infrastructure/.env.prod.example infrastructure/.env.prod
# set PUBLIC_HOST, EXTERNAL_IP, Supabase keys, passwords
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod up -d --build
```

### Deploy for free (no VPS)

Use Supabase DB + free TURN (Open Relay) + free API/web hosts —  
see [docs/DEPLOY_FREE.md](docs/DEPLOY_FREE.md).

**API on Render (free):** [docs/DEPLOY_RENDER.md](docs/DEPLOY_RENDER.md) (`render.yaml`).  
**API on Fly.io:** [docs/DEPLOY_FLY.md](docs/DEPLOY_FLY.md) (`backend/fly.toml`).


## Stack (locked)

- Auth: Supabase Email OTP when `VITE_SUPABASE_*` is set; otherwise local `DEV_AUTH` / `POST /auth/dev-login`
- DB: Postgres (Supabase or local Docker on **5433**)
- Realtime: Go WebSocket + in-memory presence (10s heartbeat / 30s lease)
- Media: WebRTC P2P + TURN via `GET /webrtc/ice` (coturn separable)
- Money: ledger buckets AVAILABLE/HELD/EARNED/PAID_OUT/REFUNDED; usage billing

## Auth setup

See [docs/SUPABASE_AUTH.md](docs/SUPABASE_AUTH.md). Local default: leave Supabase env empty and use any 6-digit OTP.
## Quick start

```bash
# DB
cd infrastructure && docker compose up -d postgres

# API (default :8081)
cd backend && cp .env.example .env && go run ./cmd/server

# Mobile
cd mobile && npm install && npx expo start
# Real audio needs a custom Expo dev client (react-native-webrtc).

# Admin
cd admin && npm install && npm run dev
```

Approve listeners in Admin (`X-Admin-Key: dev-admin-key`) before they can go online.

## Smoke test

```bash
# with server running on :8081
node backend/scripts/smoke_call.js
```

## Call states

`CALL_MATCHED → CALL_ACCEPTED → WEBRTC_NEGOTIATING → WEBRTC_CONNECTED → MEDIA_CONFIRMED → ACTIVE`

Billing clock starts at **ACTIVE**. First-audio timestamps are client telemetry only.
# human-conversation
