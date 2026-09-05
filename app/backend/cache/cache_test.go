package cache

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

var testKey = bytes.Repeat([]byte{7}, 32)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "c.db"), testKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestQueryRoundTrip(t *testing.T) {
	s := openTest(t)
	k := QueryKey("dc1", "cn=admin", "dc=x", 2, "(objectClass=user)", []string{"cn", "mail"})
	if k != QueryKey("dc1", "cn=admin", "dc=x", 2, "(objectClass=user)", []string{"mail", "cn"}) {
		t.Fatal("QueryKey should be attribute-order independent")
	}
	if k == QueryKey("dc1", "cn=other", "dc=x", 2, "(objectClass=user)", []string{"cn", "mail"}) {
		t.Fatal("QueryKey must be scoped per bind identity")
	}
	if _, _, ok := s.GetQuery(k); ok {
		t.Fatal("expected miss before put")
	}
	if err := s.PutQuery(k, "dc1", []byte(`{"count":3}`), 3, 1000); err != nil {
		t.Fatal(err)
	}
	raw, at, ok := s.GetQuery(k)
	if !ok || at != 1000 || string(raw) != `{"count":3}` {
		t.Fatalf("get = %q,%d,%v", raw, at, ok)
	}
	if err := s.PutQuery(k, "dc1", []byte(`{"count":9}`), 9, 2000); err != nil {
		t.Fatal(err)
	}
	if raw, at, _ := s.GetQuery(k); string(raw) != `{"count":9}` || at != 2000 {
		t.Fatalf("after rescan = %q,%d", raw, at)
	}
	if err := s.ClearHost("dc1"); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := s.GetQuery(k); ok {
		t.Fatal("expected miss after ClearHost")
	}
}

func TestM365Cache(t *testing.T) {
	s := openTest(t)
	acct := "admin@corp.test"
	if err := s.PutM365(acct, "jdoe@corp.test", []byte(`{"exists":true}`), 1000); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetM365(acct, []string{"jdoe@corp.test", "missing@corp.test"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || string(got["jdoe@corp.test"]) != `{"exists":true}` {
		t.Fatalf("got %v", got)
	}
	if other, _ := s.GetM365("someone@else.test", []string{"jdoe@corp.test"}); len(other) != 0 {
		t.Fatal("cache must be scoped per signed-in account")
	}
}

func TestEncryptionAtRest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "c.db")
	marker := `SECRET-jane.doe@corp.test`

	s, err := Open(path, testKey)
	if err != nil {
		t.Fatal(err)
	}
	k := QueryKey("dc1", "cn=admin", "dc=x", 2, "(f)", []string{"cn"})
	if err := s.PutQuery(k, "dc1", []byte(`{"v":"`+marker+`"}`), 1, 1); err != nil {
		t.Fatal(err)
	}
	s.Close() // checkpoint WAL into the main file

	// The plaintext marker must not appear anywhere in the on-disk database.
	for _, f := range []string{path, path + "-wal"} {
		if b, err := os.ReadFile(f); err == nil && bytes.Contains(b, []byte(marker)) {
			t.Fatalf("plaintext %q found in %s, not encrypted at rest", marker, f)
		}
	}

	// Right key reads it back; a different key gets a miss (not an error/garbage).
	s2, _ := Open(path, testKey)
	defer s2.Close()
	if raw, _, ok := s2.GetQuery(k); !ok || !bytes.Contains(raw, []byte(marker)) {
		t.Fatalf("correct key failed to read back: ok=%v raw=%q", ok, raw)
	}
	s3, _ := Open(path, bytes.Repeat([]byte{9}, 32))
	defer s3.Close()
	if _, _, ok := s3.GetQuery(k); ok {
		t.Fatal("a different key must NOT decrypt the row (expected miss)")
	}
}

func TestEviction(t *testing.T) {
	s := openTest(t)
	for i := 0; i < maxQueryRows+25; i++ {
		k := QueryKey("dc1", "b", "dc=x", 2, fmt.Sprintf("(n=%d)", i), []string{"cn"})
		if err := s.PutQuery(k, "dc1", []byte(`{}`), 0, int64(i)); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM query_cache`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != maxQueryRows {
		t.Fatalf("query_cache has %d rows, want eviction to cap at %d", n, maxQueryRows)
	}
	// The oldest (i=0) must have been evicted; the newest must remain.
	newest := QueryKey("dc1", "b", "dc=x", 2, fmt.Sprintf("(n=%d)", maxQueryRows+24), []string{"cn"})
	if _, _, ok := s.GetQuery(newest); !ok {
		t.Fatal("newest row should survive eviction")
	}
}

func TestMigrationDropsPreV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "c.db")
	// Simulate a pre-v2 (plaintext) database: create the schema, stamp an old
	// version, and insert a row directly.
	s, _ := Open(path, testKey)
	_, _ = s.db.Exec(`PRAGMA user_version=1`)
	_, _ = s.db.Exec(`INSERT INTO query_cache(key,host,result_json,count,fetched_at) VALUES('old','dc1','plaintext',1,1)`)
	s.Close()

	// Reopening must migrate to v2 and clear the incompatible row.
	s2, err := Open(path, testKey)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	var n int
	_ = s2.db.QueryRow(`SELECT COUNT(*) FROM query_cache`).Scan(&n)
	if n != 0 {
		t.Fatalf("pre-v2 rows should be cleared on migration, found %d", n)
	}
	var ver int
	_ = s2.db.QueryRow(`PRAGMA user_version`).Scan(&ver)
	if ver != schemaVersion {
		t.Fatalf("user_version = %d, want %d", ver, schemaVersion)
	}
}
