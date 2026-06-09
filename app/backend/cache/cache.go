// Package cache is a local, durable (SQLite) store for directory query results
// and Microsoft 365 lookups, so re-running a query or reopening a report against
// a large domain is instant instead of re-fetching everything. Entries are kept
// until the user rescans (overwrites a row) or clears the cache — staleness is
// surfaced in the UI (the fetched-at time), not hidden.
//
// It stores opaque bytes (the caller marshals/unmarshals its own types), so this
// package has no dependency on the ldap/m365 packages. Pure-Go SQLite driver
// (modernc.org/sqlite) keeps the Wails build CGO-free.
package cache

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

// DefaultPath is <UserConfigDir>/ADQuery/cache.db (per-user, ACL'd to the user).
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(dir, "ADQuery")
	if err := os.MkdirAll(d, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(d, "cache.db"), nil
}

const schema = `
CREATE TABLE IF NOT EXISTS query_cache (
  key         TEXT PRIMARY KEY,
  host        TEXT NOT NULL,
  result_json BLOB NOT NULL,
  count       INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_query_host ON query_cache(host);
CREATE TABLE IF NOT EXISTS m365_cache (
  account    TEXT NOT NULL,
  identity   TEXT NOT NULL,
  user_json  BLOB NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (account, identity)
);`

// Open creates/opens the cache database and ensures the schema exists.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite is single-writer; serialize to avoid lock errors
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// QueryKey hashes the identity of a search so equivalent searches share a row.
// bind (the connection's bind DN / identity) is part of the key so a different
// user on the same host never sees another user's cached results.
func QueryKey(host, bind, baseDN string, scope int, filter string, attrs []string) string {
	a := append([]string(nil), attrs...)
	sort.Strings(a)
	parts := []string{host, bind, baseDN, fmt.Sprint(scope), filter, strings.Join(a, ",")}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

// GetQuery returns the cached result bytes and when they were fetched (unix s).
func (s *Store) GetQuery(key string) (raw []byte, fetchedAt int64, ok bool) {
	row := s.db.QueryRow(`SELECT result_json, fetched_at FROM query_cache WHERE key = ?`, key)
	if err := row.Scan(&raw, &fetchedAt); err != nil {
		return nil, 0, false
	}
	return raw, fetchedAt, true
}

// PutQuery inserts or replaces a cached result.
func (s *Store) PutQuery(key, host string, raw []byte, count int, fetchedAt int64) error {
	_, err := s.db.Exec(
		`INSERT INTO query_cache(key,host,result_json,count,fetched_at) VALUES(?,?,?,?,?)
		 ON CONFLICT(key) DO UPDATE SET result_json=excluded.result_json, count=excluded.count, fetched_at=excluded.fetched_at`,
		key, host, raw, count, fetchedAt)
	return err
}

// GetM365 returns cached lookups (identity -> bytes) for the given identities.
func (s *Store) GetM365(account string, identities []string) (map[string][]byte, error) {
	out := map[string][]byte{}
	if account == "" || len(identities) == 0 {
		return out, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(identities)), ",")
	args := make([]any, 0, len(identities)+1)
	args = append(args, account)
	for _, id := range identities {
		args = append(args, id)
	}
	rows, err := s.db.Query(`SELECT identity, user_json FROM m365_cache WHERE account = ? AND identity IN (`+ph+`)`, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err == nil {
			out[id] = raw
		}
	}
	return out, rows.Err()
}

// PutM365 caches one identity's lookup result.
func (s *Store) PutM365(account, identity string, raw []byte, fetchedAt int64) error {
	_, err := s.db.Exec(
		`INSERT INTO m365_cache(account,identity,user_json,fetched_at) VALUES(?,?,?,?)
		 ON CONFLICT(account,identity) DO UPDATE SET user_json=excluded.user_json, fetched_at=excluded.fetched_at`,
		account, identity, raw, fetchedAt)
	return err
}

// ClearHost drops cached query results for one directory host.
func (s *Store) ClearHost(host string) error {
	_, err := s.db.Exec(`DELETE FROM query_cache WHERE host = ?`, host)
	return err
}

// ClearAll empties the cache entirely.
func (s *Store) ClearAll() error {
	if _, err := s.db.Exec(`DELETE FROM query_cache`); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM m365_cache`)
	return err
}
