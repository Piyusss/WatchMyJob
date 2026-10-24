package api

import (
	"net/http"
	"strings"
	"time"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// Watching and unwatching companies.

type subscriptionCompany struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Status string `json:"status"`
}

type subscriptionView struct {
	ID            string              `json:"id"`
	UserID        string              `json:"userId"`
	CompanyID     string              `json:"companyId"`
	SubscribedAt  time.Time           `json:"subscribedAt"`
	DeactivatedAt *time.Time          `json:"deactivatedAt"`
	Active        bool                `json:"active"`
	CreatedAt     time.Time           `json:"createdAt"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	Company       subscriptionCompany `json:"company"`
}

// viewOfSubscription is the shape the website reads. Unwatching deletes
// the item, so a stored subscription is always active; active=false
// describes one that was just deleted.
func viewOfSubscription(sub model.Subscription, active bool) subscriptionView {
	var deactivatedAt *time.Time
	if !active {
		now := model.Now()
		deactivatedAt = &now
	}
	c := sub.Company
	return subscriptionView{
		ID:            sub.ID,
		UserID:        sub.UserID,
		CompanyID:     c.Slug,
		SubscribedAt:  sub.CreatedAt,
		DeactivatedAt: deactivatedAt,
		Active:        active,
		CreatedAt:     sub.CreatedAt,
		UpdatedAt:     sub.CreatedAt,
		Company:       subscriptionCompany{c.Slug, c.Name, c.Slug, c.Status()},
	}
}

func (s *Server) listSubscriptions(w http.ResponseWriter, r *http.Request, user model.User) error {
	subs, err := store.SubscriptionsOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	views := make([]subscriptionView, len(subs))
	for i, sub := range subs {
		views[i] = viewOfSubscription(sub, true)
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": views})
	return nil
}

// watch: watching a company you already watch is fine; nothing changes
// (200 instead of 201).
func (s *Server) watch(w http.ResponseWriter, r *http.Request, user model.User) error {
	var body struct {
		CompanySlug *string `json:"companySlug"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notBlank("companySlug", body.CompanySlug)
	if err := p.err(); err != nil {
		return err
	}
	company, err := store.CompanyBySlug(r.Context(), s.db, strings.TrimSpace(*body.CompanySlug))
	if err != nil {
		return err
	}
	if company == nil || !company.Selectable() {
		return notFound("No such company")
	}
	created, err := store.Watch(r.Context(), s.db, user.ID, company.Slug)
	if err != nil {
		return err
	}
	sub, err := store.SubscriptionOf(r.Context(), s.db, user.ID, company.Slug)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"subscription": viewOfSubscription(*sub, true)})
	return nil
}

// unwatch returns the subscription it ended, or null if there was none.
func (s *Server) unwatch(w http.ResponseWriter, r *http.Request, user model.User) error {
	company, err := store.CompanyBySlug(r.Context(), s.db, r.PathValue("slug"))
	if err != nil {
		return err
	}
	if company == nil {
		return notFound("No such company")
	}
	sub, err := store.SubscriptionOf(r.Context(), s.db, user.ID, company.Slug)
	if err != nil {
		return err
	}
	var ended *subscriptionView
	if sub != nil {
		if _, err := store.Unwatch(r.Context(), s.db, user.ID, company.Slug); err != nil {
			return err
		}
		view := viewOfSubscription(*sub, false)
		ended = &view
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscription": ended})
	return nil
}
