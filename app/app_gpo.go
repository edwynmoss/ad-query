package main

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"app/backend/adtypes"
	"app/backend/gpo"
	"app/backend/ldap"
)

// Group Policy, read from the directory: which policies reach a user or
// computer (PolicyChain), the same for a container (ContainerChain), the
// tree of containers for the map (PolicyMap), counts on demand (CountUnder)
// and every policy with its links (PolicyInventory). All read-only LDAP;
// see the gpo package for what they can and cannot know.

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

func first(e ldap.Entry, attr string) string {
	if v := e.Attributes[attr]; len(v) > 0 {
		return v[0]
	}
	return ""
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// loadPolicies reads every groupPolicyContainer under the domain in one
// query, security descriptor included (DACL only, via the SD-flags control),
// keyed by lower-case DN. WMI filter references are resolved to names.
func loadPolicies(conn *ldap.Conn, root string) (map[string]gpo.Policy, []string) {
	var notes []string
	out := map[string]gpo.Policy{}
	res, err := conn.Search(ldap.SearchRequest{
		BaseDN: "CN=Policies,CN=System," + root, Scope: ldap.ScopeSubtree,
		Filter:     "(objectClass=groupPolicyContainer)",
		Attributes: []string{"displayName", "name", "flags", "versionNumber", "gPCFileSysPath", "gPCWQLFilter", "nTSecurityDescriptor"},
		PageSize:   500, SDFlags: ldap.SDDACL,
	})
	if err != nil {
		return out, []string{"The policy objects under CN=Policies could not be read: " + err.Error()}
	}
	wmi := wmiFilterNames(conn, root)
	unreadable := 0
	for _, e := range res.Entries {
		p := gpo.Policy{DN: e.DN, GUID: first(e, "name"), Name: first(e, "displayName"), Path: first(e, "gPCFileSysPath"), WMIFilter: first(e, "gPCWQLFilter")}
		if p.Name == "" {
			p.Name = p.GUID
		}
		if p.WMIFilter != "" {
			// [domain;{GUID};0]
			if i := strings.Index(p.WMIFilter, "{"); i >= 0 {
				if j := strings.Index(p.WMIFilter[i:], "}"); j > 0 {
					p.WMIFilterName = wmi[strings.ToUpper(p.WMIFilter[i:i+j+1])]
				}
			}
		}
		fmt.Sscanf(first(e, "versionNumber"), "%d", &p.Version)
		p.UserDisabled, p.ComputerDisabled = gpo.ParseFlags(first(e, "flags"))
		if raw := e.RawValues["nTSecurityDescriptor"]; len(raw) > 0 && len(raw[0]) > 0 {
			if sd, err := adtypes.ParseSecurityDescriptor(raw[0]); err == nil {
				p.ApplyAllow, p.ApplyDeny = gpo.ApplyRights(sd)
				p.ACLKnown = true
			}
		}
		if !p.ACLKnown {
			unreadable++
		}
		out[strings.ToLower(e.DN)] = p
	}
	if unreadable > 0 {
		notes = append(notes, fmt.Sprintf("Security filtering could not be read on %d %s, so those are shown as applying to everyone.", unreadable, plural(unreadable, "policy", "policies")))
	}
	return out, notes
}

// wmiFilterNames maps WMI filter GUIDs to their names.
func wmiFilterNames(conn *ldap.Conn, root string) map[string]string {
	names := map[string]string{}
	res, err := conn.Search(ldap.SearchRequest{BaseDN: "CN=SOM,CN=WMIPolicy,CN=System," + root, Scope: ldap.ScopeSubtree, Filter: "(objectClass=msWMI-Som)", Attributes: []string{"msWMI-ID", "msWMI-Name"}, PageSize: 500})
	if err != nil {
		return names
	}
	for _, e := range res.Entries {
		if id := first(e, "msWMI-ID"); id != "" {
			names[strings.ToUpper(id)] = first(e, "msWMI-Name")
		}
	}
	return names
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
	res, err := conn.Search(ldap.SearchRequest{BaseDN: "CN=Sites," + cfg, Scope: ldap.ScopeSubtree, Filter: "(objectClass=site)", Attributes: []string{"gPLink", "gPOptions", "name"}, PageSize: 500})
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

// subnets lists CN=Subnets with the site each maps to.
func subnets(conn *ldap.Conn, cfg string) []gpo.Subnet {
	res, err := conn.Search(ldap.SearchRequest{BaseDN: "CN=Subnets,CN=Sites," + cfg, Scope: ldap.ScopeSubtree, Filter: "(objectClass=subnet)", Attributes: []string{"cn", "siteObject"}, PageSize: 1000})
	if err != nil {
		return nil
	}
	var out []gpo.Subnet
	for _, e := range res.Entries {
		if s, ok := gpo.ParseSubnet(first(e, "cn"), first(e, "siteObject")); ok && s.SiteDN != "" {
			out = append(out, s)
		}
	}
	return out
}

// siteForComputer places a computer the way it places itself: resolve its
// DNS name and match the address against the subnets, longest prefix wins.
func siteForComputer(conn *ldap.Conn, cfg, dnsHostName string, all []gpo.SOM) (gpo.SOM, string) {
	if dnsHostName == "" {
		return gpo.SOM{}, "The computer has no DNS name recorded, so its site is unknown."
	}
	ips, err := net.LookupIP(dnsHostName)
	if err != nil || len(ips) == 0 {
		return gpo.SOM{}, "The computer's name " + dnsHostName + " did not resolve from here, so its site is unknown."
	}
	subs := subnets(conn, cfg)
	for _, ip := range ips {
		if siteDN := gpo.SiteForIP(ip, subs); siteDN != "" {
			for _, s := range all {
				if strings.EqualFold(s.DN, siteDN) {
					return s, ""
				}
			}
		}
	}
	return gpo.SOM{}, "The computer's address " + ips[0].String() + " is in no subnet the directory knows, so its site is unknown."
}

// sidNames resolves group and account SIDs to names, fifty per query.
func sidNames(conn *ldap.Conn, root string, sids map[string]bool) map[string]string {
	names := map[string]string{}
	var pending []string
	for s := range sids {
		if n := adtypes.FriendlySID(s); n != s {
			names[s] = n
			continue
		}
		pending = append(pending, s)
	}
	sort.Strings(pending)
	for len(pending) > 0 {
		n := 50
		if len(pending) < n {
			n = len(pending)
		}
		var parts []string
		for _, s := range pending[:n] {
			parts = append(parts, "(objectSid="+s+")")
		}
		pending = pending[n:]
		res, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: "(|" + strings.Join(parts, "") + ")", Attributes: []string{"sAMAccountName", "name", "objectSid"}, PageSize: 500})
		if err != nil {
			continue
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
			if v := first(e, "sAMAccountName"); v != "" {
				names[strings.ToUpper(sid)] = v
			} else if v := first(e, "name"); v != "" {
				names[strings.ToUpper(sid)] = v
			}
		}
	}
	return names
}

func trusteeNames(conn *ldap.Conn, root string, entries []gpo.Entry) map[string]string {
	sids := map[string]bool{}
	for _, e := range entries {
		for _, s := range append(e.Policy.ApplyAllow, e.Policy.ApplyDeny...) {
			sids[s] = true
		}
	}
	return sidNames(conn, root, sids)
}

// pathFor reads the containers above an object (or including a container,
// when the DN is one) and picks the site when it can be known.
func (a *App) pathFor(conn *ldap.Conn, root, cfg, dn string, isContainer bool, kind string, dnsHostName string) ([]gpo.SOM, []string) {
	var notes []string
	var path []gpo.SOM
	if ss, err := sites(conn, cfg); err == nil {
		switch {
		case len(ss) == 1:
			path = append(path, ss[0])
		case len(ss) > 1 && kind == "computer" && !isContainer:
			s, why := siteForComputer(conn, cfg, dnsHostName, ss)
			if why == "" {
				path = append(path, s)
			} else {
				notes = append(notes, why+" Site-linked policies are left out.")
			}
		case len(ss) > 1 && isContainer:
			notes = append(notes, fmt.Sprintf("The forest has %d sites. A container trace leaves site-linked policies out; trace a computer to include its site.", len(ss)))
		case len(ss) > 1:
			notes = append(notes, fmt.Sprintf("The forest has %d sites. A user's site is wherever they sign in, which the directory does not record, so site-linked policies are left out.", len(ss)))
		}
	}
	probe := dn
	if isContainer {
		probe = "CN=x," + dn
	}
	for _, cdn := range gpo.PathFromDN(probe, root) {
		k := "ou"
		if strings.EqualFold(cdn, root) {
			k = "domain"
		}
		s, err := somFor(conn, cdn, k)
		if err != nil {
			notes = append(notes, "Could not read "+cdn+": "+err.Error())
			continue
		}
		path = append(path, s)
	}
	return path, notes
}

// PolicyChain lays out which Group Policy Objects reach one user or computer,
// in precedence order, with a verdict for every link on the way.
func (a *App) PolicyChain(dn string) (*gpo.Chain, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	res, err := conn.Search(ldap.SearchRequest{BaseDN: dn, Scope: ldap.ScopeBase, Filter: "(objectClass=*)", Attributes: []string{"objectClass", "objectSid", "tokenGroups", "dNSHostName"}, PageSize: 1})
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
	path, notes := a.pathFor(conn, root, cfg, dn, false, kind, first(t, "dNSHostName"))
	policies, pnotes := a.policies(conn, root)
	notes = append(notes, pnotes...)
	chain := gpo.Resolve(dn, kind, path, policies, gpo.Token(own, groups))
	chain.Notes = append(notes, "Read from the directory only: WMI filters are not evaluated, loopback and slow-link processing happen on the client, and the settings inside each policy live in SYSVOL.")
	chain.Names = trusteeNames(conn, root, chain.Entries)
	return chain, nil
}

// ContainerChain traces policy into a container (the domain or an OU) for
// users or computers in general, rather than one account.
func (a *App) ContainerChain(containerDN string, kind string) (*gpo.Chain, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	if kind != "computer" {
		kind = "user"
	}
	path, notes := a.pathFor(conn, root, cfg, containerDN, true, kind, "")
	policies, pnotes := a.policies(conn, root)
	notes = append(notes, pnotes...)
	chain := gpo.Resolve(containerDN, kind, path, policies, nil)
	chain.Notes = append(notes, "A container trace cannot know group membership, so links with security filtering are marked as depending on it. Trace a person for the exact answer.")
	chain.Names = trusteeNames(conn, root, chain.Entries)
	return chain, nil
}

// policyCache keeps the policy set for a minute so a map, a trace and a
// list opened together read CN=Policies once.
type policyCache struct {
	mu    sync.Mutex
	root  string
	at    time.Time
	set   map[string]gpo.Policy
	notes []string
}

var policySet policyCache

func (a *App) policies(conn *ldap.Conn, root string) (map[string]gpo.Policy, []string) {
	policySet.mu.Lock()
	defer policySet.mu.Unlock()
	if policySet.root == root && time.Since(policySet.at) < time.Minute && policySet.set != nil {
		return policySet.set, policySet.notes
	}
	set, notes := loadPolicies(conn, root)
	policySet.root, policySet.at, policySet.set, policySet.notes = root, time.Now(), set, notes
	return set, notes
}

func forgetPolicies() {
	policySet.mu.Lock()
	policySet.at = time.Time{}
	policySet.mu.Unlock()
}

// PolicyMap returns every container that can carry policy (site when there
// is one, the domain, every OU) with its links, marked for relevance. No
// counts: those come from CountUnder when a container is picked.
func (a *App) PolicyMap() (*gpo.Map, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	forgetPolicies()
	nodes, mnotes, err := containers(conn, root, cfg)
	if err != nil {
		return nil, err
	}
	m := &gpo.Map{Nodes: nodes, Notes: mnotes}
	set, notes := a.policies(conn, root)
	m.Policies = set
	m.Notes = append(m.Notes, notes...)
	sids := map[string]bool{}
	for _, p := range set {
		for _, s := range append(p.ApplyAllow, p.ApplyDeny...) {
			sids[s] = true
		}
	}
	m.Names = sidNames(conn, root, sids)
	return m, nil
}

// containers lists every container that can carry policy, sorted parents
// first and marked for relevance: the site when there is one, the domain,
// and every OU.
func containers(conn *ldap.Conn, root, cfg string) ([]gpo.MapNode, []string, error) {
	var nodes []gpo.MapNode
	var notes []string
	domainParent := ""
	if ss, err := sites(conn, cfg); err == nil && len(ss) == 1 {
		nodes = append(nodes, gpo.MapNode{DN: ss[0].DN, Kind: "site", Name: ss[0].Name, Links: ss[0].Links})
		domainParent = ss[0].DN
	} else if err == nil && len(ss) > 1 {
		notes = append(notes, fmt.Sprintf("The forest has %d sites; they are left off the map because the directory does not say which objects are in which.", len(ss)))
	}
	dom, err := somFor(conn, root, "domain")
	if err != nil {
		return nil, nil, err
	}
	nodes = append(nodes, gpo.MapNode{DN: dom.DN, ParentDN: domainParent, Kind: "domain", Name: dom.Name, Links: dom.Links, BlockInheritance: dom.BlockInheritance})
	ous, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: "(objectClass=organizationalUnit)", Attributes: []string{"gPLink", "gPOptions", "ou"}, PageSize: 1000})
	if err != nil {
		return nil, nil, err
	}
	for _, e := range ous.Entries {
		n := gpo.MapNode{DN: e.DN, ParentDN: gpo.ParentOf(e.DN), Kind: "ou", Name: gpo.NameOf(e.DN, "ou")}
		if v := e.Attributes["gPLink"]; len(v) > 0 {
			n.Links = gpo.ParseGPLink(v[0])
		}
		if v := e.Attributes["gPOptions"]; len(v) > 0 && strings.TrimSpace(v[0]) == "1" {
			n.BlockInheritance = true
		}
		nodes = append(nodes, n)
	}
	gpo.SortNodes(nodes)
	gpo.MarkRelevant(nodes)
	for i := range nodes {
		if nodes[i].Links == nil {
			nodes[i].Links = []gpo.Link{}
		}
	}
	return nodes, notes, nil
}

// WhatIf applies one hypothetical change in memory and reports which
// containers would gain or lose policy, for users and for computers, with
// subtree counts on the containers where the impact starts. The directory
// is only read.
func (a *App) WhatIf(change gpo.Change) (*gpo.WhatIf, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	nodes, notes, err := containers(conn, root, cfg)
	if err != nil {
		return nil, err
	}
	set, pnotes := a.policies(conn, root)
	notes = append(notes, pnotes...)
	policyName := change.PolicyDN
	if p, ok := set[strings.ToLower(change.PolicyDN)]; ok {
		policyName = p.Name
	}
	containerName := gpo.NameOf(change.ContainerDN, "ou")
	for _, n := range nodes {
		if strings.EqualFold(n.DN, change.ContainerDN) {
			containerName = n.Name
		}
	}
	w := &gpo.WhatIf{Change: change, Description: change.Describe(policyName, containerName)}
	w.Users = gpo.Evaluate(change, nodes, set, "user")
	w.Computers = gpo.Evaluate(change, nodes, set, "computer")
	// Count the accounts under each impact root, a dozen at most.
	counted := 0
	for _, list := range []*[]gpo.Effect{&w.Users, &w.Computers} {
		for i := range *list {
			e := &(*list)[i]
			if !e.Root || counted >= 12 {
				continue
			}
			if c, err := a.CountUnder(e.ContainerDN); err == nil {
				e.Users, e.Computers = c.Users, c.Computers
				counted++
			}
		}
	}
	if counted >= 12 {
		notes = append(notes, "Counts were fetched for the first twelve containers where the impact starts; the rest are listed without counts.")
	}
	w.Notes = append(notes, "Worked out for containers, so links filtered by group membership count as arriving on both sides. Nothing was changed in the directory.")
	return w, nil
}

// Counts is how many users and computers sit under a container.
type Counts struct {
	DN        string `json:"dn"`
	Users     int    `json:"users"`
	Computers int    `json:"computers"`
	Truncated bool   `json:"truncated"`
}

var countCache = struct {
	mu sync.Mutex
	m  map[string]Counts
	at map[string]time.Time
}{m: map[string]Counts{}, at: map[string]time.Time{}}

// CountUnder counts the users and computers in a container's subtree. DN-only
// pages keep it cheap; the answer is kept for five minutes.
func (a *App) CountUnder(dn string) (*Counts, error) {
	conn, _, _, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	key := strings.ToLower(dn)
	countCache.mu.Lock()
	if c, ok := countCache.m[key]; ok && time.Since(countCache.at[key]) < 5*time.Minute {
		countCache.mu.Unlock()
		return &c, nil
	}
	countCache.mu.Unlock()
	c := Counts{DN: dn}
	for _, q := range []struct {
		filter string
		into   *int
	}{{"(&(objectCategory=person)(objectClass=user))", &c.Users}, {"(objectCategory=computer)", &c.Computers}} {
		res, err := conn.Search(ldap.SearchRequest{BaseDN: dn, Scope: ldap.ScopeSubtree, Filter: q.filter, Attributes: []string{"1.1"}, PageSize: 1000, SizeLimit: 100000})
		if err != nil {
			return nil, err
		}
		*q.into = res.Count
		c.Truncated = c.Truncated || res.Truncated
	}
	countCache.mu.Lock()
	countCache.m[key], countCache.at[key] = c, time.Now()
	countCache.mu.Unlock()
	return &c, nil
}

// PolicyInventory lists every policy in the domain and where it is linked.
func (a *App) PolicyInventory() (*gpo.Inventory, error) {
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		return nil, err
	}
	forgetPolicies()
	set, notes := a.policies(conn, root)
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
	inv := gpo.BuildInventory(set, soms)
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
