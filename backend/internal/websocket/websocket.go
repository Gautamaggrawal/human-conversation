package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/human-conversation/backend/internal/auth"
	"github.com/human-conversation/backend/internal/billing"
	"github.com/human-conversation/backend/internal/calls"
	"github.com/human-conversation/backend/internal/listeners"
	"github.com/human-conversation/backend/internal/matching"
	"github.com/human-conversation/backend/internal/presence"
	"github.com/human-conversation/backend/internal/ratings"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

type Handler struct {
	Auth      *auth.Service
	Hub       *presence.Hub
	Matching  *matching.Service
	Calls     *calls.Service
	Billing   *billing.Service
	Listeners *listeners.Service
	Ratings   *ratings.Service
	AcceptTO  time.Duration
}

type envelope struct {
	Type     string          `json:"type"`
	CallID   string          `json:"call_id,omitempty"`
	Duration int             `json:"duration,omitempty"`
	SDP      string          `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
	ListenerID string        `json:"listener_id,omitempty"`
	Field    string          `json:"field,omitempty"`
	Reason   string          `json:"reason,omitempty"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		if ah := r.Header.Get("Authorization"); len(ah) > 7 {
			token = ah[7:]
		}
	}
	claims, err := h.Auth.ParseJWT(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := h.Auth.UpsertUser(r.Context(), claims)
	if err != nil {
		http.Error(w, "upsert failed", http.StatusInternalServerError)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	send := make(chan []byte, 64)
	client := &presence.ClientConn{UserID: userID, Conn: conn, Send: send}
	h.Hub.RegisterTalker(client)

	go writePump(conn, send)
	defer func() {
		// Peer dropped: end any in-flight call so the other side is notified.
		if sess := h.Calls.GetByUser(userID); sess != nil {
			h.endCall(context.Background(), userID, sess.ID.String(), calls.Failed, "PEER_DISCONNECTED")
		}
		h.Hub.UnregisterTalker(userID)
		h.Hub.Offline(userID)
		conn.Close()
	}()

	_ = writeJSON(send, map[string]any{"type": "connected", "user_id": userID})

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg envelope
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		h.handle(r.Context(), userID, conn, send, msg)
	}
}

func (h *Handler) handle(ctx context.Context, userID uuid.UUID, conn *websocket.Conn, send chan []byte, msg envelope) {
	switch msg.Type {
	case "heartbeat":
		h.Hub.Heartbeat(userID)
		_ = writeJSON(send, map[string]any{"type": "heartbeat.ack"})

	case "listener.available":
		ok, cohort, quality, err := h.Listeners.IsApproved(ctx, userID)
		if err != nil || !ok {
			_ = writeJSON(send, map[string]any{"type": "error", "reason": "LISTENER_NOT_APPROVED"})
			return
		}
		h.Hub.SetAvailable(userID, conn, send, cohort, quality)
		_ = writeJSON(send, map[string]any{"type": "listener.available.ack"})
		// notify waiters
		if ids, err := h.Ratings.PopNotifyList(ctx, userID); err == nil {
			for _, tid := range ids {
				h.Hub.SendTo(tid, mustJSON(map[string]any{
					"type": "listener.online", "listener_id": userID,
				}))
			}
		}

	case "listener.offline":
		h.Hub.Offline(userID)
		_ = writeJSON(send, map[string]any{"type": "listener.offline.ack"})

	case "call.request":
		h.onCallRequest(ctx, userID, send, msg)

	case "call.accept":
		h.onAccept(ctx, userID, msg)
	case "call.decline":
		h.onDecline(ctx, userID, msg)

	case "webrtc.offer", "webrtc.answer", "webrtc.ice":
		h.relaySignal(ctx, userID, msg)

	case "telemetry":
		callID, err := uuid.Parse(msg.CallID)
		if err != nil {
			return
		}
		_ = h.Calls.RecordTelemetry(ctx, callID, userID, msg.Field)
		sess := h.Calls.Get(callID)
		if sess != nil {
			if sess.State == calls.Active || sess.State == calls.MediaConfirmed {
				h.Hub.SetStatus(sess.ListenerID, presence.Busy)
			}
			h.broadcastState(sess)
		}

	case "call.end":
		st := calls.Completed
		reason := msg.Reason
		if reason == "ICE_TIMEOUT" || reason == "ICE_FAILED" || reason == "MIC_DENIED" {
			st = calls.Failed
		}
		h.endCall(ctx, userID, msg.CallID, st, reason)	}
}

func (h *Handler) onCallRequest(ctx context.Context, talkerID uuid.UUID, send chan []byte, msg envelope) {
	// 0 = open-ended (talk until hangup). Legacy 10/20/30 still accepted.
	duration := msg.Duration
	if duration < 0 {
		duration = 0
	}
	if duration != 0 && duration != 600 && duration != 1200 && duration != 1800 {
		duration = 0
	}
	holdSec := duration
	if holdSec == 0 {
		holdSec = 60 * 60 // soft wallet hold for open-ended calls
	}
	var prefer *uuid.UUID
	if msg.ListenerID != "" {
		if id, err := uuid.Parse(msg.ListenerID); err == nil {
			prefer = &id
		}
	}

	listener, reason, err := h.Matching.Match(ctx, talkerID, prefer)
	if err != nil {
		_ = writeJSON(send, map[string]any{"type": "error", "reason": "MATCH_ERROR"})
		return
	}
	if listener == nil {
		_ = writeJSON(send, map[string]any{"type": "call.failed", "reason": reason})
		return
	}

	// Create call row first (id needed for hold)
	cpm := h.Billing.CreditsPerMinute(ctx)
	holdAmt := int64((holdSec+59)/60) * cpm
	sess, err := h.Calls.CreateMatched(ctx, talkerID, listener.ListenerID, duration, holdAmt)
	if err != nil {
		h.Hub.SetStatus(listener.ListenerID, presence.Available)
		_ = writeJSON(send, map[string]any{"type": "error", "reason": "CALL_CREATE_FAILED"})
		return
	}
	if _, err := h.Billing.HoldForDuration(ctx, talkerID, sess.ID, holdSec); err != nil {
		h.Hub.SetStatus(listener.ListenerID, presence.Available)
		_, _, _, _, _ = h.Calls.End(ctx, sess.ID, calls.Failed, "BILLING_FAILED")
		_ = writeJSON(send, map[string]any{"type": "call.failed", "reason": "INSUFFICIENT_CREDITS"})
		return
	}

	_ = writeJSON(send, map[string]any{
		"type": "call.matched", "call_id": sess.ID, "listener_id": listener.ListenerID, "duration": duration,
	})
	h.Hub.SendTo(listener.ListenerID, mustJSON(map[string]any{
		"type": "call.incoming", "call_id": sess.ID, "talker_id": talkerID, "duration": duration,
	}))

	// accept timeout
	go func(callID, lid uuid.UUID) {
		time.Sleep(h.AcceptTO)
		s := h.Calls.Get(callID)
		if s != nil && s.State == calls.Matched {
			h.endCall(context.Background(), talkerID, callID.String(), calls.Failed, "MATCH_TIMEOUT")
			h.Hub.SetStatus(lid, presence.Available)
		}
	}(sess.ID, listener.ListenerID)
}

func (h *Handler) onAccept(ctx context.Context, listenerID uuid.UUID, msg envelope) {
	callID, err := uuid.Parse(msg.CallID)
	if err != nil {
		return
	}
	sess := h.Calls.Get(callID)
	if sess == nil || sess.ListenerID != listenerID {
		return
	}
	_ = h.Calls.Transition(ctx, callID, calls.Accepted, nil)
	_ = h.Calls.Transition(ctx, callID, calls.Negotiating, nil)
	h.Hub.SetStatus(listenerID, presence.Connecting)
	h.broadcastState(h.Calls.Get(callID))
	payload := mustJSON(map[string]any{"type": "call.accepted", "call_id": callID})
	h.Hub.SendTo(sess.TalkerID, payload)
	h.Hub.SendTo(sess.ListenerID, payload)
}

func (h *Handler) onDecline(ctx context.Context, listenerID uuid.UUID, msg envelope) {
	callID, err := uuid.Parse(msg.CallID)
	if err != nil {
		return
	}
	sess := h.Calls.Get(callID)
	if sess == nil || sess.ListenerID != listenerID {
		return
	}
	h.endCall(ctx, listenerID, callID.String(), calls.Failed, "LISTENER_DECLINED")
	h.Hub.SetStatus(listenerID, presence.Available)
}

func (h *Handler) relaySignal(ctx context.Context, from uuid.UUID, msg envelope) {
	callID, err := uuid.Parse(msg.CallID)
	if err != nil {
		return
	}
	sess := h.Calls.Get(callID)
	if sess == nil {
		return
	}
	if from != sess.TalkerID && from != sess.ListenerID {
		return
	}
	to := sess.ListenerID
	if from == sess.ListenerID {
		to = sess.TalkerID
	}
	out := map[string]any{"type": msg.Type, "call_id": callID, "sdp": msg.SDP}
	if msg.Candidate != nil {
		out["candidate"] = json.RawMessage(msg.Candidate)
	}
	h.Hub.SendTo(to, mustJSON(out))
	if msg.Type == "webrtc.offer" || msg.Type == "webrtc.answer" {
		_ = h.Calls.LogEvent(ctx, callID, msg.Type, nil)
	}
}

func (h *Handler) endCall(ctx context.Context, userID uuid.UUID, callIDStr string, status calls.Status, reason string) {
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		return
	}
	sess := h.Calls.Get(callID)
	if sess == nil {
		return
	}
	if userID != sess.TalkerID && userID != sess.ListenerID {
		return
	}
	billable, hold, talkerID, listenerID, err := h.Calls.End(ctx, callID, status, reason)
	if err != nil {
		log.Println("end call", err)
		return
	}
	cohort := "B"
	if lp, err := h.Listeners.Get(ctx, listenerID); err == nil {
		cohort = lp.EarningCohort
	}
	_ = h.Billing.Settle(ctx, talkerID, listenerID, callID, hold, billable, cohort)
	h.Hub.SetStatus(listenerID, presence.Available)
	payload := mustJSON(map[string]any{
		"type": "call.ended", "call_id": callID, "status": status,
		"billable_seconds": billable, "reason": reason,
	})
	h.Hub.SendTo(talkerID, payload)
	h.Hub.SendTo(listenerID, payload)
}

func (h *Handler) broadcastState(sess *calls.Session) {
	if sess == nil {
		return
	}
	payload := mustJSON(map[string]any{"type": "call.state", "call_id": sess.ID, "status": sess.State})
	h.Hub.SendTo(sess.TalkerID, payload)
	h.Hub.SendTo(sess.ListenerID, payload)
}

func writePump(conn *websocket.Conn, send chan []byte) {
	for msg := range send {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func writeJSON(send chan []byte, v any) error {
	select {
	case send <- mustJSON(v):
		return nil
	default:
		return nil
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
