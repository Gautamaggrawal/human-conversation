package billing

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/human-conversation/backend/internal/wallet"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool   *pgxpool.Pool
	wallet *wallet.Service
}

func New(pool *pgxpool.Pool, w *wallet.Service) *Service {
	return &Service{pool: pool, wallet: w}
}

func (s *Service) CreditsPerMinute(ctx context.Context) int64 {
	var raw json.RawMessage
	err := s.pool.QueryRow(ctx, `SELECT value FROM pricing_config WHERE key='talker_credits_per_minute'`).Scan(&raw)
	if err != nil {
		return 10
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 10
	}
	return n
}

func (s *Service) ListenerRate(ctx context.Context, cohort string) int64 {
	var raw json.RawMessage
	err := s.pool.QueryRow(ctx, `SELECT value FROM pricing_config WHERE key='listener_rates'`).Scan(&raw)
	if err != nil {
		return 12
	}
	var m map[string]int64
	if err := json.Unmarshal(raw, &m); err != nil {
		return 12
	}
	if v, ok := m[cohort]; ok {
		return v
	}
	return 12
}

func (s *Service) HoldForDuration(ctx context.Context, talkerID, callID uuid.UUID, durationSec int) (int64, error) {
	cpm := s.CreditsPerMinute(ctx)
	minutes := int64((durationSec + 59) / 60)
	amount := minutes * cpm
	return amount, s.wallet.Hold(ctx, talkerID, callID, amount)
}

func (s *Service) Settle(ctx context.Context, talkerID, listenerID, callID uuid.UUID, holdAmount int64, billableSec int, cohort string) error {
	if billableSec <= 0 {
		return s.wallet.ReleaseHold(ctx, talkerID, callID, holdAmount)
	}
	cpm := s.CreditsPerMinute(ctx)
	minutes := int64((billableSec + 59) / 60)
	charge := minutes * cpm
	if charge > holdAmount {
		charge = holdAmount
	}
	earnRate := s.ListenerRate(ctx, cohort)
	earn := minutes * earnRate
	return s.wallet.SettleCall(ctx, talkerID, listenerID, callID, holdAmount, charge, earn)
}

func (s *Service) CreatePaymentOrder(ctx context.Context, userID uuid.UUID, amountINR, credits int64, idem string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO payment_orders (user_id, amount_inr, credits, status, idempotency_key)
		VALUES ($1,$2,$3,'pending',$4)
		ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=now()
		RETURNING id
	`, userID, amountINR, credits, idem).Scan(&id)
	return id, err
}

func (s *Service) ConfirmPayment(ctx context.Context, orderID uuid.UUID, providerPaymentID string) error {
	var userID uuid.UUID
	var credits int64
	var status string
	err := s.pool.QueryRow(ctx, `
		SELECT user_id, credits, status FROM payment_orders WHERE id=$1
	`, orderID).Scan(&userID, &credits, &status)
	if err != nil {
		return err
	}
	if status == "paid" {
		return nil
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE payment_orders SET status='paid', provider_payment_id=$2, updated_at=now() WHERE id=$1
	`, orderID, providerPaymentID)
	if err != nil {
		return err
	}
	return s.wallet.CreditAvailable(ctx, userID, credits, "payment_order:"+orderID.String()+":credit", "payment_order", orderID.String())
}

// DevPurchase credits wallet without Razorpay (DEV only).
func (s *Service) DevPurchase(ctx context.Context, userID uuid.UUID, credits int64) (uuid.UUID, error) {
	idem := "dev_purchase:" + userID.String() + ":" + uuid.New().String()
	orderID, err := s.CreatePaymentOrder(ctx, userID, credits, credits, idem)
	if err != nil {
		return uuid.Nil, err
	}
	return orderID, s.ConfirmPayment(ctx, orderID, "dev")
}
