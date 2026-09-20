# Frontend on GitHub Pages
#
# Live URL (after enable):
#   https://gautamaggrawal.github.io/human-conversation/
#
# API: https://human-conversation.onrender.com
#
## 1. One-time GitHub setup
#
# Repo → Settings → Pages:
#   Source: GitHub Actions
#
# Repo → Settings → Secrets and variables → Actions:
#   New secret VITE_SUPABASE_ANON_KEY = your Supabase anon key
#
## 2. Deploy
#
# Push to main (or Actions → Deploy web to GitHub Pages → Run workflow).
# Workflow builds web/ with:
#   VITE_BASE=/human-conversation/
#   VITE_API_URL=https://human-conversation.onrender.com
#
## 3. Supabase Auth redirects
#
# Authentication → URL Configuration — add:
#   Site URL: https://gautamaggrawal.github.io/human-conversation/
#   Redirect URLs:
#     https://gautamaggrawal.github.io/human-conversation/
#     https://gautamaggrawal.github.io/human-conversation/**
#     http://localhost:5173
#
## 4. Smoke test
#
# Open the Pages URL → email OTP → Available / Talk now (two accounts).
