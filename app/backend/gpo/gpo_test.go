package gpo

import (
	"strings"
	"testing"
)

func TestParseGPLink(t *testing.T) {
	s := "[LDAP://CN={A},CN=Policies,CN=System,DC=x;1][LDAP://CN={B},CN=Policies,CN=System,DC=x;2][LDAP://cn={C},CN=Policies,CN=System,DC=x;0]"
	links := ParseGPLink(s)
	if len(links) != 3 {
		t.Fatalf("want 3 links, got %d", len(links))
	}
	if links[0].PolicyDN != "CN={A},CN=Policies,CN=System,DC=x" || !links[0].Disabled || links[0].Enforced {
		t.Errorf("link 0 wrong: %+v", links[0])
	}
	if !links[1].Enforced || links[1].Disabled {
		t.Errorf("link 1 wrong: %+v", links[1])
	}
	if links[2].Enforced || links[2].Disabled {
		t.Errorf("link 2 wrong: %+v", links[2])
	}
	if got := ParseGPLink(""); len(got) != 0 {
		t.Errorf("empty gPLink should give no links, got %v", got)
	}
}

func TestPathFromDN(t *testing.T) {
	got := PathFromDN("CN=jdoe,OU=Sales,OU=People,DC=adquery,DC=test", "DC=adquery,DC=test")
	want := []string{"DC=adquery,DC=test", "OU=People,DC=adquery,DC=test", "OU=Sales,OU=People,DC=adquery,DC=test"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("path = %v, want %v", got, want)
	}
	// CN containers carry no links and are skipped.
	got = PathFromDN("CN=Administrator,CN=Users,DC=adquery,DC=test", "DC=adquery,DC=test")
	if len(got) != 1 || got[0] != "DC=adquery,DC=test" {
		t.Errorf("Users container path = %v", got)
	}
	// Escaped commas stay inside their part.
	got = PathFromDN("CN=Doe\\, Jane,OU=A,DC=x", "DC=x")
	if len(got) != 2 || got[1] != "OU=A,DC=x" {
		t.Errorf("escaped path = %v", got)
	}
}

func pol(name string, opts ...func(*Policy)) Policy {
	p := Policy{DN: "CN={" + name + "},CN=Policies,CN=System,DC=x", GUID: "{" + name + "}", Name: name, ACLKnown: true, ApplyAllow: []string{sidAuthenticatedUsers}}
	for _, o := range opts {
		o(&p)
	}
	return p
}

func TestResolveScenario(t *testing.T) {
	// Mirrors test/samba-ad/seed-gpo.ps1.
	sales := "S-1-5-21-1-1-1-1204"
	it := "S-1-5-21-1-1-1-1205"
	ps := map[string]Policy{}
	add := func(p Policy) { ps[strings.ToLower(p.DN)] = p }
	add(pol("Corporate Baseline"))
	add(pol("VPN Client Settings", func(p *Policy) { p.ApplyDeny = []string{sales} }))
	add(pol("Site Time Sync"))
	add(pol("People Screensaver", func(p *Policy) { p.ComputerDisabled = true }))
	add(pol("Sales Drive Maps"))
	add(pol("Sales Printers"))
	add(pol("IT Admin Tools", func(p *Policy) { p.ApplyAllow = []string{it} }))
	add(pol("Finance Lockdown"))
	add(pol("Workstation Hardening", func(p *Policy) { p.WMIFilter = "[x;{1};0]" }))
	add(pol("Server Config", func(p *Policy) { p.UserDisabled = true }))
	link := func(name string, opt int) Link {
		return Link{PolicyDN: ps[strings.ToLower("CN={"+name+"},CN=Policies,CN=System,DC=x")].DN, Enforced: opt&2 != 0 && opt&1 == 0, Disabled: opt&1 != 0}
	}
	site := SOM{DN: "CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=x", Kind: "site", Name: "Default-First-Site-Name", Links: []Link{link("Site Time Sync", 0)}}
	domain := SOM{DN: "DC=x", Kind: "domain", Name: "x", Links: []Link{link("VPN Client Settings", 0), link("Corporate Baseline", 2)}}
	people := SOM{DN: "OU=People,DC=x", Kind: "ou", Name: "People", Links: []Link{link("People Screensaver", 0)}}
	salesOU := SOM{DN: "OU=Sales,OU=People,DC=x", Kind: "ou", Name: "Sales", Links: []Link{link("Sales Printers", 1), link("Sales Drive Maps", 0)}}
	itOU := SOM{DN: "OU=IT,OU=People,DC=x", Kind: "ou", Name: "IT", Links: []Link{link("IT Admin Tools", 0)}}
	finance := SOM{DN: "OU=Finance,OU=People,DC=x", Kind: "ou", Name: "Finance", Links: []Link{link("Finance Lockdown", 0)}, BlockInheritance: true}
	workstations := SOM{DN: "OU=Workstations,DC=x", Kind: "ou", Name: "Workstations", Links: []Link{link("Workstation Hardening", 0)}}

	verdicts := func(c *Chain) map[string]string {
		m := map[string]string{}
		for _, e := range c.Entries {
			m[e.Policy.Name] = e.Verdict
		}
		return m
	}
	order := func(c *Chain) []string {
		var out []string
		for _, e := range c.Entries {
			if e.Precedence > 0 {
				out = append(out, e.Policy.Name)
			}
		}
		return out
	}

	// A Sales user.
	c := Resolve("CN=jdoe,OU=Sales,OU=People,DC=x", "user", []SOM{site, domain, people, salesOU}, ps, Token("S-1-5-21-1-1-1-1104", []string{sales}))
	v := verdicts(c)
	if v["VPN Client Settings"] != "denied" || v["Sales Printers"] != "link-disabled" {
		t.Errorf("sales verdicts: %v", v)
	}
	// Enforced domain link wins, then nearest container first, then first-listed within Sales.
	want := "Corporate Baseline|Sales Drive Maps|People Screensaver|Site Time Sync"
	if got := strings.Join(order(c), "|"); got != want {
		t.Errorf("sales order = %s, want %s\n%s", got, want, c.Describe())
	}

	// A Finance user: the OU blocks inheritance, so only the enforced link
	// comes through from above.
	c = Resolve("CN=dscott,OU=Finance,OU=People,DC=x", "user", []SOM{site, domain, people, finance}, ps, Token("S-1-5-21-1-1-1-1110", nil))
	v = verdicts(c)
	if v["People Screensaver"] != "blocked" || v["VPN Client Settings"] != "blocked" || v["Site Time Sync"] != "blocked" {
		t.Errorf("finance verdicts: %v", v)
	}
	want = "Corporate Baseline|Finance Lockdown"
	if got := strings.Join(order(c), "|"); got != want {
		t.Errorf("finance order = %s, want %s\n%s", got, want, c.Describe())
	}

	// An IT user is in IT Team; an engineer is not.
	c = Resolve("CN=ckent,OU=IT,OU=People,DC=x", "user", []SOM{site, domain, people, itOU}, ps, Token("S-1-5-21-1-1-1-1105", []string{it}))
	if verdicts(c)["IT Admin Tools"] != "applies" {
		t.Errorf("IT member should get IT Admin Tools: %v", verdicts(c))
	}
	c = Resolve("CN=lsong,OU=IT,OU=People,DC=x", "user", []SOM{site, domain, people, itOU}, ps, Token("S-1-5-21-1-1-1-1120", nil))
	if verdicts(c)["IT Admin Tools"] != "filtered" {
		t.Errorf("non-member should be filtered: %v", verdicts(c))
	}

	// A computer under People sees the screensaver policy as half disabled;
	// a workstation carries the WMI caveat.
	c = Resolve("CN=PC1,OU=People,DC=x", "computer", []SOM{site, domain, people}, ps, Token("S-1-5-21-1-1-1-2000", nil))
	if verdicts(c)["People Screensaver"] != "half-disabled" {
		t.Errorf("computer half-disabled: %v", verdicts(c))
	}
	c = Resolve("CN=WS1,OU=Workstations,DC=x", "computer", []SOM{site, domain, workstations}, ps, Token("S-1-5-21-1-1-1-2001", nil))
	var ws *Entry
	for i := range c.Entries {
		if c.Entries[i].Policy.Name == "Workstation Hardening" {
			ws = &c.Entries[i]
		}
	}
	if ws == nil || ws.Verdict != "applies" || !ws.WMIUnknown {
		t.Errorf("workstation WMI entry: %+v", ws)
	}

	// A link to a policy that no longer exists is reported, not dropped.
	ghost := SOM{DN: "OU=Ghost,DC=x", Kind: "ou", Name: "Ghost", Links: []Link{{PolicyDN: "CN={DEAD},CN=Policies,CN=System,DC=x"}}}
	c = Resolve("CN=u,OU=Ghost,DC=x", "user", []SOM{domain, ghost}, ps, Token("", nil))
	if verdicts(c)["{DEAD}"] != "not-found" {
		t.Errorf("missing policy: %v", verdicts(c))
	}
}

func TestResolveGenericToken(t *testing.T) {
	it := "S-1-5-21-1-1-1-1205"
	ps := map[string]Policy{}
	for _, p := range []Policy{pol("Everyone Gets"), pol("IT Only", func(p *Policy) { p.ApplyAllow = []string{it} }), pol("Not Sales", func(p *Policy) { p.ApplyDeny = []string{"S-1-5-21-1-1-1-1204"} }), pol("Nobody", func(p *Policy) { p.ApplyAllow = nil })} {
		ps[strings.ToLower(p.DN)] = p
	}
	var links []Link
	for _, n := range []string{"Everyone Gets", "IT Only", "Not Sales", "Nobody"} {
		links = append(links, Link{PolicyDN: "CN={" + n + "},CN=Policies,CN=System,DC=x"})
	}
	c := Resolve("OU=IT,DC=x", "user", []SOM{{DN: "OU=IT,DC=x", Kind: "ou", Name: "IT", Links: links}}, ps, nil)
	got := map[string]Entry{}
	for _, e := range c.Entries {
		got[e.Policy.Name] = e
	}
	if got["Everyone Gets"].Verdict != "applies" || got["Everyone Gets"].Precedence != 1 {
		t.Errorf("everyone: %+v", got["Everyone Gets"])
	}
	if got["IT Only"].Verdict != "depends" || got["IT Only"].Precedence != 2 || !strings.Contains(got["IT Only"].Reason, it) {
		t.Errorf("it only: %+v", got["IT Only"])
	}
	if got["Not Sales"].Verdict != "depends" || got["Not Sales"].Precedence != 3 {
		t.Errorf("not sales: %+v", got["Not Sales"])
	}
	if got["Nobody"].Verdict != "filtered" || got["Nobody"].Precedence != 0 {
		t.Errorf("nobody: %+v", got["Nobody"])
	}
}

func TestMapHelpers(t *testing.T) {
	nodes := map[string]bool{"dc=x": true, "ou=people,dc=x": true, "ou=sales,ou=people,dc=x": true}
	if NearestContainer("CN=jdoe,OU=Sales,OU=People,DC=x", nodes) != "OU=Sales,OU=People,DC=x" {
		t.Error("nearest for a user in Sales")
	}
	if NearestContainer("CN=Administrator,CN=Users,DC=x", nodes) != "DC=x" {
		t.Error("CN=Users should land on the domain")
	}
	if ParentOf("DC=x") != "" {
		t.Error("root has no parent")
	}
	ns := []MapNode{{DN: "OU=Sales,OU=People,DC=x", Kind: "ou", Name: "Sales"}, {DN: "DC=x", Kind: "domain", Name: "x"}, {DN: "CN=S,CN=Sites,CN=Configuration,DC=x", Kind: "site", Name: "S"}, {DN: "OU=People,DC=x", Kind: "ou", Name: "People"}}
	SortNodes(ns)
	if ns[0].Kind != "site" || ns[1].Kind != "domain" || ns[2].Name != "People" || ns[3].Name != "Sales" {
		t.Errorf("order: %v %v %v %v", ns[0].Name, ns[1].Name, ns[2].Name, ns[3].Name)
	}
}

func TestBuildInventory(t *testing.T) {
	ps := map[string]Policy{}
	a, b, orphan := pol("A"), pol("B"), pol("Orphan")
	for _, p := range []Policy{a, b, orphan} {
		ps[strings.ToLower(p.DN)] = p
	}
	soms := []SOM{
		{DN: "DC=x", Kind: "domain", Name: "x", Links: []Link{{PolicyDN: a.DN, Enforced: true}, {PolicyDN: b.DN}}},
		{DN: "OU=S,DC=x", Kind: "ou", Name: "S", Links: []Link{{PolicyDN: a.DN, Disabled: true}, {PolicyDN: "CN={GONE},CN=Policies,CN=System,DC=x"}}},
	}
	inv := BuildInventory(ps, soms)
	if len(inv.Policies) != 4 {
		t.Fatalf("want 4 policies (3 + 1 missing), got %d", len(inv.Policies))
	}
	// Linked policies first, alphabetical; the orphan last.
	if inv.Policies[len(inv.Policies)-1].Policy.Name != "Orphan" {
		t.Errorf("orphan should sort last: %v", inv.Policies[len(inv.Policies)-1].Policy.Name)
	}
	for _, p := range inv.Policies {
		if p.Policy.Name == "A" {
			if len(p.Links) != 2 || !p.Links[0].Enforced || !p.Links[1].Disabled || p.Links[0].Order != 1 {
				t.Errorf("A links: %+v", p.Links)
			}
		}
	}
}

func TestNameOf(t *testing.T) {
	if NameOf("DC=adquery,DC=test", "domain") != "adquery.test" {
		t.Error("domain name")
	}
	if NameOf("OU=Sales,OU=People,DC=x", "ou") != "Sales" {
		t.Error("ou name")
	}
	if NameOf("CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=x", "site") != "Default-First-Site-Name" {
		t.Error("site name")
	}
}
