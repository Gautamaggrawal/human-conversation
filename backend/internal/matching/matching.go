package matching

import (
	"context"

	"github.com/google/uuid"
	"github.com/human-conversation/backend/internal/presence"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	hub  *presence.Hub
}

func New(pool *pgxpool.Pool, hub *presence.Hub) *Service {
	return &Service{pool: pool, hub: hub}
}

func (s *Service) FavoriteIDs(ctx context.Context, talkerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT listener_id FROM favorites WHERE talker_id=$1 ORDER BY created_at DESC
	`, talkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Service) BlockedSet(ctx context.Context, talkerID uuid.UUID) (map[uuid.UUID]struct{}, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT blocked_id FROM blocks WHERE blocker_id=$1
		UNION
		SELECT blocker_id FROM blocks WHERE blocked_id=$1
	`, talkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]struct{}{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = struct{}{}
	}
	return out, rows.Err()
}

func (s *Service) Match(ctx context.Context, talkerID uuid.UUID, preferListener *uuid.UUID) (*presence.ListenerPresence, string, error) {
	blocked, err := s.BlockedSet(ctx, talkerID)
	if err != nil {
		return nil, "", err
	}
	exclude := map[uuid.UUID]struct{}{talkerID: {}}
	var prefer []uuid.UUID
	if preferListener != nil {
		prefer = append(prefer, *preferListener)
	}
	favs, _ := s.FavoriteIDs(ctx, talkerID)
	prefer = append(prefer, favs...)

	p, ok := s.hub.ReserveAvailable(exclude, blocked, prefer)
	if !ok {
		return nil, "NO_LISTENER", nil
	}
	return p, "", nil
}
