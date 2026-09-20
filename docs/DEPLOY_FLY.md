# Deploy API on Fly.io
#
## 1. Install CLI + login
#
#   curl -L https://fly.io/install.sh | sh
#   fly auth login
#
## 2. App + region
#
# From repo:
#
#   cd backend
#   fly launch --copy-config --no-deploy
#
# Pick region near users (India → bom). Confirm app name in fly.toml.
#
## 3. Secrets (do not commit)
#
# Use Supabase Postgres URI + JWT secret from your project:
#
#   fly secrets set \
#     DATABASE_URL='postgresql://…' \
#     SUPABASE_URL='https://ijfoecnziydlwgahhhtb.supabase.co' \
#     SUPABASE_JWT_SECRET='…' \
#     ADMIN_API_KEY='…'
#
# Optional: replace Open Relay demo TURN with your Metered keys:
#
#   fly secrets set TURN_USERNAME='…' TURN_PASSWORD='…'
#
## 4. Database migrations
#
# Run once against Supabase (SQL editor or local psql):
#   backend/migrations/001_init.sql
#
## 5. Deploy
#
#   fly deploy
#
# Health: https://human-conversation-api.fly.dev/health
#
## 6. Point the web app at Fly
#
# Build / Pages env:
#   VITE_API_URL=https://human-conversation-api.fly.dev
#   VITE_SUPABASE_URL=…
#   VITE_SUPABASE_ANON_KEY=…
#
# Supabase Auth → URL Configuration: add your Pages / GitHub Pages origin.
#
## 7. Free-tier notes
#
# - shared-cpu-1x / 256mb is enough for early traffic
# - auto_stop_machines=stop saves allowance; first request after idle wakes the VM
# - For fewer WS drops, set min_machines_running = 1 (uses more free credit)
#
## 8. Logs
#
#   fly logs
#   fly status
