package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/human-conversation/backend/internal/auth"
	"github.com/human-conversation/backend/internal/billing"
	"github.com/human-conversation/backend/internal/calls"
	"github.com/human-conversation/backend/internal/config"
	"github.com/human-conversation/backend/internal/db"
	"github.com/human-conversation/backend/internal/ice"
	"github.com/human-conversation/backend/internal/listeners"
	"github.com/human-conversation/backend/internal/matching"
	"github.com/human-conversation/backend/internal/middleware"
	"github.com/human-conversation/backend/internal/presence"
	"github.com/human-conversation/backend/internal/ratings"
	"github.com/human-conversation/backend/internal/reports"
	"github.com/human-conversation/backend/internal/users"
	"github.com/human-conversation/backend/internal/wallet"
	ws "github.com/human-conversation/backend/internal/websocket"
	"github.com/joho/godotenv"
)

type server struct {
	cfg       config.Config
	auth      *auth.Service
	users     *users.Service
	listeners *listeners.Service
	wallet    *wallet.Service
	billing   *billing.Service
	calls     *calls.Service
	ratings   *ratings.Service
	reports   *reports.Service
	hub       *presence.Hub
	matching  *matching.Service
}

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	migDir := os.Getenv("MIGRATIONS_DIR")
	if migDir == "" {
		migDir = filepath.Join("migrations")
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		log.Printf("migrate warning: %v", err)
	}

	hub := presence.NewHub(cfg.LeaseTTL)
	authSvc := auth.New(pool, cfg.SupabaseJWTSecret, cfg.DevAuth, cfg.JWKSURL())
	walletSvc := wallet.New(pool)
	billingSvc := billing.New(pool, walletSvc)
	callsSvc := calls.New(pool, cfg.MediaGrace)
	listenersSvc := listeners.New(pool)
	ratingsSvc := ratings.New(pool)
	reportsSvc := reports.New(pool)
	usersSvc := users.New(pool)
	matchingSvc := matching.New(pool, hub)

	s := &server{
		cfg: cfg, auth: authSvc, users: usersSvc, listeners: listenersSvc,
		wallet: walletSvc, billing: billingSvc, calls: callsSvc,
		ratings: ratingsSvc, reports: reportsSvc, hub: hub, matching: matchingSvc,
	}

	wsHandler := &ws.Handler{
		Auth: authSvc, Hub: hub, Matching: matchingSvc, Calls: callsSvc,
		Billing: billingSvc, Listeners: listenersSvc, Ratings: ratingsSvc,
		AcceptTO: cfg.AcceptTimeout,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /webrtc/ice", s.iceServers)

	// Dev auth: email → JWT (no Supabase needed locally)
	mux.HandleFunc("POST /auth/dev-login", s.devLogin)

	api := http.NewServeMux()
	api.HandleFunc("GET /me", s.getMe)
	api.HandleFunc("PATCH /me", s.patchMe)
	api.HandleFunc("GET /me/calls", s.myCalls)
	api.HandleFunc("GET /me/favorites", s.listFavorites)
	api.HandleFunc("POST /me/favorites", s.addFavorite)
	api.HandleFunc("DELETE /me/favorites/{listenerID}", s.removeFavorite)
	api.HandleFunc("POST /listeners/apply", s.applyListener)
	api.HandleFunc("GET /listeners/earnings", s.listenerEarnings)
	api.HandleFunc("GET /listeners/available", s.listAvailableListeners)
	api.HandleFunc("GET /presence", s.presenceSummary)
	api.HandleFunc("GET /wallet", s.getWallet)
	api.HandleFunc("POST /wallet/purchase", s.purchase)
	api.HandleFunc("POST /wallet/payout", s.payout)
	api.HandleFunc("POST /calls/{id}/rating", s.rateCall)
	api.HandleFunc("POST /calls/{id}/notify-available", s.notifyAvailable)
	api.HandleFunc("POST /reports", s.createReport)
	api.HandleFunc("POST /blocks", s.createBlock)
	api.HandleFunc("GET /webrtc/ice", s.iceServers)

	mux.Handle("/ws", wsHandler)
	mux.Handle("/api/", http.StripPrefix("/api", middleware.Auth(authSvc)(api)))

	admin := http.NewServeMux()
	admin.HandleFunc("GET /dashboard", s.adminDashboard)
	admin.HandleFunc("GET /reports", s.adminReports)
	admin.HandleFunc("POST /listeners/{id}/approve", s.adminApproveListener)
	admin.HandleFunc("GET /calls", s.adminCalls)
	mux.Handle("/admin/", http.StripPrefix("/admin", middleware.Admin(cfg.AdminAPIKey)(admin)))

	handler := middleware.CORS(mux)

	// background sweepers
	go func() {
		t := time.NewTicker(cfg.HeartbeatSweep)
		defer t.Stop()
		for range t.C {
			expired := hub.SweepExpired()
			for _, id := range expired {
				log.Printf("lease expired listener %s", id)
			}
			callsSvc.TickMediaGrace(context.Background())
		}
	}()

	httpServer := &http.Server{Addr: cfg.HTTPAddr, Handler: handler}
	go func() {
		log.Printf("listening on %s", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func (s *server) devLogin(w http.ResponseWriter, r *http.Request) {
	if !s.auth.DevAuthEnabled() {
		http.Error(w, `{"error":"dev auth disabled"}`, http.StatusForbidden)
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Email == "" {
		http.Error(w, `{"error":"email required"}`, http.StatusBadRequest)
		return
	}
	id := uuid.NewSHA1(uuid.NameSpaceOID, []byte("dev:"+body.Email))
	token, err := s.auth.IssueDevToken(id.String(), body.Email)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	_, _ = s.auth.UpsertUser(r.Context(), &auth.Claims{Sub: id.String(), Email: body.Email})
	writeJSON(w, map[string]any{"access_token": token, "user_id": id, "email": body.Email})
}

func (s *server) getMe(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	p, err := s.users.GetMe(r.Context(), uid)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, p)
}

func (s *server) patchMe(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		DisplayName string `json:"display_name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := s.users.UpdateProfile(r.Context(), uid, body.DisplayName); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) myCalls(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	list, err := s.calls.ListForUser(r.Context(), uid, 30)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"calls": list})
}

func (s *server) listFavorites(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	list, err := s.ratings.ListFavorites(r.Context(), uid)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"favorites": list})
}

func (s *server) addFavorite(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		ListenerID string `json:"listener_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	lid, err := uuid.Parse(body.ListenerID)
	if err != nil {
		http.Error(w, "bad listener_id", 400)
		return
	}
	_ = s.ratings.AddFavorite(r.Context(), uid, lid)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) removeFavorite(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	lid, err := uuid.Parse(r.PathValue("listenerID"))
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	_ = s.ratings.RemoveFavorite(r.Context(), uid, lid)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) listAvailableListeners(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	list := s.hub.ListOnline()
	out := make([]map[string]any, 0, len(list))
	colors := []string{"#C4622D", "#4A7FA5", "#4A9B6F", "#8B6BB5", "#C47A2D"}
	availCount := 0
	busyCount := 0
	for i, p := range list {
		if p.ListenerID == uid {
			continue
		}
		name := "Someone"
		if me, err := s.users.GetMe(r.Context(), p.ListenerID); err == nil && me.DisplayName != "" {
			name = me.DisplayName
		}
		runes := []rune(name)
		initial := "?"
		if len(runes) > 0 {
			initial = strings.ToUpper(string(runes[0]))
		}
		st := string(p.Status)
		busy := p.Status == presence.Busy || p.Status == presence.Connecting || p.Status == presence.Reserved
		if busy {
			busyCount++
		} else if p.Status == presence.Available {
			availCount++
		}
		out = append(out, map[string]any{
			"id":           p.ListenerID,
			"display_name": name,
			"initials":     initial,
			"color":        colors[i%len(colors)],
			"status":       st,
			"online":       p.Status == presence.Available,
			"busy":         busy,
		})
	}
	writeJSON(w, map[string]any{
		"listeners": out,
		"count":     availCount,
		"busy":      busyCount,
		"online":    availCount + busyCount,
	})
}

func (s *server) presenceSummary(w http.ResponseWriter, r *http.Request) {
	online, available, busy := s.hub.Counts()
	writeJSON(w, map[string]any{
		"online":    online,
		"available": available,
		"busy":      busy,
	})
}

func (s *server) applyListener(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	if err := s.listeners.EnsurePending(r.Context(), uid); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	// Local/dev: auto-approve so you can test Talk Now without the admin panel.
	if s.cfg.DevAuth || s.cfg.AutoApproveListeners {
		_ = s.listeners.Approve(r.Context(), uid)
		writeJSON(w, map[string]any{"ok": true, "verification_status": "approved"})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "verification_status": "pending"})
}

func (s *server) listenerEarnings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	sum, err := s.listeners.EarningsSummary(r.Context(), uid)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, sum)
}

func (s *server) getWallet(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	b, err := s.wallet.GetBalances(r.Context(), uid)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, b)
}

func (s *server) purchase(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		Credits int64  `json:"credits"`
		Idem    string `json:"idempotency_key"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Credits <= 0 {
		body.Credits = 100
	}
	if body.Idem == "" {
		body.Idem = uuid.New().String()
	}
	// Dev / missing Razorpay: instant credit
	if s.cfg.RazorpayKeyID == "" {
		id, err := s.billing.DevPurchase(r.Context(), uid, body.Credits)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"order_id": id, "status": "paid", "mode": "dev"})
		return
	}
	id, err := s.billing.CreatePaymentOrder(r.Context(), uid, body.Credits, body.Credits, body.Idem)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"order_id": id, "status": "pending", "razorpay_key": s.cfg.RazorpayKeyID})
}

func (s *server) payout(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		Amount int64  `json:"amount"`
		Idem   string `json:"idempotency_key"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Amount <= 0 {
		http.Error(w, "amount required", 400)
		return
	}
	if body.Idem == "" {
		body.Idem = uuid.New().String()
	}
	id, err := s.wallet.RequestPayout(r.Context(), uid, body.Amount, body.Idem)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	// Dev: auto-complete
	_ = s.wallet.CompletePayout(r.Context(), id, uid, body.Amount)
	writeJSON(w, map[string]any{"payout_id": id, "status": "paid"})
}

func (s *server) rateCall(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	callID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	var body struct {
		Rating     int      `json:"rating"`
		Tags       []string `json:"tags"`
		Favorite   bool     `json:"favorite"`
		ListenerID string   `json:"listener_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	lid, _ := uuid.Parse(body.ListenerID)
	if lid == uuid.Nil {
		http.Error(w, "listener_id required", 400)
		return
	}
	if err := s.ratings.Rate(r.Context(), callID, uid, lid, body.Rating, body.Tags); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if body.Favorite {
		_ = s.ratings.AddFavorite(r.Context(), uid, lid)
	}
	_ = s.listeners.RecomputeQuality(r.Context(), lid)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) notifyAvailable(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		ListenerID string `json:"listener_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	lid, err := uuid.Parse(body.ListenerID)
	if err != nil {
		http.Error(w, "bad listener_id", 400)
		return
	}
	_ = s.ratings.NotifyWhenAvailable(r.Context(), uid, lid)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) createReport(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		ReportedID string `json:"reported_id"`
		CallID     string `json:"call_id"`
		Reason     string `json:"reason"`
		Details    string `json:"details"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	rid, err := uuid.Parse(body.ReportedID)
	if err != nil {
		http.Error(w, "bad reported_id", 400)
		return
	}
	var callID *uuid.UUID
	if body.CallID != "" {
		id, err := uuid.Parse(body.CallID)
		if err == nil {
			callID = &id
		}
	}
	if err := s.reports.Report(r.Context(), uid, rid, callID, body.Reason, body.Details); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) createBlock(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	var body struct {
		BlockedID string `json:"blocked_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	bid, err := uuid.Parse(body.BlockedID)
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	_ = s.reports.Block(r.Context(), uid, bid)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) iceServers(w http.ResponseWriter, r *http.Request) {
	servers := ice.Servers(ice.Config{
		STUNURLs:          s.cfg.STUNURLs,
		TURNURLs:          s.cfg.TURNURLs,
		TURNUsername:      s.cfg.TURNUsername,
		TURNPassword:      s.cfg.TURNPassword,
		TURNSecret:        s.cfg.TURNSecret,
		TURNCredentialTTL: s.cfg.TURNCredentialTTL,
		TURNPublicHost:    s.cfg.TURNPublicHost,
	}, r)
	writeJSON(w, map[string]any{"iceServers": servers})
}

func (s *server) adminDashboard(w http.ResponseWriter, r *http.Request) {
	online, available, busy := s.hub.Counts()
	writeJSON(w, map[string]any{
		"online_listeners": online,
		"available":        available,
		"busy":             busy,
		"active_calls":     s.calls.ActiveCount(),
	})
}

func (s *server) adminReports(w http.ResponseWriter, r *http.Request) {
	list, err := s.reports.ListOpen(r.Context(), 100)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"reports": list})
}

func (s *server) adminApproveListener(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	_ = s.listeners.EnsurePending(r.Context(), id)
	if err := s.listeners.Approve(r.Context(), id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *server) adminCalls(w http.ResponseWriter, r *http.Request) {
	// recent calls via empty user list trick — query directly would be better; reuse pool via calls list is per-user.
	writeJSON(w, map[string]any{"active_calls": s.calls.ActiveCount()})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
