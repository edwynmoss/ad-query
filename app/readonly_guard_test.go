package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// AD Query's core, non-negotiable promise is that it is strictly READ-ONLY: it
// never writes to Active Directory / LDAP, and its Microsoft Graph calls are
// GET-only (the only POSTs are to the OAuth token/device-code endpoints during
// sign-in). This guard fails the build the moment that promise is broken, so a
// future change can't quietly introduce a mutation.

// goReadFiles returns the contents of every non-test .go file under dir.
func goReadFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		out[path] = string(b)
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", dir, err)
	}
	if len(out) == 0 {
		t.Fatalf("no .go files found under %s, guard would be vacuous", dir)
	}
	return out
}

func TestNoLDAPWrites(t *testing.T) {
	// The go-ldap write paths all require one of these request constructors;
	// you cannot mutate the directory without building one.
	forbidden := []string{
		"NewAddRequest", "NewModifyRequest", "NewModifyDNRequest",
		"NewDelRequest", "NewPasswordModifyRequest",
	}
	for path, src := range goReadFiles(t, "backend/ldap") {
		for _, bad := range forbidden {
			if strings.Contains(src, bad) {
				t.Errorf("read-only violation: %s references %q, AD Query must never write to the directory", path, bad)
			}
		}
	}
}

func TestGraphIsGetOnly(t *testing.T) {
	read := func(name string) string {
		b, err := os.ReadFile(filepath.Join("backend", "m365", name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(b)
	}

	// graph.go is pure GET, no non-GET HTTP method at all. OAuth POSTs live in
	// auth.go / authcode.go (the sign-in flow), not the data layer.
	graph := read("graph.go")
	for _, bad := range []string{"http.MethodPost", "http.MethodPut", "http.MethodPatch", "http.MethodDelete"} {
		if strings.Contains(graph, bad) {
			t.Errorf("read-only violation: graph.go uses %q, Graph enrichment must be GET-only", bad)
		}
	}

	// batch.go POSTs to the /$batch endpoint, but that POST is read-only: it only
	// wraps GET sub-requests. Forbid mutating methods outright, and prove the
	// sub-requests are GET-only (no non-GET Method literals).
	batch := read("batch.go")
	for _, bad := range []string{"http.MethodPut", "http.MethodPatch", "http.MethodDelete"} {
		if strings.Contains(batch, bad) {
			t.Errorf("read-only violation: batch.go uses %q, must never mutate via Graph", bad)
		}
	}
	for _, badSub := range []string{`Method: "POST"`, `Method: "PUT"`, `Method: "PATCH"`, `Method: "DELETE"`} {
		if strings.Contains(batch, badSub) {
			t.Errorf("read-only violation: batch.go builds a %s sub-request, $batch must carry GET only", badSub)
		}
	}
	if !strings.Contains(batch, `Method: "GET"`) {
		t.Error("batch.go should build GET sub-requests; guard may be checking the wrong shape")
	}
}
