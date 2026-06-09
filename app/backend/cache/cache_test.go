package cache

import (
	"path/filepath"
	"testing"
)

func TestQueryRoundTrip(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "c.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	k := QueryKey("dc1", "cn=admin", "dc=x", 2, "(objectClass=user)", []string{"cn", "mail"})
	// key is order-independent on attributes
	if k != QueryKey("dc1", "cn=admin", "dc=x", 2, "(objectClass=user)", []string{"mail", "cn"}) {
		t.Fatal("QueryKey should be attribute-order independent")
	}
	// a different bind identity on the same host must NOT collide
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
	// overwrite (rescan)
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
	s, err := Open(filepath.Join(t.TempDir(), "c.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

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
	// scoped by account
	if other, _ := s.GetM365("someone@else.test", []string{"jdoe@corp.test"}); len(other) != 0 {
		t.Fatal("cache must be scoped per signed-in account")
	}
}
