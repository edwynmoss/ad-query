package ldap

import (
	"strings"
	"testing"

	"app/backend/adtypes"
)

// These run against the Samba AD test directory (test/samba-ad) on localhost:1389.
// Unlike OpenLDAP, this is real Active Directory, so it exercises AD detection,
// AD-mode filters, and, most importantly, the security-descriptor parser
// against a genuine nTSecurityDescriptor. Skipped if Samba isn't running.

func sambaOptions() ConnectOptions {
	return ConnectOptions{
		Host:       "localhost",
		Port:       1389,
		Encryption: EncryptionNone,
		BindDN:     "administrator@adquery.test",
		Password:   "AdminPass123!",
	}
}

func sambaConnectOrSkip(t *testing.T) *Conn {
	t.Helper()
	c, err := Connect(sambaOptions())
	if err != nil {
		t.Skipf("Samba AD not reachable (start test/samba-ad): %v", err)
	}
	return c
}

func TestSambaIsActiveDirectory(t *testing.T) {
	c := sambaConnectOrSkip(t)
	defer c.Close()

	info, err := c.RootDSE()
	if err != nil {
		t.Fatalf("RootDSE: %v", err)
	}
	if !info.IsActiveDirectory {
		t.Errorf("Samba should be detected as Active Directory (defaultNC=%q)", info.DefaultNamingContext)
	}
	if !strings.EqualFold(info.DefaultNamingContext, "DC=adquery,DC=test") {
		t.Errorf("defaultNamingContext = %q, want DC=adquery,DC=test", info.DefaultNamingContext)
	}
}

func TestSambaSearchADUsers(t *testing.T) {
	c := sambaConnectOrSkip(t)
	defer c.Close()

	// The AD-mode "Users" preset filter.
	res, err := c.Search(SearchRequest{
		BaseDN:     "DC=adquery,DC=test",
		Scope:      ScopeSubtree,
		Filter:     "(&(objectCategory=person)(objectClass=user))",
		Attributes: []string{"sAMAccountName", "userAccountControl"},
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if res.Count == 0 {
		t.Fatalf("expected at least the Administrator user")
	}
	var foundAdmin bool
	for _, e := range res.Entries {
		if strings.EqualFold(firstVal(e, "sAMAccountName"), "Administrator") {
			foundAdmin = true
		}
	}
	if !foundAdmin {
		t.Errorf("Administrator not found among %d AD users", res.Count)
	}
}

// TestSambaParseRealACL is the key one: fetch a real AD security descriptor via
// the SD-flags control and parse it with the same code the app uses.
func TestSambaParseRealACL(t *testing.T) {
	c := sambaConnectOrSkip(t)
	defer c.Close()

	dn := "CN=Administrator,CN=Users,DC=adquery,DC=test"
	raw, err := c.FetchSecurityDescriptor(dn, 0)
	if err != nil {
		t.Fatalf("FetchSecurityDescriptor: %v", err)
	}
	sd, err := adtypes.ParseSecurityDescriptor(raw)
	if err != nil {
		t.Fatalf("ParseSecurityDescriptor on real AD SD: %v", err)
	}
	if sd.Owner == "" {
		t.Errorf("expected an owner in the real AD security descriptor")
	}
	if len(sd.DACL) == 0 {
		t.Errorf("expected ACEs in the real AD DACL")
	}
	// Sanity: every ACE should have resolved a SID and at least the type.
	for i, ace := range sd.DACL {
		if ace.SID == "" {
			t.Errorf("ACE %d has empty SID", i)
		}
	}
	t.Logf("parsed real AD SD: owner=%s group=%s aces=%d", sd.Owner, sd.Group, len(sd.DACL))
}

func firstVal(e Entry, attr string) string {
	if v := e.Attributes[attr]; len(v) > 0 {
		return v[0]
	}
	return ""
}

// A size limit has to stop the paging, not just the page. Before this was
// enforced client-side, asking for forty matches on a directory with tens of
// thousands of accounts read every page to the end: the caller got the forty
// it asked for only because it ignored the rest, after the whole set had
// crossed the wire.
func TestSambaSizeLimitStopsPaging(t *testing.T) {
	c := sambaConnectOrSkip(t)
	defer c.Close()

	info, err := c.RootDSE()
	if err != nil {
		t.Fatalf("RootDSE: %v", err)
	}
	root := info.DefaultNamingContext

	all, err := c.Search(SearchRequest{BaseDN: root, Scope: ScopeSubtree, Filter: "(&(objectCategory=person)(objectClass=user))", Attributes: []string{"1.1"}, PageSize: 1000})
	if err != nil {
		t.Fatalf("counting users: %v", err)
	}
	if all.Count < 25 {
		t.Skipf("only %d users in the directory, nothing to limit", all.Count)
	}

	const want = 20
	res, err := c.Search(SearchRequest{BaseDN: root, Scope: ScopeSubtree, Filter: "(&(objectCategory=person)(objectClass=user))", Attributes: []string{"1.1"}, PageSize: 1000, SizeLimit: want})
	if err != nil {
		t.Fatalf("limited search: %v", err)
	}
	if res.Count != want {
		t.Errorf("size limit %d returned %d entries", want, res.Count)
	}
	if !res.Truncated {
		t.Errorf("a search cut short by its size limit should say it was truncated")
	}

	// A limit no one reaches must not claim truncation.
	res, err = c.Search(SearchRequest{BaseDN: root, Scope: ScopeSubtree, Filter: "(&(objectCategory=person)(objectClass=user))", Attributes: []string{"1.1"}, PageSize: 1000, SizeLimit: all.Count + 100})
	if err != nil {
		t.Fatalf("generous limit: %v", err)
	}
	if res.Count != all.Count {
		t.Errorf("a limit above the total changed the answer: %d, want %d", res.Count, all.Count)
	}
	if res.Truncated {
		t.Errorf("a limit no one reached should not report truncation")
	}
}
