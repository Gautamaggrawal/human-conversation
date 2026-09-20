package ice_test

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/human-conversation/backend/internal/ice"
)

func TestRewriteLocalhostFromRequestHost(t *testing.T) {
	r := httptest.NewRequest("GET", "http://192.168.1.42:5173/webrtc/ice", nil)
	r.Host = "192.168.1.42:5173"
	servers := ice.Servers(ice.Config{
		STUNURLs:     []string{"stun:stun.l.google.com:19302"},
		TURNURLs:     []string{"turn:localhost:3478"},
		TURNUsername: "hc",
		TURNPassword: "pw",
	}, r)
	found := false
	for _, s := range servers {
		u, _ := s["urls"].(string)
		if strings.Contains(u, "192.168.1.42") && strings.Contains(u, "3478") {
			found = true
		}
		if strings.Contains(u, "localhost") {
			t.Fatalf("still localhost: %v", s)
		}
	}
	if !found {
		t.Fatalf("expected rewritten TURN, got %#v", servers)
	}
}

func TestEphemeralCreds(t *testing.T) {
	servers := ice.Servers(ice.Config{
		TURNURLs:          []string{"turn:example.com:3478"},
		TURNSecret:        "sekrit",
		TURNCredentialTTL: time.Hour,
	}, nil)
	if len(servers) == 0 {
		t.Fatal("empty")
	}
	user, _ := servers[0]["username"].(string)
	cred, _ := servers[0]["credential"].(string)
	if user == "" || cred == "" {
		t.Fatalf("missing ephemeral creds: %#v", servers[0])
	}
}
