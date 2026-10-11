// Package clerk talks to Clerk, which owns sign-in. The website gets a
// session token (a JWT) from Clerk and sends it with every API call;
// VerifyToken checks it. Profile and DeleteUser are the two Clerk API
// calls the backend makes.
package clerk

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/clerk/clerk-sdk-go/v2/user"
)

type Client struct {
	jwks  *jwks.Client
	users *user.Client
	// Clerk's public signing keys, by key id: fetched the first time a
	// token names one, then kept.
	keys sync.Map
}

// New makes a client that authenticates to Clerk's Backend API with the
// secret key.
func New(secretKey string, httpClient *http.Client) *Client {
	config := &clerk.ClientConfig{}
	config.Key = clerk.String(secretKey)
	config.HTTPClient = httpClient
	return &Client{jwks: jwks.NewClient(config), users: user.NewClient(config)}
}

// VerifyToken checks a session token's signature, expiry and issuer, and
// returns the Clerk user id it was issued to.
func (c *Client) VerifyToken(ctx context.Context, token string) (string, error) {
	unverified, err := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
	if err != nil {
		return "", err
	}
	key, err := c.signingKey(ctx, unverified.KeyID)
	if err != nil {
		return "", err
	}
	// The leeway allows for our clock and Clerk's being a few seconds
	// apart; without it, a token issued a moment ago can look as if it were
	// issued in the future and be refused.
	claims, err := jwt.Verify(ctx, &jwt.VerifyParams{Token: token, JWK: key, Leeway: 5 * time.Second})
	if err != nil {
		return "", err
	}
	return claims.Subject, nil
}

func (c *Client) signingKey(ctx context.Context, keyID string) (*clerk.JSONWebKey, error) {
	if key, ok := c.keys.Load(keyID); ok {
		return key.(*clerk.JSONWebKey), nil
	}
	key, err := jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{KeyID: keyID, JWKSClient: c.jwks})
	if err != nil {
		return nil, err
	}
	c.keys.Store(keyID, key)
	return key, nil
}

// Profile is what the app keeps about a user, read from Clerk the first
// time they use the site.
type Profile struct {
	Name          string
	Email         string
	EmailVerified bool
}

func (c *Client) Profile(ctx context.Context, clerkUserID string) (Profile, error) {
	u, err := c.users.Get(ctx, clerkUserID)
	if err != nil {
		return Profile{}, err
	}
	for _, email := range u.EmailAddresses {
		if u.PrimaryEmailAddressID != nil && email.ID == *u.PrimaryEmailAddressID {
			verified := email.Verification != nil && email.Verification.Status == "verified"
			return Profile{Name: displayName(u, email.EmailAddress), Email: email.EmailAddress, EmailVerified: verified}, nil
		}
	}
	return Profile{}, fmt.Errorf("Clerk user %s has no primary email address", clerkUserID)
}

func (c *Client) DeleteUser(ctx context.Context, clerkUserID string) error {
	_, err := c.users.Delete(ctx, clerkUserID)
	return err
}

// displayName is "First Last", else the username, else the email address.
func displayName(u *clerk.User, email string) string {
	if name := strings.TrimSpace(text(u.FirstName) + " " + text(u.LastName)); name != "" {
		return name
	}
	if username := text(u.Username); username != "" {
		return username
	}
	return email
}

// text is the string a field holds, or "" when it's missing.
func text(field *string) string {
	if field == nil {
		return ""
	}
	return *field
}
