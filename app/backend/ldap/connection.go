// Package ldap wraps go-ldap with the connection, schema and paged-search
// helpers AD Query needs. It is deliberately read-only: no add/modify/delete
// operations are exposed.
package ldap

import (
	"crypto/tls"
	"fmt"
	"time"

	goldap "github.com/go-ldap/ldap/v3"
)

// Encryption selects how the LDAP connection is secured.
type Encryption string

const (
	EncryptionNone     Encryption = "none"     // plain ldap://
	EncryptionStartTLS Encryption = "starttls" // ldap:// upgraded with StartTLS
	EncryptionLDAPS    Encryption = "ldaps"    // ldaps:// (implicit TLS)
)

// ConnectOptions describes how to reach and authenticate to a directory.
// In v1 authentication is an explicit simple bind; integrated Windows auth
// (Kerberos/NTLM) is a planned follow-up.
type ConnectOptions struct {
	Host               string     `json:"host"`
	Port               int        `json:"port"`
	Encryption         Encryption `json:"encryption"`
	BindDN             string     `json:"bindDN"`   // empty => anonymous bind
	Password           string     `json:"password"`
	InsecureSkipVerify bool       `json:"insecureSkipVerify"` // accept self-signed (dev/OpenLDAP)
	Timeout            int        `json:"timeoutSeconds"`     // 0 => default

	// Authentication method:
	//   "" / "simple": simple bind with BindDN + Password (default)
	//   "kerberos": SASL GSSAPI via explicit Kerberos creds (cross-platform, testable)
	//   "sspi": Windows Integrated Auth; blank BindDN = current logged-in user (SSO)
	Auth AuthMethod `json:"auth"`
	// Kerberos / SSPI parameters.
	Realm            string `json:"realm"`            // e.g. ADQUERY.TEST
	KDC              string `json:"kdc"`              // host:port (kerberos only; e.g. 127.0.0.1:88)
	ServicePrincipal string `json:"servicePrincipal"` // e.g. ldap/dc1.adquery.test; defaults to ldap/<host>
}

// AuthMethod selects how the bind is performed.
type AuthMethod string

const (
	AuthSimple   AuthMethod = "simple"
	AuthKerberos AuthMethod = "kerberos"
	AuthSSPI     AuthMethod = "sspi"
)

// Conn is an authenticated directory connection.
type Conn struct {
	conn *goldap.Conn
	opts ConnectOptions
}

func (o ConnectOptions) url() string {
	scheme := "ldap"
	if o.Encryption == EncryptionLDAPS {
		scheme = "ldaps"
	}
	port := o.Port
	if port == 0 {
		if o.Encryption == EncryptionLDAPS {
			port = 636
		} else {
			port = 389
		}
	}
	return fmt.Sprintf("%s://%s:%d", scheme, o.Host, port)
}

// Connect dials the directory, optionally upgrades to TLS, and performs the
// bind. The caller owns the returned Conn and must Close it.
func Connect(opts ConnectOptions) (*Conn, error) {
	if opts.Host == "" {
		return nil, fmt.Errorf("host is required")
	}

	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		ServerName:         opts.Host,
		InsecureSkipVerify: opts.InsecureSkipVerify, //nolint:gosec // user-opt-in for self-signed dev directories
	}

	dialOpts := []goldap.DialOpt{}
	if opts.Encryption == EncryptionLDAPS {
		dialOpts = append(dialOpts, goldap.DialWithTLSConfig(tlsCfg))
	}

	conn, err := goldap.DialURL(opts.url(), dialOpts...)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", opts.url(), err)
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 30
	}
	conn.SetTimeout(time.Duration(timeout) * time.Second)

	if opts.Encryption == EncryptionStartTLS {
		if err := conn.StartTLS(tlsCfg); err != nil {
			conn.Close()
			return nil, fmt.Errorf("starttls: %w", err)
		}
	}

	// Windows sign-in and Kerberos use SASL GSSAPI with no SASL security
	// layer (go-ldap's SSPI client cannot sign or seal LDAP traffic). Domain
	// controllers that require LDAP signing reject that unless the
	// connection is already TLS, so on a plain ldap:// connection we try to
	// upgrade first. A controller without a certificate simply refuses
	// StartTLS and we carry on in the clear; the bind then reports the
	// signing requirement in plain language if the controller enforces it.
	if opts.Encryption == EncryptionNone && (opts.Auth == AuthSSPI || opts.Auth == AuthKerberos) {
		if err := conn.StartTLS(tlsCfg); err != nil {
			// Keep the connection usable: go-ldap leaves it open on a
			// refused StartTLS extended operation, but a failed handshake
			// poisons it, so redial to be safe.
			conn.Close()
			conn, err = goldap.DialURL(opts.url(), dialOpts...)
			if err != nil {
				return nil, fmt.Errorf("dial %s: %w", opts.url(), err)
			}
			conn.SetTimeout(time.Duration(timeout) * time.Second)
		}
	}

	if err := authenticate(conn, opts); err != nil {
		conn.Close()
		return nil, err
	}

	return &Conn{conn: conn, opts: opts}, nil
}

// authenticate performs the bind according to opts.Auth.
func authenticate(conn *goldap.Conn, opts ConnectOptions) error {
	switch opts.Auth {
	case "", AuthSimple:
		if opts.BindDN == "" {
			if err := conn.UnauthenticatedBind(""); err != nil {
				return fmt.Errorf("anonymous bind: %w", err)
			}
			return nil
		}
		if err := conn.Bind(opts.BindDN, opts.Password); err != nil {
			return fmt.Errorf("bind as %q: %w", opts.BindDN, err)
		}
		return nil
	case AuthKerberos:
		return kerberosBind(conn, opts)
	case AuthSSPI:
		return sspiBind(conn, opts)
	default:
		return fmt.Errorf("unknown auth method %q", opts.Auth)
	}
}

func (opts ConnectOptions) spn() string {
	if opts.ServicePrincipal != "" {
		return opts.ServicePrincipal
	}
	return "ldap/" + opts.Host
}

// Close releases the underlying connection.
func (c *Conn) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}
