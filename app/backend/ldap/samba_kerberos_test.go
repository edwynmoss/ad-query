package ldap

import "testing"

// TestSambaKerberosBind exercises the real SASL GSSAPI / Kerberos bind path
// against the Samba AD DC's KDC (test/samba-ad), using explicit credentials via
// the pure-Go client. This validates the same code the Windows SSPI path uses,
// minus the OS ticket cache. Skipped if the KDC / DC isn't reachable.
func TestSambaKerberosBind(t *testing.T) {
	opts := ConnectOptions{
		Host:             "localhost",
		Port:             1389,
		Encryption:       EncryptionNone,
		Auth:             AuthKerberos,
		BindDN:           "administrator", // sAMAccountName / principal short name
		Password:         "AdminPass123!",
		Realm:            "ADQUERY.TEST",
		KDC:              "127.0.0.1:88",
		ServicePrincipal: "ldap/dc1.adquery.test",
	}
	c, err := Connect(opts)
	if err != nil {
		t.Skipf("Kerberos bind against Samba KDC not available: %v", err)
	}
	defer c.Close()

	// Confirm the authenticated session actually works.
	res, err := c.Search(SearchRequest{
		BaseDN:     "DC=adquery,DC=test",
		Scope:      ScopeBase,
		Filter:     "(objectClass=*)",
		Attributes: []string{"dn"},
	})
	if err != nil {
		t.Fatalf("search after kerberos bind: %v", err)
	}
	if res.Count != 1 {
		t.Errorf("expected the base object, got %d entries", res.Count)
	}
	t.Logf("Kerberos GSSAPI bind succeeded; base search returned %d entry", res.Count)
}
