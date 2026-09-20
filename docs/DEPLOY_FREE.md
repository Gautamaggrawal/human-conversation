# Deploy for free
#
# You cannot run a reliable public **coturn** on most free PaaS (no UDP / no
# public IP). Use **hosted free TURN** instead, and put API + web on free tiers.
#
## Recommended free stack
#
# | Piece   | Free option                         | Notes |
# |---------|-------------------------------------|-------|
# | Auth+DB | **Supabase** (you already have it)  | Use Supabase Postgres for the app DB |
# | Web     | **Cloudflare Pages** or Netlify     | Static Vite build |
# | API     | **Render** free (or Fly.io)           | See DEPLOY_RENDER.md; free sleeps |

# | TURN    | **Metered Open Relay**              | 20 GB/mo free — no coturn VPS |
#
# Skip self-hosted coturn and `docker-compose.prod.yml` unless you get a free
# always-on VM (e.g. Oracle Cloud Always Free).
#
## 1. Database → Supabase Postgres
#
# Supabase → Project Settings → Database → Connection string (URI).
# Point the API at it (Transaction / Session pooler is fine for Go):
#
#   DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-….pooler.supabase.com:6543/postgres
#
# Run migrations once (from your laptop against that URL):
#
#   cd backend && psql "$DATABASE_URL" -f migrations/001_init.sql
#
# (Or use any SQL client / Supabase SQL editor and paste the migration.)
#
## 2. TURN → Open Relay (free)
#
# Sign up at https://www.metered.ca/tools/openrelay/ for an API key, **or**
# start with the public demo credentials (fine for early testing):
#
# In API env:
#
#   STUN_URLS=stun:stun.l.google.com:19302,stun:openrelay.metered.ca:80
#   TURN_URLS=turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turns:openrelay.metered.ca:443
#   TURN_USERNAME=openrelayproject
#   TURN_PASSWORD=openrelayproject
#   TURN_PUBLIC_HOST=
#
# Leave TURN_PUBLIC_HOST empty so hosts are not rewritten.
#
## 3. API → Render (free) — current path
#
# Full steps: [DEPLOY_RENDER.md](DEPLOY_RENDER.md)
#
# Blueprint: root `render.yaml` → New → Blueprint on Render.
# Or Web Service, rootDir `backend`, Docker, free plan, secrets for
# DATABASE_URL / SUPABASE_* / ADMIN_API_KEY.
#
# Then set web `VITE_API_URL=https://YOUR-SERVICE.onrender.com`
#
## 3b. API → Fly.io (if account verified)
#
# Full steps: [DEPLOY_FLY.md](DEPLOY_FLY.md)
# 4. Runtime: Docker (uses `backend/Dockerfile`) **or**
#    Build: `go build -o server ./cmd/server`
#    Start: `./server`
# 5. Env vars (minimum):
#      HTTP_ADDR=:8081
#      DATABASE_URL=… (Supabase)
#      SUPABASE_URL=https://….supabase.co
#      SUPABASE_JWT_SECRET=…
#      DEV_AUTH=false
#      AUTO_APPROVE_LISTENERS=false
#      ADMIN_API_KEY=…
#      STUN_URLS / TURN_* as above
# 6. Health check path: `/health`
#
# Free Render services **sleep** when idle — first request is slow; long
# WebSocket leases may drop. For always-on free, prefer Fly.io free allowance
# or Oracle Always Free VM.
#
## 4. Web → Cloudflare Pages (free)
#
# Build settings:
#   Framework: Vite
#   Root: web
#   Build: npm install && npm run build
#   Output: dist
#
# Env (build-time):
#   VITE_API_URL=https://YOUR-API.onrender.com
#   VITE_SUPABASE_URL=https://….supabase.co
#   VITE_SUPABASE_ANON_KEY=…
#
# Leave VITE_API_URL pointing at the public API (HTTPS). Signaling will use
# wss:// automatically.
#
## 5. Supabase Auth URLs
#
# Authentication → URL Configuration:
#   Site URL:     https://YOUR-PAGES.pages.dev
#   Redirect URLs:
#     https://YOUR-PAGES.pages.dev
#     https://YOUR-PAGES.pages.dev/**
#
## 6. Smoke test
#
# 1. Open the Pages URL → email OTP
# 2. Two browsers / accounts → Available + Talk now
# 3. If audio fails across networks, confirm TURN URLs in
#    GET https://YOUR-API/webrtc/ice
#
## Limits (be aware)
#
# - Open Relay: ~20 GB TURN / month
# - Render free: cold starts, sleep
# - Supabase free: DB size / egress caps
# - For a always-free single box (API+web+coturn): Oracle Cloud Always Free
#   ARM VM + docs/DEPLOY.md (not “PaaS”, but $0)
#
## Fastest path today
#
# 1. Migrate DB to Supabase Postgres  
# 2. Deploy API on Render with Open Relay TURN env  
# 3. Deploy web on Cloudflare Pages with VITE_API_URL  
# 4. Update Supabase redirect URLs  
#
# Say which account you want to use (Render / Fly / Cloudflare) and we can
# fill the exact env values from your existing Supabase project.
