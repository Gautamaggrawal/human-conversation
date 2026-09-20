package ice

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	STUNURLs          []string
	TURNURLs          []string
	TURNUsername      string
	TURNPassword      string
	TURNSecret        string
	TURNCredentialTTL time.Duration
	// Optional fixed host for TURN (LAN IP / public IP). Empty = derive from request.
	TURNPublicHost string
}

// Servers builds WebRTC iceServers, rewriting localhost TURN to a reachable host
// so phones on the LAN don't get turn:localhost.
func Servers(cfg Config, r *http.Request) []map[string]any {
	host := cfg.TURNPublicHost
	if host == "" && r != nil {
		host = clientFacingHost(r)
	}
	servers := make([]map[string]any, 0, len(cfg.STUNURLs)+len(cfg.TURNURLs)*2)
	for _, u := range cfg.STUNURLs {
		servers = append(servers, map[string]any{"urls": rewriteHost(u, host)})
	}
	user, pass := cfg.TURNUsername, cfg.TURNPassword
	if cfg.TURNSecret != "" {
		user, pass = ephemeralCreds(cfg.TURNSecret, cfg.TURNCredentialTTL)
	}
	for _, u := range cfg.TURNURLs {
		rewritten := rewriteHost(u, host)
		entry := map[string]any{
			"urls":       rewritten,
			"username":   user,
			"credential": pass,
		}
		servers = append(servers, entry)
		// Also advertise turns/tcp variant when only turn:udp is configured.
		if strings.HasPrefix(rewritten, "turn:") && !strings.Contains(rewritten, "?") {
			servers = append(servers, map[string]any{
				"urls":       rewritten + "?transport=tcp",
				"username":   user,
				"credential": pass,
			})
		}
	}
	return servers
}

func clientFacingHost(r *http.Request) string {
	h := r.Header.Get("X-Forwarded-Host")
	if h == "" {
		h = r.Host
	}
	if i := strings.Index(h, ","); i >= 0 {
		h = strings.TrimSpace(h[:i])
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		return host
	}
	return h
}

func rewriteHost(url, host string) string {
	if host == "" || host == "localhost" || host == "127.0.0.1" {
		return url
	}
	for _, local := range []string{"localhost", "127.0.0.1"} {
		if strings.Contains(url, local) {
			return strings.Replace(url, local, host, 1)
		}
	}
	return url
}

func ephemeralCreds(secret string, ttl time.Duration) (username, password string) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	expiry := time.Now().Add(ttl).Unix()
	username = strconv.FormatInt(expiry, 10)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%s", username)
	password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, password
}
