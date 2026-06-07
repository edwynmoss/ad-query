//go:build windows

package ldap

import (
	"fmt"

	goldap "github.com/go-ldap/ldap/v3"
	"github.com/go-ldap/ldap/v3/gssapi"
)

// sspiBind performs Windows Integrated Authentication (SASL GSSAPI over SSPI).
//
//   - BindDN empty  → use the *current logged-in Windows user's* Kerberos ticket
//     with no password prompt. This is the true single-sign-on path; it requires
//     the machine to be domain-joined and is validated on a real domain.
//   - BindDN set    → authenticate as an explicit domain user/password via SSPI.
func sspiBind(conn *goldap.Conn, opts ConnectOptions) error {
	var (
		cl  goldap.GSSAPIClient
		err error
	)
	if opts.BindDN == "" {
		cl, err = gssapi.NewSSPIClient() // current login → SSO
	} else {
		cl, err = gssapi.NewSSPIClientWithUserCredentials(opts.Realm, opts.BindDN, opts.Password)
	}
	if err != nil {
		return fmt.Errorf("sspi client: %w", err)
	}
	defer cl.DeleteSecContext()

	if err := conn.GSSAPIBind(cl, opts.spn(), ""); err != nil {
		return fmt.Errorf("sspi gssapi bind to %q: %w", opts.spn(), err)
	}
	return nil
}
