package calls

import (
	"context"
	"encoding/json"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Status string

const (
	Matched           Status = "CALL_MATCHED"
	Accepted          Status = "CALL_ACCEPTED"
	Negotiating       Status = "WEBRTC_NEGOTIATING"
	WebRTCConnected   Status = "WEBRTC_CONNECTED"
	MediaConfirmed    Status = "MEDIA_CONFIRMED"
	Active            Status = "ACTIVE"
	Ending            Status = "ENDING"
	Completed         Status = "COMPLETED"
	Failed            Status = "FAILED"
	Cancelled         Status = "CANCELLED"
)

type Session struct {
	ID             uuid.UUID
	TalkerID       uuid.UUID
	ListenerID     uuid.UUID
	State          Status
	DurationSec    int
	HoldAmount     int64
	ReservedAt     time.Time
	StartedAt      *time.Time
	TalkerConn     bool
	ListenerConn   bool
	TalkerAudio    bool
	ListenerAudio  bool
	NegotiatingAt  time.Time
	ConnectedAt    *time.Time
}

type Service struct {
	pool       *pgxpool.Pool
	mu         sync.Mutex
	sessions   map[uuid.UUID]*Session
	mediaGrace time.Duration
}

func New(pool *pgxpool.Pool, mediaGrace time.Duration) *Service {
	return &Service{
		pool:       pool,
		sessions:   make(map[uuid.UUID]*Session),
		mediaGrace: mediaGrace,
	}
}

func (s *Service) CreateMatched(ctx context.Context, talkerID, listenerID uuid.UUID, durationSec int, holdAmount int64) (*Session, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO calls (talker_id, listener_id, requested_duration_sec, hold_amount, status)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, talkerID, listenerID, durationSec, holdAmount, Matched).Scan(&id)
	if err != nil {
		return nil, err
	}
	_ = s.LogEvent(ctx, id, string(Matched), nil)
	sess := &Session{
		ID:          id,
		TalkerID:    talkerID,
		ListenerID:  listenerID,
		State:       Matched,
		DurationSec: durationSec,
		HoldAmount:  holdAmount,
		ReservedAt:  time.Now(),
	}
	s.mu.Lock()
	s.sessions[id] = sess
	s.mu.Unlock()
	return sess, nil
}

func (s *Service) Get(id uuid.UUID) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

func (s *Service) GetByUser(userID uuid.UUID) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sess := range s.sessions {
		if sess.TalkerID == userID || sess.ListenerID == userID {
			if sess.State != Completed && sess.State != Failed && sess.State != Cancelled {
				return sess
			}
		}
	}
	return nil
}

func (s *Service) Transition(ctx context.Context, id uuid.UUID, to Status, meta map[string]any) error {
	s.mu.Lock()
	sess, ok := s.sessions[id]
	if !ok {
		s.mu.Unlock()
		return nil
	}
	sess.State = to
	if to == Negotiating {
		sess.NegotiatingAt = time.Now()
	}
	if to == Active && sess.StartedAt == nil {
		now := time.Now()
		sess.StartedAt = &now
	}
	s.mu.Unlock()

	_, err := s.pool.Exec(ctx, `UPDATE calls SET status=$2 WHERE id=$1`, id, to)
	if err != nil {
		return err
	}
	if to == Active {
		_, _ = s.pool.Exec(ctx, `UPDATE calls SET started_at=now() WHERE id=$1 AND started_at IS NULL`, id)
	}
	return s.LogEvent(ctx, id, string(to), meta)
}

func (s *Service) LogEvent(ctx context.Context, callID uuid.UUID, eventType string, meta map[string]any) error {
	var b []byte
	if meta != nil {
		b, _ = json.Marshal(meta)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO call_events (call_id, event_type, meta) VALUES ($1,$2,$3)
	`, callID, eventType, b)
	return err
}

func (s *Service) RecordTelemetry(ctx context.Context, callID, userID uuid.UUID, field string) error {
	s.mu.Lock()
	sess := s.sessions[callID]
	if sess != nil {
		switch field {
		case "webrtc_connected":
			if userID == sess.TalkerID {
				sess.TalkerConn = true
			} else if userID == sess.ListenerID {
				sess.ListenerConn = true
			}
			if sess.TalkerConn && sess.ListenerConn && sess.State == Negotiating {
				now := time.Now()
				sess.ConnectedAt = &now
				sess.State = WebRTCConnected
			}
		case "audio_received":
			if userID == sess.TalkerID {
				sess.TalkerAudio = true
			} else if userID == sess.ListenerID {
				sess.ListenerAudio = true
			}
		}
	}
	s.mu.Unlock()

	col := ""
	switch {
	case field == "webrtc_connected":
		// set appropriate column based on role — handled in SQL with CASE via app
	}
	_ = col

	// Upsert telemetry row
	_, err := s.pool.Exec(ctx, `
		INSERT INTO call_telemetry (call_id) VALUES ($1)
		ON CONFLICT (call_id) DO NOTHING
	`, callID)
	if err != nil {
		return err
	}

	roleCol := ""
	isTalker := false
	if sess != nil {
		isTalker = userID == sess.TalkerID
	} else {
		var talkerID uuid.UUID
		_ = s.pool.QueryRow(ctx, `SELECT talker_id FROM calls WHERE id=$1`, callID).Scan(&talkerID)
		isTalker = talkerID == userID
	}

	if field == "webrtc_connected" {
		if isTalker {
			roleCol = "talker_webrtc_connected_at"
		} else {
			roleCol = "listener_webrtc_connected_at"
		}
	} else if field == "audio_received" {
		if isTalker {
			roleCol = "talker_audio_received_at"
		} else {
			roleCol = "listener_audio_received_at"
		}
	}
	if roleCol != "" {
		q := `UPDATE call_telemetry SET ` + roleCol + ` = COALESCE(` + roleCol + `, now()), updated_at=now() WHERE call_id=$1`
		_, _ = s.pool.Exec(ctx, q, callID)
	}

	if sess != nil && sess.State == WebRTCConnected {
		_ = s.Transition(ctx, callID, WebRTCConnected, nil)
	}
	if sess != nil && sess.TalkerAudio && sess.ListenerAudio && (sess.State == WebRTCConnected || sess.State == Negotiating || sess.State == MediaConfirmed) {
		_ = s.Transition(ctx, callID, MediaConfirmed, nil)
		_ = s.Transition(ctx, callID, Active, nil)
	}
	return nil
}

// TickMediaGrace advances MEDIA_CONFIRMED → ACTIVE after grace if connected.
func (s *Service) TickMediaGrace(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for _, sess := range s.sessions {
		if sess.State == WebRTCConnected && sess.ConnectedAt != nil {
			if now.Sub(*sess.ConnectedAt) >= s.mediaGrace {
				sess.State = MediaConfirmed
				go func(id uuid.UUID) {
					_ = s.Transition(ctx, id, MediaConfirmed, map[string]any{"reason": "grace"})
					_ = s.Transition(ctx, id, Active, nil)
				}(sess.ID)
			}
		}
		if sess.State == Negotiating && !sess.NegotiatingAt.IsZero() {
			if now.Sub(sess.NegotiatingAt) >= s.mediaGrace*4 {
				// ICE hard timeout handled by EndFailed externally
			}
		}
	}
}

func (s *Service) End(ctx context.Context, id uuid.UUID, status Status, failureReason string) (billableSec int, holdAmount int64, talkerID, listenerID uuid.UUID, err error) {
	s.mu.Lock()
	sess := s.sessions[id]
	if sess == nil {
		s.mu.Unlock()
		return 0, 0, uuid.Nil, uuid.Nil, nil
	}
	talkerID = sess.TalkerID
	listenerID = sess.ListenerID
	holdAmount = sess.HoldAmount
	billableSec = 0
	wasActive := sess.State == Active || sess.State == Ending || sess.StartedAt != nil
	if wasActive && sess.StartedAt != nil {
		elapsed := int(time.Since(*sess.StartedAt).Seconds())
		if elapsed < 1 {
			elapsed = 1
		}
		// round up to next minute; open-ended (DurationSec==0) is not capped by a preset
		billableSec = int(math.Ceil(float64(elapsed)/60.0)) * 60
		if sess.DurationSec > 0 && billableSec > sess.DurationSec {
			billableSec = sess.DurationSec
		}
	}
	if !wasActive {
		billableSec = 0
	}
	sess.State = status
	delete(s.sessions, id)
	s.mu.Unlock()

	_, err = s.pool.Exec(ctx, `
		UPDATE calls SET status=$2, failure_reason=$3, ended_at=now(),
			actual_duration_sec=EXTRACT(EPOCH FROM (now()-COALESCE(started_at, now())))::int,
			billable_seconds=$4
		WHERE id=$1
	`, id, status, nullStr(failureReason), billableSec)
	_ = s.LogEvent(ctx, id, string(status), map[string]any{"failure_reason": failureReason, "billable_seconds": billableSec})
	return billableSec, holdAmount, talkerID, listenerID, err
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.talker_id, c.listener_id, c.requested_duration_sec, c.billable_seconds,
		       c.status, c.started_at, c.ended_at, c.created_at,
		       COALESCE(p.display_name, '') AS other_name
		FROM calls c
		LEFT JOIN profiles p ON p.user_id = CASE WHEN c.talker_id=$1 THEN c.listener_id ELSE c.talker_id END
		WHERE c.talker_id=$1 OR c.listener_id=$1
		ORDER BY c.created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, talkerID uuid.UUID
		var listenerID *uuid.UUID
		var reqDur int
		var billable *int
		var status string
		var started, ended *time.Time
		var created time.Time
		var otherName string
		if err := rows.Scan(&id, &talkerID, &listenerID, &reqDur, &billable, &status, &started, &ended, &created, &otherName); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "talker_id": talkerID, "listener_id": listenerID,
			"requested_duration_sec": reqDur, "billable_seconds": billable,
			"status": status, "started_at": started, "ended_at": ended,
			"created_at": created, "other_name": otherName,
		})
	}
	return out, rows.Err()
}

func (s *Service) ActiveCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, sess := range s.sessions {
		if sess.State == Active {
			n++
		}
	}
	return n
}
