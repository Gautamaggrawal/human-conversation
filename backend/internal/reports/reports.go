package reports

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Report(ctx context.Context, reporter, reported uuid.UUID, callID *uuid.UUID, reason, details string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO reports (reporter_id, reported_id, call_id, reason, details)
		VALUES ($1,$2,$3,$4,$5)
	`, reporter, reported, callID, reason, details)
	return err
}

func (s *Service) Block(ctx context.Context, blocker, blocked uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)
		ON CONFLICT DO NOTHING
	`, blocker, blocked)
	return err
}

func (s *Service) ListOpen(ctx context.Context, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, reporter_id, reported_id, call_id, reason, details, status, created_at
		FROM reports WHERE status='open' ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, reporter, reported uuid.UUID
		var callID *uuid.UUID
		var reason, details, status string
		var created any
		if err := rows.Scan(&id, &reporter, &reported, &callID, &reason, &details, &status, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "reporter_id": reporter, "reported_id": reported,
			"call_id": callID, "reason": reason, "details": details,
			"status": status, "created_at": created,
		})
	}
	return out, rows.Err()
}
