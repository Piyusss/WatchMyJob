package model

import "testing"

func TestAJobIDSplitsBackIntoItsKey(t *testing.T) {
	for _, c := range []struct {
		id, slug, externalID string
		ok                   bool
	}{
		{JobID("stripe", "4012345"), "stripe", "4012345", true},
		{"acme-corp.a.b", "acme-corp", "a.b", true}, // a slug never has a dot; an external id might
		{"stripe", "", "", false},
		{".4012345", "", "", false},
		{"stripe.", "", "", false},
	} {
		slug, externalID, ok := ParseJobID(c.id)
		if ok != c.ok || ok && (slug != c.slug || externalID != c.externalID) {
			t.Errorf("ParseJobID(%q) = %q, %q, %v", c.id, slug, externalID, ok)
		}
	}
}
