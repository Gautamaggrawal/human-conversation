# Deploy API on Render (free)
#
## Limits
#
# - Free web services **sleep** after ~15 minutes idle
# - First request after sleep is slow; WebSockets may drop when the service sleeps
# - Fine for demos; Fly is better if you need always-on presence
#
## 1. Prep
#
# 1. Push this repo to GitHub (Render deploys from Git)
# 2. Run `backend/migrations/001_init.sql` once on **Supabase Postgres**
# 3. Have ready:
#    - DATABASE_URL (Supabase → Settings → Database → URI)
#    - SUPABASE_URL (https://ijfoecnziydlwgahhhtb.supabase.co)
#    - SUPABASE_JWT_SECRET (Legacy JWT secret)
#    - ADMIN_API_KEY (any strong string)
#
## 2. Create the service
#
### Option A — Blueprint
#
# 1. https://dashboard.render.com → New → Blueprint
# 2. Connect the repo (uses root `render.yaml`)
# 3. Fill secret env vars when prompted
#
### Option B — Manual Web Service
#
# 1. New → Web Service → connect repo
# 2. Settings:
#      Root Directory: (leave EMPTY)
#      Runtime: Docker
#      Dockerfile Path: ./Dockerfile
#      Instance type: Free
#      Region: Singapore (or closest)
#      Health Check Path: /health
# 3. Environment (see below)
#
## 3. Environment variables
#
# | Key | Value |
# |-----|--------|
# | HTTP_ADDR | :8081 |
# | DATABASE_URL | postgresql://… (Supabase) |
# | SUPABASE_URL | https://ijfoecnziydlwgahhhtb.supabase.co |
# | SUPABASE_JWT_SECRET | (Legacy JWT secret) |
# | DEV_AUTH | false |
# | AUTO_APPROVE_LISTENERS | false |
# | ADMIN_API_KEY | (choose one) |
# | STUN_URLS | stun:stun.l.google.com:19302,stun:openrelay.metered.ca:80 |
# | TURN_URLS | turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turns:openrelay.metered.ca:443 |
# | TURN_USERNAME | openrelayproject |
# | TURN_PASSWORD | openrelayproject |
# | TURN_PUBLIC_HOST | (leave empty) |
#
## 4. Deploy + verify
#
# After deploy succeeds:
#
#   curl https://YOUR-SERVICE.onrender.com/health
#   # expect {"ok":true}
#
## 5. Point the web app at Render
#
#   VITE_API_URL=https://YOUR-SERVICE.onrender.com
#   VITE_SUPABASE_URL=…
#   VITE_SUPABASE_ANON_KEY=…
#
# Supabase Auth → URL Configuration: add your Pages / local origin.
#
## 6. GitHub Pages (optional frontend)
#
# Build with VITE_API_URL set to the Render URL, publish `web/dist`.
#
## Troubleshooting
#
# - Build fails on Go version: ensure `backend/Dockerfile` uses golang:1.25-alpine
# - DB connection errors: use Supabase **pooler** URI (port 6543) if direct 5432 is blocked
# - CORS: API already allows `*` for browser calls from Pages
# - Sleeping service: hit /health once to wake, then open the app
