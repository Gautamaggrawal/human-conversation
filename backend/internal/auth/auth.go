package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Claims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Exp   int64  `json:"exp"`
}

type Service struct {
	pool      *pgxpool.Pool
	jwtSecret []byte
	devAuth   bool
	jwksURL   string

	jwksMu    sync.RWMutex
	jwksKeys  map[string]*ecdsa.PublicKey
	jwksFetched time.Time
}

func New(pool *pgxpool.Pool, jwtSecret string, devAuth bool, jwksURL string) *Service {
	return &Service{
		pool:      pool,
		jwtSecret: []byte(jwtSecret),
		devAuth:   devAuth,
		jwksURL:   strings.TrimRight(strings.TrimSpace(jwksURL), "/"),
		jwksKeys:  map[string]*ecdsa.PublicKey{},
	}
}

func (s *Service) DevAuthEnabled() bool { return s.devAuth }

func (s *Service) ParseBearer(authHeader string) (*Claims, error) {
	if authHeader == "" {
		return nil, errors.New("missing authorization")
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return nil, errors.New("invalid authorization")
	}
	return s.ParseJWT(parts[1])
}

func (s *Service) ParseJWT(token string) (*Claims, error) {
	segs := strings.Split(token, ".")
	if len(segs) != 3 {
		return nil, errors.New("invalid token")
	}
	hdrJSON, err := base64.RawURLEncoding.DecodeString(segs[0])
	if err != nil {
		return nil, errors.New("bad header")
	}
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(hdrJSON, &hdr); err != nil {
		return nil, errors.New("bad header json")
	}

	signingInput := segs[0] + "." + segs[1]
	sig, err := base64.RawURLEncoding.DecodeString(segs[2])
	if err != nil {
		return nil, errors.New("bad signature encoding")
	}

	switch strings.ToUpper(hdr.Alg) {
	case "HS256", "":
		mac := hmac.New(sha256.New, s.jwtSecret)
		mac.Write([]byte(signingInput))
		if !hmac.Equal(mac.Sum(nil), sig) {
			return nil, errors.New("invalid signature")
		}
	case "ES256":
		if err := s.verifyES256(hdr.Kid, signingInput, sig); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported jwt alg %s", hdr.Alg)
	}

	payload, err := base64.RawURLEncoding.DecodeString(segs[1])
	if err != nil {
		return nil, errors.New("bad payload")
	}
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, err
	}
	c := Claims{
		Sub:   asString(raw["sub"]),
		Email: asString(raw["email"]),
		Role:  asString(raw["role"]),
		Exp:   asInt64(raw["exp"]),
	}
	if c.Email == "" {
		if um, ok := raw["user_metadata"].(map[string]any); ok {
			c.Email = asString(um["email"])
		}
	}
	if c.Sub == "" {
		return nil, errors.New("missing sub")
	}
	if c.Exp > 0 && time.Now().Unix() > c.Exp {
		return nil, errors.New("token expired")
	}
	return &c, nil
}

func (s *Service) verifyES256(kid, signingInput string, sig []byte) error {
	if s.jwksURL == "" {
		return errors.New("es256 token requires SUPABASE_URL / JWKS")
	}
	pub, err := s.lookupJWKS(kid)
	if err != nil {
		return err
	}
	// ES256 signature is R||S (32+32 bytes for P-256).
	if len(sig) != 64 {
		return errors.New("bad es256 signature length")
	}
	sum := sha256.Sum256([]byte(signingInput))
	r := new(big.Int).SetBytes(sig[:32])
	sv := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, sum[:], r, sv) {
		return errors.New("invalid signature")
	}
	return nil
}

func (s *Service) lookupJWKS(kid string) (*ecdsa.PublicKey, error) {
	s.jwksMu.RLock()
	if pub, ok := s.jwksKeys[kid]; ok && time.Since(s.jwksFetched) < 10*time.Minute {
		s.jwksMu.RUnlock()
		return pub, nil
	}
	s.jwksMu.RUnlock()

	s.jwksMu.Lock()
	defer s.jwksMu.Unlock()
	if pub, ok := s.jwksKeys[kid]; ok && time.Since(s.jwksFetched) < 10*time.Minute {
		return pub, nil
	}
	if err := s.refreshJWKSLocked(); err != nil {
		return nil, err
	}
	pub, ok := s.jwksKeys[kid]
	if !ok {
		return nil, fmt.Errorf("jwks kid not found: %s", kid)
	}
	return pub, nil
}

func (s *Service) refreshJWKSLocked() error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.jwksURL, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("jwks http %d: %s", res.StatusCode, string(b))
	}
	var body struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
			Alg string `json:"alg"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return err
	}
	next := map[string]*ecdsa.PublicKey{}
	for _, k := range body.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" {
			continue
		}
		xb, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yb, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		pub := &ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     new(big.Int).SetBytes(xb),
			Y:     new(big.Int).SetBytes(yb),
		}
		next[k.Kid] = pub
	}
	s.jwksKeys = next
	s.jwksFetched = time.Now()
	return nil
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

func asInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case json.Number:
		n, _ := t.Int64()
		return n
	case int64:
		return t
	case int:
		return int64(t)
	default:
		return 0
	}
}

// IssueDevToken mints a HS256 JWT compatible with local DEV_AUTH.
func (s *Service) IssueDevToken(userID, email string) (string, error) {
	if !s.devAuth {
		return "", errors.New("dev auth disabled")
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims := Claims{
		Sub:   userID,
		Email: email,
		Role:  "authenticated",
		Exp:   time.Now().Add(24 * time.Hour).Unix(),
	}
	payloadBytes, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := header + "." + payload
	mac := hmac.New(sha256.New, s.jwtSecret)
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig, nil
}

func (s *Service) UpsertUser(ctx context.Context, claims *Claims) (uuid.UUID, error) {
	id, err := uuid.Parse(claims.Sub)
	if err != nil {
		// Dev convenience: derive deterministic UUID from sub string
		id = uuid.NewSHA1(uuid.NameSpaceOID, []byte(claims.Sub))
	}
	email := claims.Email
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (id, email, role, status)
		VALUES ($1, $2, 'talker', 'active')
		ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
	`, id, nullIfEmpty(email))
	if err != nil {
		return uuid.Nil, err
	}
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO profiles (user_id, display_name)
		VALUES ($1, '')
		ON CONFLICT (user_id) DO NOTHING
	`, id)
	for _, bucket := range []string{"AVAILABLE", "HELD", "EARNED", "PAID_OUT", "REFUNDED"} {
		_, _ = s.pool.Exec(ctx, `
			INSERT INTO wallet_accounts (user_id, bucket, balance)
			VALUES ($1, $2, 0)
			ON CONFLICT (user_id, bucket) DO NOTHING
		`, id, bucket)
	}
	return id, nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *Service) EnsureUserID(claims *Claims) (uuid.UUID, error) {
	id, err := uuid.Parse(claims.Sub)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid user id: %w", err)
	}
	return id, nil
}
