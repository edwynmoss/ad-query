//go:build !windows

package ldap

import (
	"fmt"

	goldap "github.com/go-ldap/ldap/v3"
)

// sspiBind is Windows-only. On other platforms, use AuthKerberos instead.
func sspiBind(_ *goldap.Conn, _ ConnectOptions) error {
	return fmt.Errorf("SSPI / Windows Integrated Auth is only available on Windows; use kerberos auth instead")
}
