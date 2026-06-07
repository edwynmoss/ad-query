package ldap

import (
	"testing"
)

// testOptions point at the Dockerized OpenLDAP from test/openldap.
// docker compose up -d in that directory before running these.
func testOptions() ConnectOptions {
	return ConnectOptions{
		Host:       "localhost",
		Port:       3389,
		Encryption: EncryptionNone,
		BindDN:     "cn=admin,dc=adquery,dc=test",
		Password:   "AdminPass123!",
	}
}

// connectOrSkip dials the test directory or skips the test if it is unreachable
// (so `go test ./...` passes on machines without the container running).
func connectOrSkip(t *testing.T) *Conn {
	t.Helper()
	c, err := Connect(testOptions())
	if err != nil {
		t.Skipf("test OpenLDAP not reachable (start test/openldap): %v", err)
	}
	return c
}

func TestIntegrationConnectAndRootDSE(t *testing.T) {
	c := connectOrSkip(t)
	defer c.Close()

	info, err := c.RootDSE()
	if err != nil {
		t.Fatalf("RootDSE: %v", err)
	}
	if info.IsActiveDirectory {
		t.Errorf("OpenLDAP should not be detected as Active Directory")
	}
	if len(info.NamingContexts) == 0 {
		t.Errorf("expected at least one naming context")
	}
}

func TestIntegrationSearchUsers(t *testing.T) {
	c := connectOrSkip(t)
	defer c.Close()

	res, err := c.Search(SearchRequest{
		BaseDN:     "dc=adquery,dc=test",
		Scope:      ScopeSubtree,
		Filter:     "(objectClass=inetOrgPerson)",
		Attributes: []string{"uid", "cn", "mail", "title", "departmentNumber"},
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if res.Count != 7 {
		t.Errorf("expected 7 users, got %d", res.Count)
	}
	// Spot-check a known entry.
	var foundJane bool
	for _, e := range res.Entries {
		if vals := e.Attributes["uid"]; len(vals) == 1 && vals[0] == "jdoe" {
			foundJane = true
			if got := e.Attributes["mail"]; len(got) != 1 || got[0] != "jane.doe@adquery.test" {
				t.Errorf("jdoe mail = %v", got)
			}
		}
	}
	if !foundJane {
		t.Errorf("did not find user jdoe in results")
	}
}

func TestIntegrationScopeOneLevel(t *testing.T) {
	c := connectOrSkip(t)
	defer c.Close()

	// One-level under ou=Groups should be exactly the 4 groups.
	res, err := c.Search(SearchRequest{
		BaseDN: "ou=Groups,dc=adquery,dc=test",
		Scope:  ScopeOneLevel,
		Filter: "(objectClass=groupOfNames)",
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if res.Count != 4 {
		t.Errorf("expected 4 groups, got %d", res.Count)
	}
}
