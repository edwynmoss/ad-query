package main

import (
	"fmt"
	"sort"
	"strings"

	"app/backend/adtypes"
	"app/backend/gpo"
	"app/backend/ldap"
)

// Group Policy, read from the directory: which policies reach a user or
// computer (PolicyChain) and where every policy is linked (PolicyInventory).
// Both are read-only LDAP; see the gpo package for what they can and cannot
// know.

func (a *App) policyRoots() (*ldap.Conn, string, string, error) {
	a.mu.Lock()
	conn, server := a.conn, a.server
	a.mu.Unlock()
	if conn == nil || server == nil {
		return nil, "", "", fmt.Errorf("not connected: open a connection first")
	}
	if !server.IsActiveDirectory {
		return nil, "", "", fmt.Errorf("Group Policy is an Active Directory feature; this directory is plain LDAP")
	}
	root := server.DefaultNamingContext
	return conn, root, "CN=Configuration," + root, nil
}

// loadPolicies reads every groupPolicyContainer under the domain, keyed by
// lower-case DN. Security filtering is read per policy when withACL is set
// (or only for the DNs in acl when given).
func loadPolicies(conn *ldap.Conn, root string, acl map[string]bool) (map[string]gpo.Policy, []string) {
	var notes []string
	out := map[string]gpo.Policy{}
	res, err := conn.Search(ldap.SearchRequest{
		BaseDN: "CN=Policies,CN=System," + root, Scope: ldap.ScopeSubtree,
		Filter:     "(objectClass=groupPolicyContainer)",
		Attributes: []string{"displayName", "name", "flags", "versionNumber", "gPCFileSysPath", "gPCWQLFilter"},
		PageSize:   500,
	})
	if err != nil {
		return out, []string{"The policy objects under CN=Policies could not be read: " + err.Error()}
	}
	first := func(e ldap.Entry, a string) string {
		if v := e.Attributes[a]; len(v) > 0 {
			return v[0]
		}
		return ""
	}
	unreadable := 0
	for _, e := range res.Entries {
		p := gpo.Policy{DN: e.DN, GUID: first(e, "name"), Name: first(e, "displayName"), Path: first(e, "gPCFileSysPath"), WMIFilter: first(e, "gPCWQLFilter")}
		if p.Name == "" {
			p.Name = p.GUID
		}
		fmt.Sscanf(first(e, "versionNumber"), "%d", &p.Version)
		p.UserDisabled, p.ComputerDisabled = gpo.ParseFlags(first(e, "flags"))
		if acl == nil || acl[strings.ToLower(e.DN)] {
			if raw, err := conn.FetchSecurityDescriptor(e.DN, ldap.SDDACL); err == nil {
				if sd, err := adtypes.ParseSecurityDescriptor(raw); err == nil {
					p.ApplyAllow, p.ApplyDeny = gpo.ApplyRights(sd)
					p.ACLKnown = true
				}
			}
			if !p.ACLKnown {
				unreadable++
			}
		}
		out[strings.ToLower(e.DN)] = p
	}
	if unreadable > 0 {
		notes = append(notes, fmt.Sprintf("Security filtering could not be read on %d %s, so those are shown as applying to everyone.", unreadable, plural(unreadable, "policy", "policies")))
	}
	return out, notes
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// somFor reads gPLink and gPOptions on one container.
func somFor(conn *ldap.Conn, dn, kind string) (gpo.SOM, error) {
	res, err := conn.Search(ldap.SearchRequest{BaseDN: dn, Scope: ldap.ScopeBase, Filter: "(objectClass=*)", Attributes: []string{"gPLink", "gPOptions"}, PageSize: 1})
	if err != nil {
		return gpo.SOM{}, err
	}
	s := gpo.SOM{DN: dn, Kind: kind, Name: gpo.NameOf(dn, kind)}
	if len(res.Entries) == 0 {
		return s, nil
	}
	e := res.Entries[0]
	if v := e.Attributes["gPLink"]; len(v) > 0 {
		s.Links = gpo.ParseGPLink(v[0])
	}
	if v := e.Attributes["gPOptions"]; len(v) > 0 && strings.TrimSpace(v[0]) == "1" {
		s.BlockInheritance = true
	}
	return s, nil
}

// sites lists the sites in the configuration partition with their links.
func sites(conn *ldap.Conn, cfg string) ([]gpo.SOM, error) {
	res, err := conn.Search(ldap.SearchRequest{BaseDN: "CN=Sites," + cfg, Scope: ldap.ScopeSubtree, Filter: "(objectClass=site)", Attributes: []string{"gPLink", "gPOptions", "name"}, PageSize: 200})
	if err != nil {
		return nil, err
	}
	var out []gpo.SOM
	for _, e := range res.Entries {
		s := gpo.SOM{DN: e.DN, Kind: "site", Name: gpo.NameOf(e.DN, "site")}
		if v := e.Attributes["gPLink"]; len(v) > 0 {
			s.Links = gpo.ParseGPLink(v[0])
		}
		if v := e.Attributes["gPOptions"]; len(v) > 0 && strings.TrimSpace(v[0]) == "1" {
			s.BlockInheritance = true
		}
		out = append(out, s)
	}
	return out, nil
}

// sidNames resolves group and account SIDs to names in one query.
func sidNames(conn *ldap.Conn, root string, sids map[string]bool) map[string]string {
	names := map[string]string{}
	var parts []string
	for s := range sids {
		if n := adtypes.FriendlySID(s); n != s {
			names[s] = n
			continue
		}
		parts = append(parts, "(objectSid="+s+")")
	}
	if len(parts) == 0 {
		return names
	}
	sort.Strings(parts)
	res, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: "(|" + strings.Join(parts, "") + ")", Attributes: []string{"sAMAccountName", "name", "objectSid"}, PageSize: 500})
	if err != nil {
		return names
	}
	for _, e := range res.Entries {
		raw := e.RawValues["objectSid"]
		if len(raw) == 0 {
			continue
		}
		sid, err := adtypes.SIDToString(raw[0])
		if err != nil {
			continue
		}
		n := ""
		if v := e.Attributes["sAMAccountName"]; len(v) > 0 {
			n = v[0]
		} else if v := e.Attributes["name"]; len(v) > 0 {
			n = v[0]
		}
		if n != "" {
			names[strings.ToUpper(sid)] = n
		}
	}
	return names
}

// PolicyChain lays out which Group Policy Objects reach one user or computer,
// in precedence order, with a verdict for every link on the way.
func (a *App) PolicyChain(dn string) (*gpo.Chain, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	// The target: what it is and what it presents to security filtering.
	res, err := conn.Search(ldap.SearchRequest{BaseDN: dn, Scope: ldap.ScopeBase, Filter: "(objectClass=*)", Attributes: []string{"objectClass", "objectSid", "tokenGroups"}, PageSize: 1})
	if err != nil {
		return nil, err
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("object %q not found", dn)
	}
	t := res.Entries[0]
	kind := ""
	for _, c := range t.Attributes["objectClass"] {
		switch strings.ToLower(c) {
		case "computer":
			kind = "computer"
		case "user":
			if kind == "" {
				kind = "user"
			}
		}
	}
	if kind == "" {
		return nil, fmt.Errorf("Group Policy applies to users and computers; this object is neither")
	}
	own := ""
	if raw := t.RawValues["objectSid"]; len(raw) > 0 {
		own, _ = adtypes.SIDToString(raw[0])
	}
	var groups []string
	for _, raw := range t.RawValues["tokenGroups"] {
		if s, err := adtypes.SIDToString(raw); err == nil {
			groups = append(groups, s)
		}
	}
	token := gpo.Token(own, groups)

	var notes []string
	var path []gpo.SOM
	// Site: only certain when the forest has exactly one.
	if ss, err := sites(conn, cfg); err == nil {
		switch len(ss) {
		case 0:
		case 1:
			path = append(path, ss[0])
		default:
			notes = append(notes, fmt.Sprintf("The forest has %d sites and the directory does not record which one this object is in, so site-linked policies are left out.", len(ss)))
		}
	}
	for _, cdn := range gpo.PathFromDN(dn, root) {
		kind := "ou"
		if strings.EqualFold(cdn, root) {
			kind = "domain"
		}
		s, err := somFor(conn, cdn, kind)
		if err != nil {
			notes = append(notes, "Could not read "+cdn+": "+err.Error())
			continue
		}
		path = append(path, s)
	}
	linked := map[string]bool{}
	for _, s := range path {
		for _, l := range s.Links {
			linked[strings.ToLower(l.PolicyDN)] = true
		}
	}
	policies, pnotes := loadPolicies(conn, root, linked)
	notes = append(notes, pnotes...)

	chain := gpo.Resolve(dn, kind, path, policies, token)
	chain.Notes = append(notes, "Read from the directory only: WMI filters are not evaluated, loopback and slow-link processing happen on the client, and the settings inside each policy live in SYSVOL.")
	sids := map[string]bool{}
	for _, e := range chain.Entries {
		for _, s := range append(e.Policy.ApplyAllow, e.Policy.ApplyDeny...) {
			sids[s] = true
		}
	}
	chain.Names = sidNames(conn, root, sids)
	return chain, nil
}

// PolicyInventory lists every policy in the domain and where it is linked.
func (a *App) PolicyInventory() (*gpo.Inventory, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	policies, notes := loadPolicies(conn, root, nil)
	var soms []gpo.SOM
	if ss, err := sites(conn, cfg); err == nil {
		soms = append(soms, ss...)
	}
	res, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: "(gPLink=*)", Attributes: []string{"gPLink", "gPOptions", "objectClass"}, PageSize: 1000})
	if err != nil {
		return nil, err
	}
	for _, e := range res.Entries {
		kind := "ou"
		for _, c := range e.Attributes["objectClass"] {
			if strings.EqualFold(c, "domainDNS") || strings.EqualFold(c, "domain") {
				kind = "domain"
			}
		}
		s := gpo.SOM{DN: e.DN, Kind: kind, Name: gpo.NameOf(e.DN, kind)}
		if v := e.Attributes["gPLink"]; len(v) > 0 {
			s.Links = gpo.ParseGPLink(v[0])
		}
		if v := e.Attributes["gPOptions"]; len(v) > 0 && strings.TrimSpace(v[0]) == "1" {
			s.BlockInheritance = true
		}
		soms = append(soms, s)
	}
	inv := gpo.BuildInventory(policies, soms)
	inv.Notes = notes
	sids := map[string]bool{}
	for _, p := range inv.Policies {
		for _, s := range append(p.Policy.ApplyAllow, p.Policy.ApplyDeny...) {
			sids[s] = true
		}
	}
	inv.Names = sidNames(conn, root, sids)
	return inv, nil
}
