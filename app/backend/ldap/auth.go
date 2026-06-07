package ldap

import (
	"fmt"
	"os"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
	"github.com/go-ldap/ldap/v3/gssapi"
)

// kerberosBind performs a SASL GSSAPI bind using explicit Kerberos credentials
// via a pure-Go client (gokrb5). This works cross-platform and, unlike SSPI,
// does not require the host to be domain-joined — it talks to the KDC directly,
// which is what makes it testable against the Samba AD container.
func kerberosBind(conn *goldap.Conn, opts ConnectOptions) error {
	realm := strings.ToUpper(opts.Realm)
	if realm == "" {
		return fmt.Errorf("kerberos auth requires a realm")
	}
	if opts.KDC == "" {
		return fmt.Errorf("kerberos auth requires a KDC address (host:port)")
	}

	confPath, cleanup, err := writeKrb5Conf(realm, opts.KDC)
	if err != nil {
		return fmt.Errorf("write krb5.conf: %w", err)
	}
	defer cleanup()

	// For Kerberos the "username" is the account name (sAMAccountName / principal
	// short name), not a full bind DN.
	username := opts.BindDN
	cl, err := gssapi.NewClientWithPassword(username, realm, opts.Password, confPath)
	if err != nil {
		return fmt.Errorf("kerberos client (%s@%s): %w", username, realm, err)
	}
	defer cl.Close()

	if err := conn.GSSAPIBind(cl, opts.spn(), ""); err != nil {
		return fmt.Errorf("gssapi bind to %q: %w", opts.spn(), err)
	}
	return nil
}

// writeKrb5Conf writes a minimal krb5.conf pointing at a single KDC. TCP is
// forced (udp_preference_limit = 1) because AD tickets are large and UDP can
// fragment — also more reliable across Docker port mapping.
func writeKrb5Conf(realm, kdc string) (path string, cleanup func(), err error) {
	conf := fmt.Sprintf(`[libdefaults]
  default_realm = %s
  dns_lookup_kdc = false
  dns_lookup_realm = false
  udp_preference_limit = 1

[realms]
  %s = {
    kdc = %s
  }
`, realm, realm, kdc)

	f, err := os.CreateTemp("", "adquery-krb5-*.conf")
	if err != nil {
		return "", nil, err
	}
	if _, err := f.WriteString(conf); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", nil, err
	}
	f.Close()
	return f.Name(), func() { os.Remove(f.Name()) }, nil
}
