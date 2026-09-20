package wallet

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInsufficient = errors.New("insufficient available balance")
var ErrIdempotentReplay = errors.New("idempotent replay")

type Balances struct {
	Available int64 `json:"available"`
	Held      int64 `json:"held"`
	Earned    int64 `json:"earned"`
	PaidOut   int64 `json:"paid_out"`
	Refunded  int64 `json:"refunded"`
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) GetBalances(ctx context.Context, userID uuid.UUID) (Balances, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT bucket, balance FROM wallet_accounts WHERE user_id = $1
	`, userID)
	if err != nil {
		return Balances{}, err
	}
	defer rows.Close()
	var b Balances
	for rows.Next() {
		var bucket string
		var bal int64
		if err := rows.Scan(&bucket, &bal); err != nil {
			return Balances{}, err
		}
		switch bucket {
		case "AVAILABLE":
			b.Available = bal
		case "HELD":
			b.Held = bal
		case "EARNED":
			b.Earned = bal
		case "PAID_OUT":
			b.PaidOut = bal
		case "REFUNDED":
			b.Refunded = bal
		}
	}
	return b, rows.Err()
}

func (s *Service) CreditAvailable(ctx context.Context, userID uuid.UUID, amount int64, idempotencyKey, refType, refID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if done, err := alreadyPosted(ctx, tx, idempotencyKey); err != nil || done {
			return err
		}
		return post(ctx, tx, userID, "AVAILABLE", "credit", amount, refType, refID, idempotencyKey)
	})
}

// Hold moves amount from AVAILABLE → HELD and creates wallet_holds row.
func (s *Service) Hold(ctx context.Context, userID, callID uuid.UUID, amount int64) error {
	idem := fmt.Sprintf("call:%s:hold", callID)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if done, err := alreadyPosted(ctx, tx, idem+":debit"); err != nil || done {
			return err
		}
		var avail int64
		err := tx.QueryRow(ctx, `
			SELECT balance FROM wallet_accounts WHERE user_id=$1 AND bucket='AVAILABLE' FOR UPDATE
		`, userID).Scan(&avail)
		if err != nil {
			return err
		}
		if avail < amount {
			return ErrInsufficient
		}
		if err := post(ctx, tx, userID, "AVAILABLE", "debit", amount, "call", callID.String(), idem+":debit"); err != nil {
			return err
		}
		if err := post(ctx, tx, userID, "HELD", "credit", amount, "call", callID.String(), idem+":credit"); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO wallet_holds (user_id, call_id, amount, status)
			VALUES ($1, $2, $3, 'open')
		`, userID, callID, amount)
		return err
	})
}

// SettleCall charges billable from HELD, releases remainder to AVAILABLE, credits listener EARNED.
func (s *Service) SettleCall(ctx context.Context, talkerID, listenerID, callID uuid.UUID, holdAmount, chargeAmount, listenerEarn int64) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		chargeKey := fmt.Sprintf("call:%s:charge", callID)
		if done, err := alreadyPosted(ctx, tx, chargeKey); err != nil {
			return err
		} else if done {
			return nil
		}
		if chargeAmount > holdAmount {
			chargeAmount = holdAmount
		}
		release := holdAmount - chargeAmount

		if chargeAmount > 0 {
			if err := post(ctx, tx, talkerID, "HELD", "debit", chargeAmount, "call", callID.String(), chargeKey); err != nil {
				return err
			}
		}
		if release > 0 {
			relKey := fmt.Sprintf("call:%s:release", callID)
			if err := post(ctx, tx, talkerID, "HELD", "debit", release, "call", callID.String(), relKey+":debit"); err != nil {
				return err
			}
			if err := post(ctx, tx, talkerID, "AVAILABLE", "credit", release, "call", callID.String(), relKey+":credit"); err != nil {
				return err
			}
		}
		if listenerEarn > 0 {
			earnKey := fmt.Sprintf("call:%s:earning", callID)
			if err := post(ctx, tx, listenerID, "EARNED", "credit", listenerEarn, "call", callID.String(), earnKey); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `
			UPDATE wallet_holds SET status='captured', updated_at=now()
			WHERE call_id=$1 AND status='open'
		`, callID)
		return err
	})
}

func (s *Service) ReleaseHold(ctx context.Context, talkerID, callID uuid.UUID, holdAmount int64) error {
	idem := fmt.Sprintf("call:%s:release_full", callID)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if done, err := alreadyPosted(ctx, tx, idem); err != nil || done {
			return err
		}
		if holdAmount <= 0 {
			_, _ = tx.Exec(ctx, `UPDATE wallet_holds SET status='released', updated_at=now() WHERE call_id=$1`, callID)
			return nil
		}
		if err := post(ctx, tx, talkerID, "HELD", "debit", holdAmount, "call", callID.String(), idem+":debit"); err != nil {
			return err
		}
		if err := post(ctx, tx, talkerID, "AVAILABLE", "credit", holdAmount, "call", callID.String(), idem+":credit"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE wallet_holds SET status='released', updated_at=now() WHERE call_id=$1 AND status='open'
		`, callID)
		return err
	})
}

func (s *Service) RequestPayout(ctx context.Context, userID uuid.UUID, amount int64, idempotencyKey string) (uuid.UUID, error) {
	var payoutID uuid.UUID
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var earned int64
		if err := tx.QueryRow(ctx, `
			SELECT balance FROM wallet_accounts WHERE user_id=$1 AND bucket='EARNED' FOR UPDATE
		`, userID).Scan(&earned); err != nil {
			return err
		}
		if earned < amount {
			return ErrInsufficient
		}
		if err := post(ctx, tx, userID, "EARNED", "debit", amount, "payout", idempotencyKey, idempotencyKey+":debit"); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			INSERT INTO payouts (user_id, amount, status, idempotency_key)
			VALUES ($1, $2, 'pending', $3)
			ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=now()
			RETURNING id
		`, userID, amount, idempotencyKey).Scan(&payoutID)
	})
	return payoutID, err
}

func (s *Service) CompletePayout(ctx context.Context, payoutID uuid.UUID, userID uuid.UUID, amount int64) error {
	idem := fmt.Sprintf("payout:%s:paid", payoutID)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if done, err := alreadyPosted(ctx, tx, idem); err != nil || done {
			return err
		}
		if err := post(ctx, tx, userID, "PAID_OUT", "credit", amount, "payout", payoutID.String(), idem); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE payouts SET status='paid', updated_at=now() WHERE id=$1`, payoutID)
		return err
	})
}

func (s *Service) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func alreadyPosted(ctx context.Context, tx pgx.Tx, key string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE idempotency_key=$1)`, key).Scan(&exists)
	return exists, err
}

func post(ctx context.Context, tx pgx.Tx, userID uuid.UUID, bucket, direction string, amount int64, refType, refID, idem string) error {
	if amount <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, bucket, direction, amount, reference_type, reference_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, userID, bucket, direction, amount, refType, refID, idem)
	if err != nil {
		return err
	}
	delta := amount
	if direction == "debit" {
		delta = -amount
	}
	_, err = tx.Exec(ctx, `
		UPDATE wallet_accounts SET balance = balance + $3
		WHERE user_id=$1 AND bucket=$2
	`, userID, bucket, delta)
	return err
}
