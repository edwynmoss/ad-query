package ldap

import (
	"fmt"

	goldap "github.com/go-ldap/ldap/v3"
)

// ServerInfo summarizes what the RootDSE tells us about a directory. It lets the
// UI distinguish AD from OpenLDAP and auto-suggest a base DN.
type ServerInfo struct {
	DefaultNamingContext string   `json:"defaultNamingContext"`
	NamingContexts       []string `json:"namingContexts"`
	SupportedControls    []string `json:"supportedControls"`
	SupportedSASL        []string `json:"supportedSASLMechanisms"`
	VendorName           string   `json:"vendorName"`
	VendorVersion        string   `json:"vendorVersion"`
	IsActiveDirectory    bool     `json:"isActiveDirectory"`
}

// RootDSE reads the server's root DSE (an unauthenticated base-scope search of
// the empty DN) and returns a summary.
func (c *Conn) RootDSE() (*ServerInfo, error) {
	if c == nil || c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	req := goldap.NewSearchRequest(
		"",
		goldap.ScopeBaseObject,
		goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=*)",
		[]string{
			"defaultNamingContext", "namingContexts", "supportedControl",
			"supportedSASLMechanisms", "vendorName", "vendorVersion",
			"dnsHostName", "forestFunctionality",
		},
		nil,
	)
	res, err := c.conn.Search(req)
	if err != nil {
		return nil, fmt.Errorf("read RootDSE: %w", err)
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("RootDSE returned no entry")
	}
	e := res.Entries[0]

	info := &ServerInfo{
		DefaultNamingContext: e.GetAttributeValue("defaultNamingContext"),
		NamingContexts:       e.GetAttributeValues("namingContexts"),
		SupportedControls:    e.GetAttributeValues("supportedControl"),
		SupportedSASL:        e.GetAttributeValues("supportedSASLMechanisms"),
		VendorName:           e.GetAttributeValue("vendorName"),
		VendorVersion:        e.GetAttributeValue("vendorVersion"),
	}
	// AD always populates defaultNamingContext and exposes a dnsHostName;
	// OpenLDAP exposes neither.
	info.IsActiveDirectory = info.DefaultNamingContext != "" || e.GetAttributeValue("dnsHostName") != ""

	// Fall back to the first naming context if the AD-specific one is absent.
	if info.DefaultNamingContext == "" && len(info.NamingContexts) > 0 {
		info.DefaultNamingContext = info.NamingContexts[0]
	}
	return info, nil
}
