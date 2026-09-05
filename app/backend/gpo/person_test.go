package gpo

import (
	"strings"
	"testing"
)

// Group membership and a move are hypotheticals about the account, not the
// directory's links, so they change the token and the path, and say nothing
// about other containers.
func TestPersonChanges(t *testing.T) {
	sales := "S-1-5-21-1-1-1-1204"
	token := Token("S-1-5-21-1-1-1-1104", []string{sales})

	left := ApplyToToken([]Change{{Kind: "leave", GroupSID: sales}}, token)
	if left[sales] {
		t.Error("leaving a group should drop it from the token")
	}
	if !left["S-1-5-11"] || !left[strings.ToUpper("S-1-5-21-1-1-1-1104")] {
		t.Error("leaving one group must not disturb the account's own identities")
	}
	if !token[sales] {
		t.Error("the original token must not be modified in place")
	}

	it := "S-1-5-21-1-1-1-1205"
	joined := ApplyToToken([]Change{{Kind: "join", GroupSID: it}}, token)
	if !joined[it] || !joined[sales] {
		t.Errorf("joining adds to the existing membership: %v", joined)
	}
	// Case does not matter; SIDs come back from the directory in either form.
	if !ApplyToToken([]Change{{Kind: "join", GroupSID: strings.ToLower(it)}}, token)[it] {
		t.Error("SIDs should be matched case-insensitively")
	}

	if MoveTo([]Change{{Kind: "leave", GroupSID: sales}}) != "" {
		t.Error("no move, no destination")
	}
	if got := MoveTo([]Change{{Kind: "move", ContainerDN: "OU=IT,OU=People,DC=x"}, {Kind: "move", ContainerDN: "OU=HR,OU=People,DC=x"}}); got != "OU=HR,OU=People,DC=x" {
		t.Errorf("the last move wins: %q", got)
	}
}

// A person-only change tells us nothing about other containers, so the
// container evaluation stays silent rather than reporting a false impact.
func TestPersonChangesHaveNoContainerImpact(t *testing.T) {
	nodes, ps := whatIfFixture()
	if eff := Evaluate([]Change{{Kind: "leave", GroupSID: "S-1-5-21-1-1-1-1204"}}, nodes, ps, "user"); len(eff) != 0 {
		t.Errorf("leaving a group changes no container: %+v", eff)
	}
	// Mixed with a directory change, only the directory part counts.
	eff := names(Evaluate([]Change{
		{Kind: "leave", GroupSID: "S-1-5-21-1-1-1-1204"},
		{Kind: "unblock", ContainerDN: "OU=Finance,OU=People,DC=x"},
	}, nodes, ps, "user"))
	if len(eff) != 1 || strings.Join(eff["Finance"].Gains, ",") != "People Screensaver" {
		t.Errorf("the unblock should still be reported: %+v", eff)
	}
}

func TestChangeLabelIsEchoed(t *testing.T) {
	c := Change{Kind: "leave", GroupSID: "S-1-5-21-1", Label: "Terry Wong left Sales Team"}
	if c.Describe("", "") != "Terry Wong left Sales Team" {
		t.Errorf("a person change describes itself with its label: %q", c.Describe("", ""))
	}
	if !c.PersonOnly() {
		t.Error("leave is about the person")
	}
	if (Change{Kind: "unlink"}).PersonOnly() {
		t.Error("unlink is about the directory")
	}
}
