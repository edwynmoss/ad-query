package main

import (
	"strings"
	"testing"

	"app/backend/ldap"
)

// Runs against the seeded Samba AD container (test/samba-ad, seed.ps1 with
// seed-gpo.ps1). Skips when it is not reachable.
func sambaApp(t *testing.T) *App {
	t.Helper()
	a := &App{}
	info, err := a.Connect(ldap.ConnectOptions{Host: "localhost", Port: 1389, Encryption: ldap.EncryptionNone, BindDN: "administrator@adquery.test", Password: "AdminPass123!", Timeout: 10, Auth: "simple"})
	if err != nil {
		t.Skipf("Samba AD not reachable (start test/samba-ad): %v", err)
	}
	if !info.IsActiveDirectory {
		t.Skip("directory is not Active Directory")
	}
	t.Cleanup(func() { _ = a.Disconnect() })
	return a
}

func TestSambaPolicyChainSalesUser(t *testing.T) {
	a := sambaApp(t)
	c, err := a.PolicyChain("CN=jdoe,OU=Sales,OU=People,DC=adquery,DC=test")
	if err != nil {
		t.Fatal(err)
	}
	if c.TargetKind != "user" {
		t.Errorf("kind = %s", c.TargetKind)
	}
	got := map[string]int{}
	verdict := map[string]string{}
	for _, e := range c.Entries {
		got[e.Policy.Name] = e.Precedence
		verdict[e.Policy.Name] = e.Verdict
	}
	if got["Corporate Baseline"] != 1 {
		t.Errorf("Corporate Baseline should win (enforced), chain:\n%s", c.Describe())
	}
	if got["Sales Drive Maps"] == 0 || got["People Screensaver"] == 0 || got["Site Time Sync"] == 0 || got["Default Domain Policy"] == 0 {
		t.Errorf("expected Sales Drive Maps, People Screensaver, Site Time Sync and Default Domain Policy to apply:\n%s", c.Describe())
	}
	if got["Sales Drive Maps"] > got["People Screensaver"] {
		t.Errorf("nearer OU should beat People:\n%s", c.Describe())
	}
	if verdict["VPN Client Settings"] != "denied" {
		t.Errorf("VPN Client Settings should be denied to Sales Team, got %q", verdict["VPN Client Settings"])
	}
	if verdict["Sales Printers"] != "link-disabled" {
		t.Errorf("Sales Printers link should be disabled, got %q", verdict["Sales Printers"])
	}
	if _, ok := verdict["Legacy Proxy"]; ok {
		t.Errorf("an unlinked policy must not appear in a chain")
	}
	joined := strings.Join(c.Notes, " ")
	if !strings.Contains(joined, "WMI") {
		t.Errorf("notes should say what the directory cannot know: %v", c.Notes)
	}
}

func TestSambaPolicyChainFinanceBlocksInheritance(t *testing.T) {
	a := sambaApp(t)
	c, err := a.PolicyChain("CN=dscott,OU=Finance,OU=People,DC=adquery,DC=test")
	if err != nil {
		t.Fatal(err)
	}
	var applying []string
	verdict := map[string]string{}
	for _, e := range c.Entries {
		verdict[e.Policy.Name] = e.Verdict
		if e.Precedence > 0 {
			applying = append(applying, e.Policy.Name)
		}
	}
	if strings.Join(applying, "|") != "Corporate Baseline|Finance Lockdown" {
		t.Errorf("finance chain = %v\n%s", applying, c.Describe())
	}
	if verdict["People Screensaver"] != "blocked" || verdict["Default Domain Policy"] != "blocked" {
		t.Errorf("non-enforced links above Finance should be blocked: %v", verdict)
	}
}

func TestSambaPolicyChainITFiltering(t *testing.T) {
	a := sambaApp(t)
	member, err := a.PolicyChain("CN=ckent,OU=IT,OU=People,DC=adquery,DC=test")
	if err != nil {
		t.Fatal(err)
	}
	find := func(c interface{ Describe() string }, name string) string {
		for _, line := range strings.Split(c.Describe(), "\n") {
			if strings.Contains(line, name) {
				return line
			}
		}
		return ""
	}
	if line := find(member, "IT Admin Tools"); !strings.HasPrefix(strings.TrimSpace(line), "1") && !strings.Contains(line, "IT Admin Tools (IT)") || strings.Contains(line, "filtered") {
		t.Errorf("IT Team member should get IT Admin Tools: %q\n%s", line, member.Describe())
	}
	if len(member.Names) == 0 {
		t.Errorf("names for filtering trustees should be resolved")
	}
}

func TestSambaPolicyInventory(t *testing.T) {
	a := sambaApp(t)
	inv, err := a.PolicyInventory()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]int{}
	for _, p := range inv.Policies {
		byName[p.Policy.Name] = len(p.Links)
	}
	if byName["Legacy Proxy"] != 0 {
		t.Errorf("Legacy Proxy should have no links")
	}
	if byName["Corporate Baseline"] != 1 || byName["Site Time Sync"] != 1 || byName["Sales Printers"] != 1 {
		t.Errorf("link counts wrong: %v", byName)
	}
	if len(inv.Policies) < 13 {
		t.Errorf("expected the two defaults plus eleven seeded policies, got %d", len(inv.Policies))
	}
}
