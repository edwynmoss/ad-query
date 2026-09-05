// Package cache is a local, durable (SQLite) store for directory query results
// and Microsoft 365 lookups, so re-running a query or reopening a report against
// a large domain is instant instead of re-fetching everything. Entries are kept
// until the user rescans (overwrites a row) or clears the cache, staleness is
// surfaced in the UI (the fetched-at time), not hidden.
//
// Stored values are encrypted at rest with AES-256-GCM under a key the caller
// supplies (kept in the Windows Credential Manager), since the rows hold real
// directory attributes. It stores opaque bytes, the caller marshals/unmarshals
// its own types, so this package depends on neither ldap nor m365. Pure-Go
// SQLite driver (modernc.org/sqlite) keeps the Wails build CGO-free.
package cache

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
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

// schemaVersion is bumped when the on-disk format changes incompatibly. v2
// introduced at-rest encryption + eviction; pre-v2 (plaintext) rows are dropped
// on open so we never try to decrypt plaintext.
const schemaVersion = 2

// Eviction caps keep the database bounded. A query row can be several MB (a large
// result set), so query rows are capped tightly; 365 rows are tiny.
const (
	maxQueryRows = 200
	maxM365Rows  = 50000
)

type Store struct {
	db  *sql.DB
	gcm cipher.AEAD // nil => values stored in the clear (no key supplied)
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

// Open creates/opens the cache database, runs migrations, and (if key is a valid
// 32-byte AES key) enables at-rest encryption. A nil/short key stores plaintext
// (used by tests); production always supplies a key.
func Open(path string, key []byte) (*Store, error) {
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
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	s := &Store{db: db}
	if len(key) == 32 {
		block, err := aes.NewCipher(key)
		if err != nil {
			db.Close()
			return nil, err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			db.Close()
			return nil, err
		}
		s.gcm = gcm
	}
	return s, nil
}

// migrate brings an existing database up to schemaVersion. Pre-v2 caches stored
// plaintext, so they're cleared (the data is re-fetched on demand) before the
// version is stamped, avoids decrypting plaintext as ciphertext.
func migrate(db *sql.DB) error {
	var ver int
	_ = db.QueryRow(`PRAGMA user_version`).Scan(&ver)
	if ver >= schemaVersion {
		return nil
	}
	if _, err := db.Exec(`DELETE FROM query_cache; DELETE FROM m365_cache;`); err != nil {
		return err
	}
	_, err := db.Exec(fmt.Sprintf(`PRAGMA user_version=%d`, schemaVersion))
	return err
}

func (s *Store) Close() error { return s.db.Close() }

// seal/unseal apply AES-GCM with a random nonce prefix. With no key they pass
// through. unseal returns ok=false on any failure (e.g. the key changed), so an
// unreadable row is treated as a cache miss rather than an error.
func (s *Store) seal(plain []byte) ([]byte, error) {
	if s.gcm == nil {
		return plain, nil
	}
	nonce := make([]byte, s.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.gcm.Seal(nonce, nonce, plain, nil), nil
}

func (s *Store) unseal(blob []byte) ([]byte, bool) {
	if s.gcm == nil {
		return blob, true
	}
	ns := s.gcm.NonceSize()
	if len(blob) < ns {
		return nil, false
	}
	plain, err := s.gcm.Open(nil, blob[:ns], blob[ns:], nil)
	if err != nil {
		return nil, false
	}
	return plain, true
}

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
	var blob []byte
	row := s.db.QueryRow(`SELECT result_json, fetched_at FROM query_cache WHERE key = ?`, key)
	if err := row.Scan(&blob, &fetchedAt); err != nil {
		return nil, 0, false
	}
	plain, ok := s.unseal(blob)
	if !ok {
		return nil, 0, false
	}
	return plain, fetchedAt, true
}

// PutQuery inserts or replaces a cached result, then evicts old rows past the cap.
func (s *Store) PutQuery(key, host string, raw []byte, count int, fetchedAt int64) error {
	blob, err := s.seal(raw)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(
		`INSERT INTO query_cache(key,host,result_json,count,fetched_at) VALUES(?,?,?,?,?)
		 ON CONFLICT(key) DO UPDATE SET result_json=excluded.result_json, count=excluded.count, fetched_at=excluded.fetched_at`,
		key, host, blob, count, fetchedAt); err != nil {
		return err
	}
	_, _ = s.db.Exec(`DELETE FROM query_cache WHERE key NOT IN (SELECT key FROM query_cache ORDER BY fetched_at DESC LIMIT ?)`, maxQueryRows)
	return nil
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
		var blob []byte
		if err := rows.Scan(&id, &blob); err == nil {
			if plain, ok := s.unseal(blob); ok {
				out[id] = plain
			}
		}
	}
	return out, rows.Err()
}

// PutM365 caches one identity's lookup result, then evicts old rows past the cap.
func (s *Store) PutM365(account, identity string, raw []byte, fetchedAt int64) error {
	blob, err := s.seal(raw)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(
		`INSERT INTO m365_cache(account,identity,user_json,fetched_at) VALUES(?,?,?,?)
		 ON CONFLICT(account,identity) DO UPDATE SET user_json=excluded.user_json, fetched_at=excluded.fetched_at`,
		account, identity, blob, fetchedAt); err != nil {
		return err
	}
	_, _ = s.db.Exec(`DELETE FROM m365_cache WHERE rowid NOT IN (SELECT rowid FROM m365_cache ORDER BY fetched_at DESC LIMIT ?)`, maxM365Rows)
	return nil
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
