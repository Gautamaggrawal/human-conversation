# Auth — Supabase Email OTP
#
# 1. Create a project at https://supabase.com
# 2. Authentication → Providers → Email: enable Email
# 3. Copy Project URL + anon key into web/.env:
#      VITE_SUPABASE_URL=https://xxxx.supabase.co
#      VITE_SUPABASE_ANON_KEY=eyJ...
# 4. Backend .env:
#      SUPABASE_URL=https://xxxx.supabase.co
#      SUPABASE_JWT_SECRET=<Legacy JWT secret>   # for DEV_AUTH HS256 only
#      DEV_AUTH=false
#    Access tokens from modern Supabase projects are ES256; the API verifies
#    them via SUPABASE_URL/auth/v1/.well-known/jwks.json
# 5. Restart Vite + Go server.
#
# Without VITE_SUPABASE_* set, the web app stays in local DEV_AUTH mode
# (any 6-digit code via POST /auth/dev-login).
#
## Custom SMTP (required to edit templates)
#
# Hosted Supabase locks template subject/body until custom SMTP is enabled.
# Built-in mail is for exploration only (low limits / team addresses).
#
# Dashboard path:
#   Authentication → Emails → SMTP Settings → Enable Custom SMTP
#
# You need any SMTP provider (Resend, Brevo, SendGrid, Postmark, SES, …).
#
# Example — Resend (https://resend.com):
#   1. Create account → API Keys → create key
#   2. Add + verify a sending domain (or use onboarding address while testing)
#   3. In Supabase SMTP Settings:
#        Sender email:   onboarding@resend.dev   (or your verified domain)
#        Sender name:    Human Conversation
#        Host:           smtp.resend.com
#        Port:           465  (or 587)
#        Username:       resend
#        Password:       <your Resend API key>
#   4. Save
#
# Example — Brevo (Sendinblue):
#        Host: smtp-relay.brevo.com  Port: 587
#        Username / password from Brevo → SMTP & API
#
# After SMTP is saved, open Authentication → Emails → Templates and edit.
#
## Get a 6-digit code (not only a magic link)
#
# Edit **Confirm signup** and **Magic link** templates to include the OTP:
#
#   <h2>Confirm your signup</h2>
#   <p>Your code is {{ .Token }}</p>
#   <p>Or <a href="{{ .ConfirmationURL }}">confirm via link</a>.</p>
#
# Keep {{ .ConfirmationURL }} (or {{ .Token }}) so auth still works.
# Then resend from the app and enter the 6 digits.
#
# Until SMTP + templates are set, users can still finish signup by clicking
# the default confirmation link (the web app accepts the redirect session).
#
## Redirect URLs
#
# Authentication → URL Configuration:
#   Site URL:  http://localhost:5173
#   Redirects: http://localhost:5173
#              http://172.20.10.3:5173
#
# If Site URL is http://localhost:3000, magic links open the wrong app.
