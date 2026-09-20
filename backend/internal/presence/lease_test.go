package presence

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDoubleReserveImpossible(t *testing.T) {
	hub := NewHub(30 * time.Second)
	id := uuid.New()
	send := make(chan []byte, 2)
	hub.SetAvailable(id, nil, send, "B", 0.9)

	a, ok1 := hub.ReserveAvailable(nil, nil, nil)
	b, ok2 := hub.ReserveAvailable(nil, nil, nil)
	if !ok1 || a.ListenerID != id {
		t.Fatal("first reserve should succeed")
	}
	if ok2 || b != nil {
		t.Fatal("second reserve must fail (already RESERVED)")
	}
}

func TestLeaseExpirySweep(t *testing.T) {
	hub := NewHub(5 * time.Millisecond)
	id := uuid.New()
	send := make(chan []byte, 1)
	hub.SetAvailable(id, nil, send, "B", 0.5)
	time.Sleep(20 * time.Millisecond)
	expired := hub.SweepExpired()
	if len(expired) != 1 || expired[0] != id {
		t.Fatalf("expected lease expiry for %s, got %v", id, expired)
	}
	_, ok := hub.ReserveAvailable(nil, nil, nil)
	if ok {
		t.Fatal("expired listener must not be matchable")
	}
}
