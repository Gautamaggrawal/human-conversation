package presence

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Status string

const (
	Offline     Status = "OFFLINE"
	Online      Status = "ONLINE"
	Available   Status = "AVAILABLE"
	Reserved    Status = "RESERVED"
	Connecting  Status = "CONNECTING"
	Busy        Status = "BUSY"
)

type ListenerPresence struct {
	ListenerID     uuid.UUID
	Status         Status
	ConnectedAt    time.Time
	LastHeartbeat  time.Time
	LeaseExpiresAt time.Time
	Cohort         string
	QualityScore   float64
	Conn           *websocket.Conn
	Send           chan []byte
}

type Hub struct {
	mu       sync.Mutex
	byID     map[uuid.UUID]*ListenerPresence
	talkers  map[uuid.UUID]*ClientConn
	leaseTTL time.Duration
}

type ClientConn struct {
	UserID uuid.UUID
	Role   string // talker | listener
	Conn   *websocket.Conn
	Send   chan []byte
}

func NewHub(leaseTTL time.Duration) *Hub {
	return &Hub{
		byID:     make(map[uuid.UUID]*ListenerPresence),
		talkers:  make(map[uuid.UUID]*ClientConn),
		leaseTTL: leaseTTL,
	}
}

func (h *Hub) RegisterTalker(c *ClientConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.talkers[c.UserID]; ok {
		closeQuiet(old.Send)
	}
	h.talkers[c.UserID] = c
}

func (h *Hub) UnregisterTalker(id uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c, ok := h.talkers[id]; ok {
		closeQuiet(c.Send)
		delete(h.talkers, id)
	}
}

func (h *Hub) GetTalker(id uuid.UUID) *ClientConn {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.talkers[id]
}

func (h *Hub) SetAvailable(id uuid.UUID, conn *websocket.Conn, send chan []byte, cohort string, quality float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	h.byID[id] = &ListenerPresence{
		ListenerID:     id,
		Status:         Available,
		ConnectedAt:    now,
		LastHeartbeat:  now,
		LeaseExpiresAt: now.Add(h.leaseTTL),
		Cohort:         cohort,
		QualityScore:   quality,
		Conn:           conn,
		Send:           send,
	}
}

func (h *Hub) Heartbeat(id uuid.UUID) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	p, ok := h.byID[id]
	if !ok {
		return false
	}
	now := time.Now()
	p.LastHeartbeat = now
	p.LeaseExpiresAt = now.Add(h.leaseTTL)
	return true
}

func (h *Hub) SetStatus(id uuid.UUID, st Status) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if p, ok := h.byID[id]; ok {
		p.Status = st
	}
}

func (h *Hub) Offline(id uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if p, ok := h.byID[id]; ok {
		closeQuiet(p.Send)
		delete(h.byID, id)
	}
}

func (h *Hub) Get(id uuid.UUID) *ListenerPresence {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.byID[id]
}

// ReserveAvailable atomically picks an eligible listener.
// preferIDs are checked first (favorites / talk-again).
func (h *Hub) ReserveAvailable(exclude, blocked map[uuid.UUID]struct{}, preferIDs []uuid.UUID) (*ListenerPresence, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()

	try := func(id uuid.UUID) *ListenerPresence {
		p, ok := h.byID[id]
		if !ok {
			return nil
		}
		if !eligibleLocked(p, now, exclude, blocked) {
			return nil
		}
		p.Status = Reserved
		cp := *p
		return &cp
	}

	for _, id := range preferIDs {
		if p := try(id); p != nil {
			return p, true
		}
	}

	var best *ListenerPresence
	for _, p := range h.byID {
		if !eligibleLocked(p, now, exclude, blocked) {
			continue
		}
		if best == nil || p.QualityScore > best.QualityScore ||
			(p.QualityScore == best.QualityScore && p.LastHeartbeat.Before(best.LastHeartbeat)) {
			cp := *p
			best = &cp
		}
	}
	if best == nil {
		return nil, false
	}
	h.byID[best.ListenerID].Status = Reserved
	return best, true
}

func eligibleLocked(p *ListenerPresence, now time.Time, exclude, blocked map[uuid.UUID]struct{}) bool {
	if p.Status != Available {
		return false
	}
	if now.After(p.LeaseExpiresAt) {
		return false
	}
	if p.Send == nil {
		return false
	}
	if _, ok := exclude[p.ListenerID]; ok {
		return false
	}
	if _, ok := blocked[p.ListenerID]; ok {
		return false
	}
	return true
}

func (h *Hub) SweepExpired() []uuid.UUID {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	var expired []uuid.UUID
	for id, p := range h.byID {
		if now.After(p.LeaseExpiresAt) {
			closeQuiet(p.Send)
			delete(h.byID, id)
			expired = append(expired, id)
		}
	}
	return expired
}

func (h *Hub) Counts() (online, available, busy int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, p := range h.byID {
		online++
		switch p.Status {
		case Available:
			available++
		case Busy, Connecting, Reserved:
			busy++
		}
	}
	return
}

// ListAvailable returns matchable listeners (fresh lease + AVAILABLE).
func (h *Hub) ListAvailable() []ListenerPresence {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	out := make([]ListenerPresence, 0)
	for _, p := range h.byID {
		if p.Status != Available {
			continue
		}
		if now.After(p.LeaseExpiresAt) || p.Send == nil {
			continue
		}
		cp := *p
		cp.Conn = nil
		cp.Send = nil
		out = append(out, cp)
	}
	return out
}

// ListOnline returns listeners with a fresh lease (available or on a call).
func (h *Hub) ListOnline() []ListenerPresence {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	out := make([]ListenerPresence, 0)
	for _, p := range h.byID {
		switch p.Status {
		case Available, Reserved, Connecting, Busy:
		default:
			continue
		}
		if now.After(p.LeaseExpiresAt) || p.Send == nil {
			continue
		}
		cp := *p
		cp.Conn = nil
		cp.Send = nil
		out = append(out, cp)
	}
	return out
}

func (h *Hub) SendTo(id uuid.UUID, payload []byte) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if p, ok := h.byID[id]; ok && p.Send != nil {
		select {
		case p.Send <- payload:
			return true
		default:
			return false
		}
	}
	if t, ok := h.talkers[id]; ok && t.Send != nil {
		select {
		case t.Send <- payload:
			return true
		default:
			return false
		}
	}
	return false
}

func closeQuiet(ch chan []byte) {
	defer func() { recover() }()
	if ch != nil {
		close(ch)
	}
}
