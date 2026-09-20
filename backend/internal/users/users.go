package users

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Profile struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       *string   `json:"email"`
	Role        string    `json:"role"`
	DisplayName string    `json:"display_name"`
	Phone       *string   `json:"phone"`
	Bio         *string   `json:"bio"`
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) GetMe(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	var p Profile
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.role, COALESCE(p.display_name,''), p.phone, p.bio
		FROM users u
		LEFT JOIN profiles p ON p.user_id = u.id
		WHERE u.id=$1
	`, userID).Scan(&p.UserID, &p.Email, &p.Role, &p.DisplayName, &p.Phone, &p.Bio)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, displayName string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO profiles (user_id, display_name) VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now()
	`, userID, displayName)
	return err
}

func (s *Service) SetRole(ctx context.Context, userID uuid.UUID, role string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET role=$2 WHERE id=$1`, userID, role)
	return err
}
