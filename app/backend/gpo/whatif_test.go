package gpo

import (
	"strings"
	"testing"
)

func whatIfFixture() ([]MapNode, map[string]Policy) {
	ps := map[string]Policy{}
	for _, p := range []Policy{pol("Corporate Baseline"), pol("People Screensaver"), pol("Finance Lockdown"), pol("Sales Drive Maps")} {
		ps[strings.ToLower(p.DN)] = p
	}
	dn := func(n string) string { return "CN={" + n + "},CN=Policies,CN=System,DC=x" }
	nodes := []MapNode{
		{DN: "DC=x", Kind: "domain", Name: "x", Links: []Link{{PolicyDN: dn("Corporate Baseline"), Enforced: true}}},
		{DN: "OU=People,DC=x", ParentDN: "DC=x", Kind: "ou", Name: "People", Links: []Link{{PolicyDN: dn("People Screensaver")}}},
		{DN: "OU=Sales,OU=People,DC=x", ParentDN: "OU=People,DC=x", Kind: "ou", Name: "Sales", Links: []Link{{PolicyDN: dn("Sales Drive Maps")}}},
		{DN: "OU=Finance,OU=People,DC=x", ParentDN: "OU=People,DC=x", Kind: "ou", Name: "Finance", Links: []Link{{PolicyDN: dn("Finance Lockdown")}}, BlockInheritance: true},
		{DN: "OU=Servers,DC=x", ParentDN: "DC=x", Kind: "ou", Name: "Servers"},
	}
	return nodes, ps
}

func names(effects []Effect) map[string]Effect {
	m := map[string]Effect{}
	for _, e := range effects {
		m[e.Name] = e
	}
	return m
}

func TestWhatIfSwitchOffPolicy(t *testing.T) {
	nodes, ps := whatIfFixture()
	eff := names(Evaluate(Change{Kind: "policy-off", PolicyDN: "CN={People Screensaver},CN=Policies,CN=System,DC=x"}, nodes, ps, "user"))
	if e, ok := eff["People"]; !ok || strings.Join(e.Loses, ",") != "People Screensaver" || !e.Root {
		t.Errorf("People should lose the screensaver as the root of the impact: %+v", eff["People"])
	}
	if e, ok := eff["Sales"]; !ok || strings.Join(e.Loses, ",") != "People Screensaver" || e.Root {
		t.Errorf("Sales inherits the loss and is not a root: %+v", eff["Sales"])
	}
	if _, ok := eff["Finance"]; ok {
		t.Errorf("Finance blocks inheritance and never had the screensaver")
	}
	if _, ok := eff["Servers"]; ok {
		t.Errorf("Servers is untouched")
	}
}

func TestWhatIfUnblock(t *testing.T) {
	nodes, ps := whatIfFixture()
	eff := names(Evaluate(Change{Kind: "unblock", ContainerDN: "OU=Finance,OU=People,DC=x"}, nodes, ps, "user"))
	e, ok := eff["Finance"]
	if !ok || strings.Join(e.Gains, ",") != "People Screensaver" || len(e.Loses) != 0 {
		t.Errorf("Finance should gain the screensaver when it stops blocking: %+v", e)
	}
	if len(eff) != 1 {
		t.Errorf("only Finance changes, got %d effects", len(eff))
	}
}

func TestWhatIfUnenforceReorders(t *testing.T) {
	nodes, ps := whatIfFixture()
	// Without enforcement the baseline drops behind the nearer links and no
	// longer passes Finance's block.
	eff := names(Evaluate(Change{Kind: "unenforce", PolicyDN: "CN={Corporate Baseline},CN=Policies,CN=System,DC=x", ContainerDN: "DC=x"}, nodes, ps, "user"))
	if e, ok := eff["Finance"]; !ok || strings.Join(e.Loses, ",") != "Corporate Baseline" {
		t.Errorf("Finance should lose the baseline once it is not enforced: %+v", eff["Finance"])
	}
	if e, ok := eff["Sales"]; !ok || len(e.Reordered) == 0 {
		t.Errorf("Sales keeps the same policies in a different order: %+v", eff["Sales"])
	}
}

func TestWhatIfUnlinkAndDescribe(t *testing.T) {
	nodes, ps := whatIfFixture()
	c := Change{Kind: "unlink", PolicyDN: "CN={Sales Drive Maps},CN=Policies,CN=System,DC=x", ContainerDN: "OU=Sales,OU=People,DC=x"}
	eff := names(Evaluate(c, nodes, ps, "user"))
	if e, ok := eff["Sales"]; !ok || strings.Join(e.Loses, ",") != "Sales Drive Maps" || len(eff) != 1 {
		t.Errorf("unlink: %+v (%d effects)", e, len(eff))
	}
	if c.Describe("Sales Drive Maps", "Sales") != "Sales Drive Maps unlinked from Sales" {
		t.Errorf("describe: %q", c.Describe("Sales Drive Maps", "Sales"))
	}
	// The computer half of a switched-off policy is affected too.
	eff = names(Evaluate(Change{Kind: "policy-off", PolicyDN: "CN={Corporate Baseline},CN=Policies,CN=System,DC=x"}, nodes, ps, "computer"))
	if len(eff) != 5 {
		t.Errorf("switching off the enforced domain policy touches every container including the domain: %d", len(eff))
	}
}
