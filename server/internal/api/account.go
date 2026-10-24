package api

import (
	"context"
	"net/http"
	"time"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// The signed-in user's own account.

// profile is the user as the website sees them. hasPreferences sends a new
// user to onboarding; isAdmin shows the admin link.
type profile struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	Email               string    `json:"email"`
	EmailVerified       bool      `json:"emailVerified"`
	NotificationsPaused bool      `json:"notificationsPaused"`
	CreatedAt           time.Time `json:"createdAt"`
	HasPreferences      bool      `json:"hasPreferences"`
	IsAdmin             bool      `json:"isAdmin"`
}

func (s *Server) profileOf(ctx context.Context, user model.User) (profile, error) {
	hasPreferences, err := store.HasPreferences(ctx, s.db, user.ID)
	return profile{
		ID:                  user.ID,
		Name:                user.Name,
		Email:               user.Email,
		EmailVerified:       user.EmailVerified,
		NotificationsPaused: user.NotificationsPaused,
		CreatedAt:           user.CreatedAt,
		HasPreferences:      hasPreferences,
		IsAdmin:             s.config.IsAdmin(user.Email),
	}, err
}

// me: the website calls this first on every page, which also makes it
// where a brand new user's item gets created (see currentUser).
func (s *Server) me(w http.ResponseWriter, r *http.Request, user model.User) error {
	p, err := s.profileOf(r.Context(), user)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": p})
	return nil
}

// setPaused is the pause / resume switch in Settings.
func (s *Server) setPaused(w http.ResponseWriter, r *http.Request, user model.User) error {
	var body struct {
		Paused *bool `json:"paused"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notNull("paused", body.Paused == nil)
	if err := p.err(); err != nil {
		return err
	}
	if err := store.SetNotificationsPaused(r.Context(), s.db, user.ID, *body.Paused); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"notificationsPaused": *body.Paused})
	return nil
}

// exportAccount is "Download my data" in Settings: everything stored about the user.
func (s *Server) exportAccount(w http.ResponseWriter, r *http.Request, user model.User) error {
	p, err := s.profileOf(r.Context(), user)
	if err != nil {
		return err
	}
	prefs, err := store.PreferencesOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	subs, err := store.SubscriptionsOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}

	type watched struct {
		Company string    `json:"company"`
		Slug    string    `json:"slug"`
		Since   time.Time `json:"since"`
	}
	subscriptions := make([]watched, len(subs))
	for i, sub := range subs {
		subscriptions[i] = watched{sub.Company.Name, sub.Company.Slug, sub.CreatedAt}
	}
	var preferences *preferencesView
	if prefs != nil {
		view := viewOfPreferences(*prefs)
		preferences = &view
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"exportedAt":    model.Now(),
		"user":          p,
		"preferences":   preferences,
		"subscriptions": subscriptions,
	})
	return nil
}

// deleteAccount deletes the Clerk account first: if that fails nothing has
// changed here and the user can simply retry. Then everything stored about
// the user goes (see store.DeleteUser).
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, user model.User) error {
	if err := s.clerk.DeleteUser(r.Context(), user.ID); err != nil {
		return err
	}
	if err := store.DeleteUser(r.Context(), s.db, user.ID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
