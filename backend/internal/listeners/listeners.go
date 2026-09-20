package listeners

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Profile struct {
	UserID             uuid.UUID `json:"user_id"`
	VerificationStatus string    `json:"verification_status"`
	EarningCohort      string    `json:"earning_cohort"`
	RatingAvg          float64   `json:"rating_avg"`
	RatingCount        int       `json:"rating_count"`
	TotalMinutes       int       `json:"total_minutes"`
	QualityScore       float64   `json:"quality_score"`
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) EnsurePending(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO listener_profiles (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil {
		return err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE users SET role='both' WHERE id=$1 AND role='talker'`, userID)
	return nil
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	var p Profile
	err := s.pool.QueryRow(ctx, `
		SELECT user_id, verification_status, earning_cohort, rating_avg::float8, rating_count,
		       total_minutes, quality_score::float8
		FROM listener_profiles WHERE user_id=$1
	`, userID).Scan(&p.UserID, &p.VerificationStatus, &p.EarningCohort, &p.RatingAvg, &p.RatingCount, &p.TotalMinutes, &p.QualityScore)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) IsApproved(ctx context.Context, userID uuid.UUID) (bool, string, float64, error) {
	var status, cohort string
	var quality float64
	err := s.pool.QueryRow(ctx, `
		SELECT verification_status, earning_cohort, quality_score::float8
		FROM listener_profiles WHERE user_id=$1
	`, userID).Scan(&status, &cohort, &quality)
	if err != nil {
		return false, "", 0, err
	}
	return status == "approved", cohort, quality, nil
}

func (s *Service) Approve(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE listener_profiles SET verification_status='approved' WHERE user_id=$1
	`, userID)
	return err
}

func (s *Service) EarningsSummary(ctx context.Context, userID uuid.UUID) (map[string]any, error) {
	p, err := s.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	var earned int64
	_ = s.pool.QueryRow(ctx, `
		SELECT balance FROM wallet_accounts WHERE user_id=$1 AND bucket='EARNED'
	`, userID).Scan(&earned)
	var conversations int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM calls WHERE listener_id=$1 AND status='COMPLETED'
	`, userID).Scan(&conversations)
	return map[string]any{
		"earned_credits": earned,
		"conversations":  conversations,
		"rating_avg":     p.RatingAvg,
		"total_minutes":  p.TotalMinutes,
		"cohort":         p.EarningCohort,
	}, nil
}

func (s *Service) RecomputeQuality(ctx context.Context, listenerID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE listener_profiles SET quality_score = LEAST(1.0,
			0.40 * (CASE WHEN rating_count=0 THEN 0.7 ELSE rating_avg/5.0 END)
			+ 0.20 * completion_rate
			+ 0.15 * acceptance_rate
			+ 0.15 * (1 - drop_rate)
			+ 0.10 * repeat_rate
		)
		WHERE user_id=$1
	`, listenerID)
	return err
}
