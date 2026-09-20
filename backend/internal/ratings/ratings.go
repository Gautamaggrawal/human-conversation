package ratings

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Rate(ctx context.Context, callID, from, to uuid.UUID, rating int, tags []string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO ratings (call_id, from_user_id, to_user_id, rating, tags)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (call_id, from_user_id) DO UPDATE SET rating=EXCLUDED.rating, tags=EXCLUDED.tags
	`, callID, from, to, rating, tags)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE listener_profiles SET
			rating_avg = (SELECT AVG(rating)::numeric FROM ratings WHERE to_user_id=$1),
			rating_count = (SELECT COUNT(*) FROM ratings WHERE to_user_id=$1)
		WHERE user_id=$1
	`, to)
	return err
}

func (s *Service) AddFavorite(ctx context.Context, talkerID, listenerID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO favorites (talker_id, listener_id) VALUES ($1,$2)
		ON CONFLICT DO NOTHING
	`, talkerID, listenerID)
	return err
}

func (s *Service) RemoveFavorite(ctx context.Context, talkerID, listenerID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM favorites WHERE talker_id=$1 AND listener_id=$2`, talkerID, listenerID)
	return err
}

func (s *Service) ListFavorites(ctx context.Context, talkerID uuid.UUID) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT f.listener_id, COALESCE(p.display_name,''), f.created_at
		FROM favorites f
		LEFT JOIN profiles p ON p.user_id=f.listener_id
		WHERE f.talker_id=$1
		ORDER BY f.created_at DESC
	`, talkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name string
		var created any
		if err := rows.Scan(&id, &name, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"listener_id": id, "display_name": name, "created_at": created})
	}
	return out, rows.Err()
}

func (s *Service) NotifyWhenAvailable(ctx context.Context, talkerID, listenerID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notify_when_available (talker_id, listener_id) VALUES ($1,$2)
		ON CONFLICT DO NOTHING
	`, talkerID, listenerID)
	return err
}

func (s *Service) PopNotifyList(ctx context.Context, listenerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		DELETE FROM notify_when_available WHERE listener_id=$1
		RETURNING talker_id
	`, listenerID)
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
