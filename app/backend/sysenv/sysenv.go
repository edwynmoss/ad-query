// Package sysenv detects whether the host is joined to a domain, so the app can
// offer a zero-configuration "connect to my domain as me" path instead of
// making the user type a server and password.
package sysenv

import (
	"os"
	"strings"
)

// Domain describes the directory the current machine/user belongs to.
type Domain struct {
	Joined bool   `json:"joined"`
	Domain string `json:"domain"` // AD DNS domain, e.g. CORP.EXAMPLE.COM
	Server string `json:"server"` // suggested server (the domain FQDN; DNS resolves it to a live DC)
	User   string `json:"user"`   // current user principal, e.g. alice@corp.example.com
}

// Detect inspects the environment for domain membership. On a domain-joined
// Windows session USERDNSDOMAIN is populated; on a workgroup machine it is
// empty, in which case Joined is false and the UI falls back to manual entry.
func Detect() Domain {
	dns := strings.TrimSpace(os.Getenv("USERDNSDOMAIN"))
	if dns == "" {
		return Domain{Joined: false}
	}
	dns = strings.ToLower(dns)
	d := Domain{Joined: true, Domain: dns, Server: dns}
	if user := strings.TrimSpace(os.Getenv("USERNAME")); user != "" {
		d.User = strings.ToLower(user) + "@" + dns
	}
	return d
}
