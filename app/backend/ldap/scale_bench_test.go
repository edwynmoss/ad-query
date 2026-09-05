package ldap

// Ad-hoc scale benchmark (not part of the normal suite, guarded by RUN_SCALE).
// Measures the full path the app's App.Search uses against the 25k OpenLDAP:
// paged search → build SearchResult → JSON-marshal it (what crosses the Wails
// bridge to the webview). Run with:
//   RUN_SCALE=1 go test ./backend/ldap/ -run TestScale25k -v -count=1

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestScale25k(t *testing.T) {
	if os.Getenv("RUN_SCALE") == "" {
		t.Skip("set RUN_SCALE=1 to run the 25k scale benchmark")
	}

	conn, err := Connect(ConnectOptions{
		Host: "localhost", Port: 3389, Encryption: EncryptionNone,
		BindDN: "cn=admin,dc=adquery,dc=test", Password: "AdminPass123!",
		InsecureSkipVerify: true, Timeout: 30, Auth: AuthSimple,
	})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close()

	req := SearchRequest{
		BaseDN: "dc=adquery,dc=test", Scope: ScopeSubtree,
		Filter:     "(objectClass=inetOrgPerson)",
		Attributes: []string{"displayName", "uid", "mail", "title", "departmentNumber", "telephoneNumber"},
		PageSize:   1000, SizeLimit: 0,
	}

	t0 := time.Now()
	res, err := conn.Search(req)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	searchMS := time.Since(t0).Milliseconds()

	t1 := time.Now()
	buf, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	marshalMS := time.Since(t1).Milliseconds()

	t.Logf("entries=%d  search+build=%dms  json.Marshal=%dms  payload=%.1fMB",
		res.Count, searchMS, marshalMS, float64(len(buf))/1e6)
}
