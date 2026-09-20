package auth_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/human-conversation/backend/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mint(secret string, claims map[string]any) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payloadBytes, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	input := header + "." + payload
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return input + "." + sig
}

func TestParseSupabaseStyleJWT(t *testing.T) {
	secret := "test-jwt-secret"
	svc := auth.New((*pgxpool.Pool)(nil), secret, false, "")
	tok := mint(secret, map[string]any{
		"sub":   "11111111-1111-1111-1111-111111111111",
		"email": "a@b.com",
		"role":  "authenticated",
		"exp":   float64(time.Now().Add(time.Hour).Unix()),
	})
	c, err := svc.ParseJWT(tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.Email != "a@b.com" || c.Sub == "" {
		t.Fatalf("bad claims: %+v", c)
	}
}
