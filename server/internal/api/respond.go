package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// apiError is a failure the website should show, sent back as
// {"error": message}. A bad form field adds {"details": {field: [problem]}}
// so the form can name it.
type apiError struct {
	status  int
	message string
	details map[string][]string
}

func (e *apiError) Error() string { return e.message }

var (
	errNotSignedIn = &apiError{status: http.StatusUnauthorized, message: "Not authenticated"}
	errNotAdmin    = &apiError{status: http.StatusForbidden, message: "Admin access required"}
	// Malformed JSON, a value of the wrong type, or an unknown enum value.
	errBadInput = &apiError{status: http.StatusBadRequest, message: "Invalid input"}
)

func notFound(message string) error {
	return &apiError{status: http.StatusNotFound, message: message}
}

func invalidField(field, problem string) error {
	return &apiError{status: http.StatusBadRequest, message: "Invalid input", details: map[string][]string{field: {problem}}}
}

// writeError sends err in the JSON error shape. Anything other than an
// apiError is a bug or an outage: it's logged, and the website only hears
// "Something went wrong".
func writeError(w http.ResponseWriter, err error) {
	var failure *apiError
	if !errors.As(err, &failure) {
		slog.Error("Request failed", "error", err)
		failure = &apiError{status: http.StatusInternalServerError, message: "Something went wrong"}
	}
	body := map[string]any{"error": failure.message}
	if failure.details != nil {
		body["details"] = failure.details
	}
	writeJSON(w, failure.status, body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false) // keep "&" as "&", not "&"
	_ = encoder.Encode(body)     // an error here means the client went away
}

// readJSON decodes the request body (1 MB at most) into dst.
func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return errBadInput
	}
	return nil
}

// pathID reads the {id} in the URL, which must be a UUID.
func pathID(r *http.Request) (string, error) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		return "", errBadInput
	}
	return id.String(), nil
}

// ---- Validation.

// problems collects what's wrong with a request body, field by field. The
// wording is Hibernate Validator's (the Java version's), because the
// website shows it: "roleLevel: must match ...".
type problems map[string][]string

func (p problems) add(field, problem string) {
	p[field] = append(p[field], problem)
}

// err is the 400 response for the problems found, or nil if there are none.
func (p problems) err() error {
	if len(p) == 0 {
		return nil
	}
	return &apiError{status: http.StatusBadRequest, message: "Invalid input", details: p}
}

func (p problems) notNull(field string, missing bool) {
	if missing {
		p.add(field, "must not be null")
	}
}

func (p problems) notBlank(field string, text *string) {
	if text == nil || strings.TrimSpace(*text) == "" {
		p.add(field, "must not be blank")
	}
}

func (p problems) maxLength(field string, text *string, max int) {
	if text != nil && utf8.RuneCountInString(*text) > max {
		p.add(field, fmt.Sprintf("size must be between 0 and %d", max))
	}
}

func (p problems) size(field string, n, min, max int) {
	if n < min || n > max {
		p.add(field, fmt.Sprintf("size must be between %d and %d", min, max))
	}
}

func (p problems) between(field string, n *int, min, max int) {
	switch {
	case n == nil:
	case *n < min:
		p.add(field, fmt.Sprintf("must be greater than or equal to %d", min))
	case *n > max:
		p.add(field, fmt.Sprintf("must be less than or equal to %d", max))
	}
}

// oneOf: the text, when given, must be one of the words.
func (p problems) oneOf(field string, text *string, words ...string) {
	if text != nil && !slices.Contains(words, *text) {
		p.add(field, fmt.Sprintf("must match %q", strings.Join(words, "|")))
	}
}

// validURL: the text, when given, must be an absolute URL.
func (p problems) validURL(field string, text *string) {
	if text == nil || *text == "" {
		return
	}
	if address, err := url.Parse(strings.TrimSpace(*text)); err != nil || address.Scheme == "" {
		p.add(field, "must be a valid URL")
	}
}

// trimmed is the text without surrounding spaces, or nil when that leaves nothing.
func trimmed(text *string) *string {
	if text == nil || strings.TrimSpace(*text) == "" {
		return nil
	}
	t := strings.TrimSpace(*text)
	return &t
}
