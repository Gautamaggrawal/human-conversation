# Deploy — API + web + coturn (single VPS)
#
# Want $0 hosting without a VPS? See [DEPLOY_FREE.md](DEPLOY_FREE.md)
# (Supabase DB + Open Relay TURN + Render/Pages).
#
# Coturn needs a **public IP** and open UDP ports, so the simplest production
# shape is one VPS running the full Docker Compose stack.
#
## Prerequisites
#
# - A VPS (Ubuntu 22.04+ recommended) with a public IPv4
# - Docker + Docker Compose plugin
# - DNS A record optional (can use raw IP first)
# - Supabase project (Email OTP + SMTP already working locally)
#
## 1. Firewall
#
# Open:
#   - 80/tcp   (web + API via nginx)
#   - 443/tcp  (later, if you add TLS)
#   - 3478/tcp and 3478/udp  (TURN)
#   - 49152-49200/udp        (TURN relays)
#
# Example (ufw):
#   ufw allow 80/tcp
#   ufw allow 3478/tcp
#   ufw allow 3478/udp
#   ufw allow 49152:49200/udp
#   ufw enable
#
## 2. Configure
#
#   cp infrastructure/.env.prod.example infrastructure/.env.prod
#   # edit PUBLIC_HOST, EXTERNAL_IP, Postgres password, Supabase keys, TURN password
#
# PUBLIC_HOST = what browsers use (domain or IP)
# EXTERNAL_IP = the VPS public IPv4 (required for coturn)
#
## 3. Supabase redirect URLs
#
# Authentication → URL Configuration — add:
#   http://PUBLIC_HOST
#   https://PUBLIC_HOST   (once TLS is on)
# Site URL → your production URL
#
## 4. Launch
#
# From the repo root:
#
#   docker compose -f infrastructure/docker-compose.prod.yml \
#     --env-file infrastructure/.env.prod up -d --build
#
# Check:
#   curl http://PUBLIC_HOST/health
#   open http://PUBLIC_HOST in a browser → email OTP → Talk now
#
## 5. What runs
#
# | Service  | Role                                      |
# |----------|-------------------------------------------|
# | postgres | App DB                                    |
# | api      | Go monolith (:8081 internal)              |
# | web      | nginx SPA + reverse proxy /api /ws        |
# | coturn   | TURN (host network, EXTERNAL_IP)          |
#
# WebRTC ICE URLs come from the API using TURN_PUBLIC_HOST=PUBLIC_HOST.
#
## 6. TLS (recommended next)
#
# Put Caddy or nginx + Let's Encrypt in front of `web`, or terminate TLS on
# the VPS and proxy to container port 80. Then set Site URL to https://…
# and ensure WebSocket upgrades work (nginx already sets Upgrade headers).
#
## 7. Ops notes
#
# - Set AUTO_APPROVE_LISTENERS=false in production; use Admin API / admin UI.
# - Rotate ADMIN_API_KEY, TURN_PASSWORD, Postgres password.
# - Logs: `docker compose -f infrastructure/docker-compose.prod.yml logs -f api`
# - Updates: git pull && compose up -d --build
#
## Alternative layouts
#
# - Web on Cloudflare/Vercel + API on Fly/Railway + coturn on a small VPS
#   works, but you must point VITE_API_URL / WS at the API host and keep
#   TURN on a machine with UDP. Single-VPS is fewer moving parts.
