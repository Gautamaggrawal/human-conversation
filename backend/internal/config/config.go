package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr            string
	DatabaseURL         string
	SupabaseURL         string
	SupabaseJWTSecret   string
	SupabaseJWKSURL     string
	DevAuth             bool
	AutoApproveListeners bool
	STUNURLs            []string
	TURNURLs            []string
	TURNUsername        string
	TURNPassword        string
	TURNSecret          string
	TURNCredentialTTL   time.Duration
	TURNPublicHost      string
	RazorpayKeyID       string
	RazorpayKeySecret   string
	RazorpayWebhookSec  string
	AdminAPIKey         string
	MediaGrace          time.Duration
	AcceptTimeout       time.Duration
	LeaseTTL            time.Duration
	HeartbeatSweep      time.Duration
}

func Load() Config {
	httpAddr := getenv("HTTP_ADDR", "")
	if httpAddr == "" {
		// Fly.io and many PaaS set PORT.
		if p := os.Getenv("PORT"); p != "" {
			if !strings.HasPrefix(p, ":") {
				p = ":" + p
			}
			httpAddr = p
		} else {
			httpAddr = ":8081"
		}
	}
	return Config{
		HTTPAddr:           httpAddr,
		DatabaseURL:        getenv("DATABASE_URL", "postgres://hc:hc@localhost:5433/human_conversation?sslmode=disable"),
		SupabaseURL:        strings.TrimRight(getenv("SUPABASE_URL", ""), "/"),
		SupabaseJWTSecret:  getenv("SUPABASE_JWT_SECRET", "dev-supabase-jwt-secret-change-me"),
		SupabaseJWKSURL:    getenv("SUPABASE_JWKS_URL", ""),
		DevAuth:            getenv("DEV_AUTH", "true") == "true",
		AutoApproveListeners: getenv("AUTO_APPROVE_LISTENERS", "false") == "true" || getenv("DEV_AUTH", "true") == "true",
		STUNURLs:           splitCSV(getenv("STUN_URLS", "stun:stun.l.google.com:19302")),
		TURNURLs:           splitCSV(getenv("TURN_URLS", "turn:localhost:3478")),
		TURNUsername:       getenv("TURN_USERNAME", "hc"),
		TURNPassword:       getenv("TURN_PASSWORD", "hcpassword"),
		TURNSecret:         getenv("TURN_SECRET", ""),
		TURNCredentialTTL:  durationSec("TURN_CREDENTIAL_TTL_SEC", 3600),
		TURNPublicHost:     getenv("TURN_PUBLIC_HOST", ""),
		RazorpayKeyID:      getenv("RAZORPAY_KEY_ID", ""),
		RazorpayKeySecret:  getenv("RAZORPAY_KEY_SECRET", ""),
		RazorpayWebhookSec: getenv("RAZORPAY_WEBHOOK_SECRET", ""),
		AdminAPIKey:        getenv("ADMIN_API_KEY", "dev-admin-key"),
		MediaGrace:         durationMS("MEDIA_GRACE_MS", 2500),
		AcceptTimeout:      durationSec("ACCEPT_TIMEOUT_SEC", 15),
		LeaseTTL:           durationSec("LEASE_TTL_SEC", 30),
		HeartbeatSweep:     durationSec("HEARTBEAT_SWEEP_SEC", 5),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func durationSec(k string, def int) time.Duration {
	v := getenv(k, strconv.Itoa(def))
	n, err := strconv.Atoi(v)
	if err != nil {
		n = def
	}
	return time.Duration(n) * time.Second
}

func durationMS(k string, def int) time.Duration {
	v := getenv(k, strconv.Itoa(def))
	n, err := strconv.Atoi(v)
	if err != nil {
		n = def
	}
	return time.Duration(n) * time.Millisecond
}

// JWKSURL returns the Supabase Auth JWKS endpoint for ES256 access tokens.
func (c Config) JWKSURL() string {
	if c.SupabaseJWKSURL != "" {
		return c.SupabaseJWKSURL
	}
	if c.SupabaseURL != "" {
		return c.SupabaseURL + "/auth/v1/.well-known/jwks.json"
	}
	return ""
}
