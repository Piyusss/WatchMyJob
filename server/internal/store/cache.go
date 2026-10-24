package store

import (
	"sync"
	"time"
)

// cache keeps answers the website asks for over and over, which read from
// DynamoDB each time would use up the table's small read capacity (see
// table.go): each company's open jobs, which the feed and the company page
// read (DB.open), and the role families on open jobs (DB.roles), thousands
// of names joined up from every company.
//
// The sync is the only writer of jobs. When it has saved a company, it
// hands the cache that company's open jobs (set) and drops the role
// families (forget), so the cache never lags behind this server's own
// writes. Entries also expire after cacheFor, in case another server wrote
// the jobs: two run at once for a moment during a deploy.
type cache[T any] struct {
	mu      sync.Mutex
	entries map[string]cacheEntry[T]
	// Each set or forget of a key bumps its version. A read that loaded a
	// value from DynamoDB only caches it (fill) if the version is still the
	// one it started with: if the sync saved meanwhile, the read's value may
	// be older than the sync's.
	versions map[string]uint64
}

type cacheEntry[T any] struct {
	value   T
	expires time.Time
}

const cacheFor = 10 * time.Minute

func newCache[T any]() *cache[T] {
	return &cache[T]{entries: map[string]cacheEntry[T]{}, versions: map[string]uint64{}}
}

// get returns the cached value for key if there is one, and key's
// version, for a fill after a miss.
func (c *cache[T]) get(key string) (T, uint64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if ok && time.Now().After(entry.expires) {
		delete(c.entries, key)
		ok = false
	}
	return entry.value, c.versions[key], ok
}

// fill caches a value a read loaded, unless key was set or forgotten since
// the read began (version is what get returned then).
func (c *cache[T]) fill(key string, value T, version uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.versions[key] == version {
		c.entries[key] = cacheEntry[T]{value, time.Now().Add(cacheFor)}
	}
}

// set caches the value the sync just saved.
func (c *cache[T]) set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.versions[key]++
	c.entries[key] = cacheEntry[T]{value, time.Now().Add(cacheFor)}
}

// forget drops key's entry, after a write that didn't come with its new value.
func (c *cache[T]) forget(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.versions[key]++
	delete(c.entries, key)
}
