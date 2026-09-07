package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"app/backend/gpo"
	"app/backend/ldap"
)

// A stopwatch on the Group Policy work, run against whatever the Samba test
// container currently holds. It calls the same methods the window calls, so
// what it reports is what a person would wait for, minus the drawing.
//
// Seed the container first (test/samba-ad/seed-enterprise.ps1 for the size of
// a real estate), then:
//
//	ADQ_BENCH=1 go test -run TestPolicyPerformance -v -timeout 30m ./...
//
// It skips unless ADQ_BENCH is set, because it is slow and needs a directory.

type timing struct {
	name  string
	cold  time.Duration
	warm  time.Duration
	note  string
	bytes int
}

func benchApp(t *testing.T) *App {
	t.Helper()
	if os.Getenv("ADQ_BENCH") == "" {
		t.Skip("set ADQ_BENCH=1 to run the performance measurements")
	}
	a := &App{}
	_, err := a.Connect(ldap.ConnectOptions{Host: "localhost", Port: 1389, Encryption: ldap.EncryptionNone, BindDN: "administrator@adquery.test", Password: "AdminPass123!", Timeout: 120, Auth: "simple"})
	if err != nil {
		t.Fatalf("Samba AD not reachable (start test/samba-ad): %v", err)
	}
	t.Cleanup(func() { _ = a.Disconnect() })
	return a
}

// sizeOf reports how much JSON crosses to the window, which is the other half
// of what a person waits for.
func sizeOf(v any) int {
	b, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	return len(b)
}

func human(n int) string {
	switch {
	case n > 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n > 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

// measure runs f once with every cache cleared, then once more warm.
func measure(t *testing.T, name string, f func() (string, int)) timing {
	t.Helper()
	forgetPolicies()
	countCache.mu.Lock()
	countCache.m = map[string]Counts{}
	countCache.at = map[string]time.Time{}
	countCache.mu.Unlock()

	start := time.Now()
	note, size := f()
	cold := time.Since(start)
	start = time.Now()
	f()
	warm := time.Since(start)
	t.Logf("%-34s cold %8s   warm %8s   %-10s %s", name, cold.Round(time.Millisecond), warm.Round(time.Millisecond), human(size), note)
	return timing{name: name, cold: cold, warm: warm, note: note, bytes: size}
}

func TestPolicyPerformance(t *testing.T) {
	a := benchApp(t)
	conn, root, cfg, err := a.policyRoots()
	if err != nil {
		t.Fatal(err)
	}

	// What is actually in there, so the numbers mean something.
	count := func(base, filter string) int {
		res, err := conn.Search(ldap.SearchRequest{BaseDN: base, Scope: ldap.ScopeSubtree, Filter: filter, Attributes: []string{"1.1"}, PageSize: 1000, SizeLimit: 200000})
		if err != nil {
			t.Logf("counting %s: %v", filter, err)
			return -1
		}
		return res.Count
	}
	users := count(root, "(&(objectCategory=person)(objectClass=user))")
	computers := count(root, "(objectCategory=computer)")
	ous := count(root, "(objectClass=organizationalUnit)")
	groups := count(root, "(objectClass=group)")
	gpos := count("CN=Policies,CN=System,"+root, "(objectClass=groupPolicyContainer)")
	t.Logf("directory: %d users, %d computers, %d OUs, %d groups, %d policies", users, computers, ous, groups, gpos)

	// Pick real targets out of the tree rather than hard-coding names.
	pick := func(filter string) string {
		res, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: filter, Attributes: []string{"1.1"}, PageSize: 1, SizeLimit: 1})
		if err != nil || len(res.Entries) == 0 {
			return ""
		}
		return res.Entries[0].DN
	}
	// The deepest OU there is: the worst case for a chain.
	deepestOU := ""
	if res, err := conn.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, Filter: "(objectClass=organizationalUnit)", Attributes: []string{"1.1"}, PageSize: 1000}); err == nil {
		for _, e := range res.Entries {
			if strings.Count(e.DN, ",") > strings.Count(deepestOU, ",") {
				deepestOU = e.DN
			}
		}
	}
	someUser := pick("(&(objectCategory=person)(objectClass=user)(sAMAccountName=e1*))")
	if someUser == "" {
		someUser = pick("(&(objectCategory=person)(objectClass=user))")
	}
	someComputer := pick("(objectCategory=computer)")
	t.Logf("user:      %s", someUser)
	t.Logf("computer:  %s", someComputer)
	t.Logf("deepest:   %s", deepestOU)
	t.Log(strings.Repeat("-", 100))

	var rows []timing
	add := func(x timing) { rows = append(rows, x) }

	add(measure(t, "PolicyMap (the tree)", func() (string, int) {
		m, err := a.PolicyMap()
		if err != nil {
			return "ERROR " + err.Error(), 0
		}
		relevant := 0
		for _, n := range m.Nodes {
			if n.Relevant {
				relevant++
			}
		}
		return fmt.Sprintf("%d containers (%d carry policy), %d policies, %d names", len(m.Nodes), relevant, len(m.Policies), len(m.Names)), sizeOf(m)
	}))

	add(measure(t, "PolicyInventory (all policies)", func() (string, int) {
		inv, err := a.PolicyInventory()
		if err != nil {
			return "ERROR " + err.Error(), 0
		}
		links := 0
		for _, p := range inv.Policies {
			links += len(p.Links)
		}
		return fmt.Sprintf("%d policies, %d links", len(inv.Policies), links), sizeOf(inv)
	}))

	if someUser != "" {
		add(measure(t, "PolicyChain (one person)", func() (string, int) {
			c, err := a.PolicyChain(someUser)
			if err != nil {
				return "ERROR " + err.Error(), 0
			}
			applying := 0
			for _, e := range c.Entries {
				if e.Precedence > 0 {
					applying++
				}
			}
			return fmt.Sprintf("%d links considered, %d apply, %d groups", len(c.Entries), applying, len(c.TokenSIDs)), sizeOf(c)
		}))
	}

	if someComputer != "" {
		add(measure(t, "PolicyChain (one computer)", func() (string, int) {
			c, err := a.PolicyChain(someComputer)
			if err != nil {
				return "ERROR " + err.Error(), 0
			}
			return fmt.Sprintf("%d links considered", len(c.Entries)), sizeOf(c)
		}))
	}

	if deepestOU != "" {
		add(measure(t, "ContainerChain (deepest OU)", func() (string, int) {
			c, err := a.ContainerChain(deepestOU, "user")
			if err != nil {
				return "ERROR " + err.Error(), 0
			}
			return fmt.Sprintf("%d links considered", len(c.Entries)), sizeOf(c)
		}))
	}

	add(measure(t, "CountUnder (whole domain)", func() (string, int) {
		c, err := a.CountUnder(root)
		if err != nil {
			return "ERROR " + err.Error(), 0
		}
		return fmt.Sprintf("%d users, %d computers", c.Users, c.Computers), sizeOf(c)
	}))

	if deepestOU != "" {
		add(measure(t, "CountUnder (one OU)", func() (string, int) {
			c, err := a.CountUnder(deepestOU)
			if err != nil {
				return "ERROR " + err.Error(), 0
			}
			return fmt.Sprintf("%d users, %d computers", c.Users, c.Computers), sizeOf(c)
		}))
	}

	// A hypothetical on the busiest policy: the one linked in most places.
	busiest, busiestName, mostLinks := "", "", 0
	if inv, err := a.PolicyInventory(); err == nil {
		for _, p := range inv.Policies {
			if len(p.Links) > mostLinks {
				busiest, busiestName, mostLinks = p.Policy.DN, p.Policy.Name, len(p.Links)
			}
		}
	}
	if busiest != "" {
		add(measure(t, "WhatIf (switch a policy off)", func() (string, int) {
			w, err := a.WhatIf([]gpo.Change{{Kind: "policy-off", PolicyDN: busiest, Label: busiestName}})
			if err != nil {
				return "ERROR " + err.Error(), 0
			}
			return fmt.Sprintf("%q, %d links: %d user effects, %d computer effects", busiestName, mostLinks, len(w.Users), len(w.Computers)), sizeOf(w)
		}))
	}

	// The picker in the register, asked the way the register asks it: three
	// bounded lookups rather than one combined filter, so a container is not
	// crowded out of the answer by twenty thousand people.
	picker := func(term string) func() (string, int) {
		return func() (string, int) {
			total, bytes := 0, 0
			for _, q := range []struct {
				filter string
				attrs  []string
				limit  int
			}{
				{"(&(objectCategory=person)(objectClass=user)(anr=" + term + "))", []string{"displayName", "sAMAccountName", "name"}, 20},
				{"(&(objectCategory=computer)(anr=" + term + "))", []string{"name", "dNSHostName"}, 12},
				{"(&(objectClass=organizationalUnit)(ou=*" + term + "*))", []string{"ou", "name"}, 8},
			} {
				res, err := a.Search(ldap.SearchRequest{BaseDN: root, Scope: ldap.ScopeSubtree, PageSize: uint32(q.limit), SizeLimit: q.limit, Filter: q.filter, Attributes: q.attrs})
				if err != nil {
					return "ERROR " + err.Error(), 0
				}
				total += res.Count
				bytes += sizeOf(res)
			}
			return fmt.Sprintf("%d hits", total), bytes
		}
	}
	add(measure(t, "picker: a person's name", picker("Ana")))
	add(measure(t, "picker: an account name", picker("e01234")))
	add(measure(t, "picker: a container name", picker("Sales")))

	// The pieces PolicyMap is built from, so a slow map can be blamed on one.
	add(measure(t, "  part: read every policy + DACL", func() (string, int) {
		set, _ := loadPolicies(conn, root)
		return fmt.Sprintf("%d policies", len(set)), 0
	}))
	add(measure(t, "  part: read every container", func() (string, int) {
		nodes, _, err := containers(conn, root, cfg)
		if err != nil {
			return "ERROR " + err.Error(), 0
		}
		return fmt.Sprintf("%d containers", len(nodes)), 0
	}))
	add(measure(t, "  part: resolve filtering names", func() (string, int) {
		set, _ := loadPolicies(conn, root)
		sids := map[string]bool{}
		for _, p := range set {
			for _, s := range append(p.ApplyAllow, p.ApplyDeny...) {
				sids[s] = true
			}
		}
		names := sidNames(conn, root, sids)
		return fmt.Sprintf("%d SIDs to %d names", len(sids), len(names)), 0
	}))

	t.Log(strings.Repeat("-", 100))
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].cold > rows[j].cold })
	t.Log("slowest first, cold:")
	for _, r := range rows {
		t.Logf("  %8s  %s", r.cold.Round(time.Millisecond), r.name)
	}
}
