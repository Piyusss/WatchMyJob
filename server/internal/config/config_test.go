package config

import (
	"testing"
	"time"
)

func TestTheSyncIntervalIsFiveMinutesUnlessSet(t *testing.T) {
	t.Setenv("CLERK_SECRET_KEY", "sk_test_example")
	for value, want := range map[string]time.Duration{"": 5 * time.Minute, "20m": 20 * time.Minute} {
		t.Setenv("SYNC_INTERVAL", value)
		if c, err := Load(); err != nil || c.SyncInterval != want {
			t.Errorf("SYNC_INTERVAL=%q: got %v, %v; want %v", value, c.SyncInterval, err, want)
		}
	}
	// Under a minute would hammer the job boards; anything unreadable is a mistake.
	for _, value := range []string{"30s", "soon"} {
		t.Setenv("SYNC_INTERVAL", value)
		if _, err := Load(); err == nil {
			t.Errorf("SYNC_INTERVAL=%q should be refused", value)
		}
	}
}
