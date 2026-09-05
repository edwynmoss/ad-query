// Package gpo works out which Group Policy Objects reach a user or computer,
// as far as the directory alone can tell. It reads gPLink and gPOptions on
// the containers above the object (site, domain, OUs), the policy objects
// under CN=Policies, and each policy's access-control list, and lays the
// result out in precedence order with a verdict per link.
//
// This is deliberately not a Resultant Set of Policy: WMI filters are not
// evaluated, loopback and slow-link processing are client-side, and the
// settings inside a policy live in SYSVOL, not LDAP. Every place the answer
// is incomplete says so in the chain's notes or an entry's reason.
package gpo

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"app/backend/adtypes"
)

// ApplyGroupPolicy is the extended right a trustee needs on a policy for it
// to apply to them (security filtering).
const ApplyGroupPolicy = "edacfd8f-ffb3-11d1-b41d-00a0c968f939"

const (
	linkDisabled = 0x1
	linkEnforced = 0x2

	flagUserDisabled     = 0x1
	flagComputerDisabled = 0x2

	rightControlAccess = 0x00000100
	rightGenericAll    = 0x10000000

	sidEveryone           = "S-1-1-0"
	sidAuthenticatedUsers = "S-1-5-11"
)

// Link is one entry of a gPLink attribute, in the order it appears there.
type Link struct {
	PolicyDN string `json:"policyDN"`
	Enforced bool   `json:"enforced"`
	Disabled bool   `json:"disabled"`
}

// SOM is a scope of management: a site, the domain, or an organizational
// unit, with the links it carries.
type SOM struct {
	DN               string `json:"dn"`
	Kind             string `json:"kind"` // site | domain | ou
	Name             string `json:"name"`
	Links            []Link `json:"links"`
	BlockInheritance bool   `json:"blockInheritance"`
}

// Policy is a groupPolicyContainer plus the parts of its ACL that matter.
type Policy struct {
	DN               string   `json:"dn"`
	GUID             string   `json:"guid"`
	Name             string   `json:"name"`
	Version          int      `json:"version"`
	Path             string   `json:"path"`
	UserDisabled     bool     `json:"userDisabled"`
	ComputerDisabled bool     `json:"computerDisabled"`
	WMIFilter        string   `json:"wmiFilter"`
	WMIFilterName    string   `json:"wmiFilterName"`
	Changed          string   `json:"changed"`    // RFC3339 of whenChanged, empty when unknown
	ApplyAllow       []string `json:"applyAllow"` // SIDs granted Apply Group Policy
	ApplyDeny        []string `json:"applyDeny"`  // SIDs denied it
	ACLKnown         bool     `json:"aclKnown"`   // false when the descriptor could not be read
}

// Entry is one link in the chain for a target, with its verdict.
type Entry struct {
	Precedence int    `json:"precedence"` // 1 wins; 0 when the policy does not apply
	Policy     Policy `json:"policy"`
	SOMDN      string `json:"somDN"`
	SOMKind    string `json:"somKind"`
	SOMName    string `json:"somName"`
	Enforced   bool   `json:"enforced"`
	Verdict    string `json:"verdict"` // applies | link-disabled | blocked | denied | filtered | half-disabled | not-found
	Reason     string `json:"reason"`
	WMIUnknown bool   `json:"wmiUnknown"`
}

// Chain is the full answer for one target.
type Chain struct {
	TargetDN   string            `json:"targetDN"`
	TargetKind string            `json:"targetKind"` // user | computer
	Path       []SOM             `json:"path"`       // site (if known), domain, OUs from the top down
	Entries    []Entry           `json:"entries"`    // applying entries first in precedence order, then the rest
	Notes      []string          `json:"notes"`
	Names      map[string]string `json:"names"`     // SID to account name, for the trustees in security filtering
	TokenSIDs  []string          `json:"tokenSIDs"` // the groups this account presents to filtering, for "what if they left"
}

var linkRe = regexp.MustCompile(`\[([^;\]]+);(\d+)\]`)

// ParseGPLink splits a gPLink value into links, in attribute order. The
// LDAP:// prefix is dropped so the DN can be matched against policy DNs.
func ParseGPLink(s string) []Link {
	var out []Link
	for _, m := range linkRe.FindAllStringSubmatch(s, -1) {
		dn := strings.TrimSpace(m[1])
		if i := strings.Index(strings.ToLower(dn), "ldap://"); i == 0 {
			dn = dn[len("ldap://"):]
		}
		opts, _ := strconv.Atoi(m[2])
		out = append(out, Link{PolicyDN: dn, Enforced: opts&linkEnforced != 0 && opts&linkDisabled == 0, Disabled: opts&linkDisabled != 0})
	}
	return out
}

// ParseFlags reads the policy's flags attribute.
func ParseFlags(s string) (userDisabled, computerDisabled bool) {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n&flagUserDisabled != 0, n&flagComputerDisabled != 0
}

// ApplyRights pulls the Apply Group Policy allow and deny trustees out of a
// parsed security descriptor. A control-access or generic-all mask on a
// plain (non-object) ACE covers every extended right, so it counts too.
func ApplyRights(sd *adtypes.SecurityDescriptor) (allow, deny []string) {
	if sd == nil {
		return nil, nil
	}
	for _, ace := range sd.DACL {
		if ace.Mask&(rightControlAccess|rightGenericAll) == 0 {
			continue
		}
		if ace.ObjectType != "" && !strings.EqualFold(ace.ObjectType, ApplyGroupPolicy) {
			continue
		}
		if ace.Allow {
			allow = append(allow, strings.ToUpper(ace.SID))
		} else {
			deny = append(deny, strings.ToUpper(ace.SID))
		}
	}
	return allow, deny
}

// Token is what the target presents to security filtering: its own SID and
// every group it belongs to, plus the identities every account carries.
func Token(ownSID string, groupSIDs []string) map[string]bool {
	t := map[string]bool{sidEveryone: true, sidAuthenticatedUsers: true}
	if ownSID != "" {
		t[strings.ToUpper(ownSID)] = true
	}
	for _, s := range groupSIDs {
		if s != "" {
			t[strings.ToUpper(s)] = true
		}
	}
	return t
}

// Resolve orders the chain. path is site (optional), domain, then OUs from
// the top down. A nil token means "anything in this container" rather than
// one account: links whose security filtering depends on group membership
// are kept in the order with the verdict "depends". Precedence follows MS-GPOL as Samba implements it: a nearer
// container beats a farther one, within a container the first-listed link
// wins, enforced links beat everything non-enforced and, among enforced
// links, the farther container wins. Blocked inheritance drops non-enforced
// links from containers above the block.
func Resolve(targetDN, targetKind string, path []SOM, policies map[string]Policy, token map[string]bool) *Chain {
	c := &Chain{TargetDN: targetDN, TargetKind: targetKind, Path: path}
	var normal, forced, rest []Entry
	for _, som := range path {
		var here []Entry
		for _, l := range som.Links {
			e := Entry{SOMDN: som.DN, SOMKind: som.Kind, SOMName: som.Name, Enforced: l.Enforced}
			p, ok := policies[strings.ToLower(l.PolicyDN)]
			if !ok {
				e.Policy = Policy{DN: l.PolicyDN, Name: shortGUID(l.PolicyDN)}
				e.Verdict, e.Reason = "not-found", "The link points at a policy object that no longer exists."
				rest = append(rest, e)
				continue
			}
			e.Policy = p
			switch {
			case l.Disabled:
				e.Verdict, e.Reason = "link-disabled", "The link is disabled on "+som.Name+"."
			case token == nil && p.ACLKnown && (len(p.ApplyDeny) > 0 || !allowedGeneric(p)):
				if !allowedGeneric(p) && len(p.ApplyAllow) == 0 {
					e.Verdict, e.Reason = "filtered", "Security filtering: nobody holds Apply Group Policy on this policy."
				} else {
					e.Verdict, e.Reason = "depends", dependsReason(p)
				}
			case token != nil && denied(p, token) != "":
				e.Verdict, e.Reason = "denied", "Apply Group Policy is denied to "+adtypes.FriendlySID(denied(p, token))+"."
			case token != nil && p.ACLKnown && !allowed(p, token):
				e.Verdict, e.Reason = "filtered", "Security filtering: none of the target's groups hold Apply Group Policy."
			case targetKind == "user" && p.UserDisabled:
				e.Verdict, e.Reason = "half-disabled", "The policy's user settings are disabled."
			case targetKind == "computer" && p.ComputerDisabled:
				e.Verdict, e.Reason = "half-disabled", "The policy's computer settings are disabled."
			default:
				e.Verdict = "applies"
				if p.WMIFilter != "" {
					e.WMIUnknown = true
					e.Reason = "Has a WMI filter, which only the client can evaluate."
				}
				if !p.ACLKnown {
					e.Reason = strings.TrimSpace(e.Reason + " Security filtering could not be read.")
				}
			}
			if e.Verdict != "applies" && e.Verdict != "depends" {
				rest = append(rest, e)
				continue
			}
			here = append(here, e)
		}
		// Within one container the first-listed link wins, so it goes nearest
		// the front. Nearer containers are prepended later, so they win.
		for i := len(here) - 1; i >= 0; i-- {
			if here[i].Enforced {
				forced = append([]Entry{here[i]}, forced...)
			} else {
				normal = append([]Entry{here[i]}, normal...)
			}
		}
		if som.BlockInheritance {
			// Everything already collected from above this container that is
			// not enforced is dropped.
			var kept []Entry
			for _, e := range normal {
				if e.SOMDN == som.DN {
					kept = append(kept, e)
				} else {
					e.Verdict, e.Reason = "blocked", som.Name+" blocks inheritance, and this link is not enforced."
					e.Precedence = 0
					rest = append(rest, e)
				}
			}
			normal = kept
		}
	}
	// Enforced links win; the farthest container's enforced link wins most.
	// forced was built with the nearest first, so reverse it.
	for i, j := 0, len(forced)-1; i < j; i, j = i+1, j-1 {
		forced[i], forced[j] = forced[j], forced[i]
	}
	applying := append(forced, normal...)
	for i := range applying {
		applying[i].Precedence = i + 1
	}
	// The rest keep a stable, readable order: by container depth then name.
	sort.SliceStable(rest, func(i, j int) bool { return rest[i].Policy.Name < rest[j].Policy.Name })
	c.Entries = append(append([]Entry{}, applying...), rest...)
	if c.Path == nil {
		c.Path = []SOM{}
	}
	return c
}

// allowedGeneric says whether every authenticated account holds the right.
func allowedGeneric(p Policy) bool {
	for _, s := range p.ApplyAllow {
		if s == sidEveryone || s == sidAuthenticatedUsers {
			return true
		}
	}
	return false
}

// dependsReason spells out the membership a container-level trace cannot
// settle. SIDs are left raw; the frontend names them.
func dependsReason(p Policy) string {
	var parts []string
	if !allowedGeneric(p) {
		parts = append(parts, "applies only to "+strings.Join(p.ApplyAllow, ", "))
	}
	if len(p.ApplyDeny) > 0 {
		parts = append(parts, "denied to "+strings.Join(p.ApplyDeny, ", "))
	}
	return "Depends on group membership: " + strings.Join(parts, "; ") + "."
}

func denied(p Policy, token map[string]bool) string {
	for _, s := range p.ApplyDeny {
		if token[s] {
			return s
		}
	}
	return ""
}

func allowed(p Policy, token map[string]bool) bool {
	for _, s := range p.ApplyAllow {
		if token[s] {
			return true
		}
	}
	return false
}

func shortGUID(dn string) string {
	first := strings.SplitN(dn, ",", 2)[0]
	return strings.TrimPrefix(strings.TrimPrefix(first, "CN="), "cn=")
}

// PathFromDN lists the container DNs above an object that can carry policy:
// the domain root and every OU, from the top down. Containers (CN=Users)
// cannot carry links and are skipped.
func PathFromDN(objectDN, domainDN string) []string {
	parts := splitDN(objectDN)
	var out []string
	for i := 1; i < len(parts); i++ {
		dn := strings.Join(parts[i:], ",")
		if strings.HasPrefix(strings.ToLower(parts[i]), "ou=") {
			out = append(out, dn)
		}
	}
	// top-down
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return append([]string{domainDN}, out...)
}

// splitDN splits on unescaped commas.
func splitDN(dn string) []string {
	var parts []string
	var cur strings.Builder
	esc := false
	for _, r := range dn {
		switch {
		case esc:
			cur.WriteRune(r)
			esc = false
		case r == '\\':
			cur.WriteRune(r)
			esc = true
		case r == ',':
			parts = append(parts, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		parts = append(parts, strings.TrimSpace(cur.String()))
	}
	return parts
}

// NameOf gives a container a readable name: the OU or site name, or the
// domain in dotted form.
func NameOf(dn, kind string) string {
	first := splitDN(dn)
	if len(first) == 0 {
		return dn
	}
	if kind == "domain" {
		var labels []string
		for _, p := range first {
			if strings.HasPrefix(strings.ToLower(p), "dc=") {
				labels = append(labels, p[3:])
			}
		}
		return strings.ToLower(strings.Join(labels, "."))
	}
	if i := strings.Index(first[0], "="); i >= 0 {
		return first[0][i+1:]
	}
	return first[0]
}

// Inventory is every policy with where it is linked, for the register.
type Inventory struct {
	Policies []PolicyLinks     `json:"policies"`
	Notes    []string          `json:"notes"`
	Names    map[string]string `json:"names"`
}

// PolicyLinks is one policy and its links across the directory.
type PolicyLinks struct {
	Policy Policy      `json:"policy"`
	Links  []LinkPlace `json:"links"`
}

// LinkPlace is one place a policy is linked.
type LinkPlace struct {
	SOMDN    string `json:"somDN"`
	SOMKind  string `json:"somKind"`
	SOMName  string `json:"somName"`
	Enforced bool   `json:"enforced"`
	Disabled bool   `json:"disabled"`
	Order    int    `json:"order"` // 1 = first listed on that container
}

// BuildInventory joins policies to every container that links them.
func BuildInventory(policies map[string]Policy, soms []SOM) *Inventory {
	byDN := map[string]*PolicyLinks{}
	var order []string
	for k, p := range policies {
		byDN[k] = &PolicyLinks{Policy: p, Links: []LinkPlace{}}
		order = append(order, k)
	}
	for _, som := range soms {
		for i, l := range som.Links {
			k := strings.ToLower(l.PolicyDN)
			pl, ok := byDN[k]
			if !ok {
				pl = &PolicyLinks{Policy: Policy{DN: l.PolicyDN, Name: shortGUID(l.PolicyDN) + " (missing)"}, Links: []LinkPlace{}}
				byDN[k] = pl
				order = append(order, k)
			}
			pl.Links = append(pl.Links, LinkPlace{SOMDN: som.DN, SOMKind: som.Kind, SOMName: som.Name, Enforced: l.Enforced, Disabled: l.Disabled, Order: i + 1})
		}
	}
	inv := &Inventory{}
	for _, k := range order {
		inv.Policies = append(inv.Policies, *byDN[k])
	}
	sort.SliceStable(inv.Policies, func(i, j int) bool {
		li, lj := len(inv.Policies[i].Links), len(inv.Policies[j].Links)
		if (li == 0) != (lj == 0) {
			return li > 0
		}
		return strings.ToLower(inv.Policies[i].Policy.Name) < strings.ToLower(inv.Policies[j].Policy.Name)
	})
	return inv
}

// Describe is a one-line summary for logs and tests.
func (c *Chain) Describe() string {
	var b strings.Builder
	for _, e := range c.Entries {
		if e.Precedence > 0 {
			fmt.Fprintf(&b, "%d. %s (%s)\n", e.Precedence, e.Policy.Name, e.SOMName)
		} else {
			fmt.Fprintf(&b, "-  %s (%s): %s\n", e.Policy.Name, e.SOMName, e.Verdict)
		}
	}
	return b.String()
}
