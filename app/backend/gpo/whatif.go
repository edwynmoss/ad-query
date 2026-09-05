package gpo

import (
	"fmt"
	"sort"
	"strings"
)

// A Change is one hypothetical edit to Group Policy, applied in memory and
// never to the directory. Several can be stacked.
type Change struct {
	Kind        string `json:"kind"`        // policy-off | unlink | link-off | delete | block | unblock | enforce | unenforce
	PolicyDN    string `json:"policyDN"`    // for policy-off, unlink, link-off, delete, enforce, unenforce
	ContainerDN string `json:"containerDN"` // for unlink, link-off, block, unblock, enforce, unenforce
}

// Describe puts the change into words, given the names.
func (c Change) Describe(policyName, containerName string) string {
	switch c.Kind {
	case "policy-off":
		return fmt.Sprintf("%s switched off", policyName)
	case "delete":
		return fmt.Sprintf("%s deleted", policyName)
	case "unlink":
		return fmt.Sprintf("%s unlinked from %s", policyName, containerName)
	case "link-off":
		return fmt.Sprintf("the link to %s switched off on %s", policyName, containerName)
	case "block":
		return fmt.Sprintf("%s blocks inheritance", containerName)
	case "unblock":
		return fmt.Sprintf("%s stops blocking inheritance", containerName)
	case "enforce":
		return fmt.Sprintf("the link to %s enforced on %s", policyName, containerName)
	case "unenforce":
		return fmt.Sprintf("the link to %s no longer enforced on %s", policyName, containerName)
	}
	return c.Kind
}

// applyLinks returns a container's links after the changes.
func applyLinks(changes []Change, containerDN string, links []Link) []Link {
	out := make([]Link, 0, len(links))
	for _, l := range links {
		keep := true
		for _, c := range changes {
			samePolicy := strings.EqualFold(l.PolicyDN, c.PolicyDN)
			sameContainer := strings.EqualFold(containerDN, c.ContainerDN)
			switch {
			case c.Kind == "delete" && samePolicy:
				keep = false
			case c.Kind == "unlink" && samePolicy && sameContainer:
				keep = false
			case c.Kind == "link-off" && samePolicy && sameContainer:
				l.Disabled = true
			case c.Kind == "enforce" && samePolicy && sameContainer:
				l.Enforced = true
			case c.Kind == "unenforce" && samePolicy && sameContainer:
				l.Enforced = false
			}
		}
		if keep {
			out = append(out, l)
		}
	}
	return out
}

func applyBlock(changes []Change, containerDN string, block bool) bool {
	for _, c := range changes {
		if !strings.EqualFold(containerDN, c.ContainerDN) {
			continue
		}
		if c.Kind == "block" {
			block = true
		}
		if c.Kind == "unblock" {
			block = false
		}
	}
	return block
}

func applyPolicies(changes []Change, policies map[string]Policy) map[string]Policy {
	ps := make(map[string]Policy, len(policies))
	for k, p := range policies {
		for _, c := range changes {
			if c.Kind == "policy-off" && strings.EqualFold(p.DN, c.PolicyDN) {
				p.UserDisabled, p.ComputerDisabled = true, true
			}
		}
		ps[k] = p
	}
	return ps
}

// Apply returns copies of the containers and policies with the changes made.
func Apply(changes []Change, nodes []MapNode, policies map[string]Policy) ([]MapNode, map[string]Policy) {
	out := make([]MapNode, len(nodes))
	for i, n := range nodes {
		n.Links = applyLinks(changes, n.DN, n.Links)
		n.BlockInheritance = applyBlock(changes, n.DN, n.BlockInheritance)
		out[i] = n
	}
	return out, applyPolicies(changes, policies)
}

// ApplyToPath does the same for one object's path of containers.
func ApplyToPath(changes []Change, path []SOM, policies map[string]Policy) ([]SOM, map[string]Policy) {
	out := make([]SOM, len(path))
	for i, s := range path {
		s.Links = applyLinks(changes, s.DN, s.Links)
		s.BlockInheritance = applyBlock(changes, s.DN, s.BlockInheritance)
		out[i] = s
	}
	return out, applyPolicies(changes, policies)
}

// Effect is what changes for one container.
type Effect struct {
	ContainerDN string   `json:"containerDN"`
	Name        string   `json:"name"`
	Kind        string   `json:"kind"`
	Loses       []string `json:"loses"` // policy names that stop arriving
	Gains       []string `json:"gains"` // policy names that start arriving
	Reordered   []string `json:"reordered"`
	Users       int      `json:"users"`     // subtree counts, filled in for impact roots
	Computers   int      `json:"computers"` // -1 when not counted
	Root        bool     `json:"root"`      // no ancestor is affected the same way
}

// WhatIf is the aggregate answer for a set of changes.
type WhatIf struct {
	Changes     []Change `json:"changes"`
	Description string   `json:"description"`
	Users       []Effect `json:"users"`     // per container, user half
	Computers   []Effect `json:"computers"` // per container, computer half
	Notes       []string `json:"notes"`
}

// pathFromNodes rebuilds the site/domain/OU path for a container from the map.
func pathFromNodes(dn string, byDN map[string]MapNode) []SOM {
	var rev []SOM
	cur, ok := byDN[strings.ToLower(dn)]
	for ok {
		rev = append(rev, SOM{DN: cur.DN, Kind: cur.Kind, Name: cur.Name, Links: cur.Links, BlockInheritance: cur.BlockInheritance})
		if cur.ParentDN == "" {
			break
		}
		cur, ok = byDN[strings.ToLower(cur.ParentDN)]
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev
}

func arrivals(c *Chain) []string {
	var out []string
	for _, e := range c.Entries {
		if e.Precedence > 0 {
			out = append(out, e.Policy.Name)
		}
	}
	return out
}

// Evaluate runs the changes against every container for one account kind
// and reports the containers whose arrivals change. Group filtering is not
// known for a container, so "depends" links count as arriving on both sides.
func Evaluate(changes []Change, nodes []MapNode, policies map[string]Policy, kind string) []Effect {
	after, afterPolicies := Apply(changes, nodes, policies)
	before := map[string]MapNode{}
	for _, n := range nodes {
		before[strings.ToLower(n.DN)] = n
	}
	afterBy := map[string]MapNode{}
	for _, n := range after {
		afterBy[strings.ToLower(n.DN)] = n
	}
	var effects []Effect
	for _, n := range nodes {
		if n.Kind == "site" {
			continue
		}
		b := arrivals(Resolve(n.DN, kind, pathFromNodes(n.DN, before), policies, nil))
		a := arrivals(Resolve(n.DN, kind, pathFromNodes(n.DN, afterBy), afterPolicies, nil))
		e := Effect{ContainerDN: n.DN, Name: n.Name, Kind: n.Kind, Users: -1, Computers: -1}
		bset, aset := map[string]bool{}, map[string]bool{}
		for _, p := range b {
			bset[p] = true
		}
		for _, p := range a {
			aset[p] = true
		}
		for _, p := range b {
			if !aset[p] {
				e.Loses = append(e.Loses, p)
			}
		}
		for _, p := range a {
			if !bset[p] {
				e.Gains = append(e.Gains, p)
			}
		}
		if len(e.Loses) == 0 && len(e.Gains) == 0 {
			if strings.Join(a, "|") != strings.Join(b, "|") {
				e.Reordered = a
			} else {
				continue
			}
		}
		effects = append(effects, e)
	}
	byDN := map[string]*Effect{}
	for i := range effects {
		byDN[strings.ToLower(effects[i].ContainerDN)] = &effects[i]
	}
	for i := range effects {
		n := before[strings.ToLower(effects[i].ContainerDN)]
		p, ok := byDN[strings.ToLower(n.ParentDN)]
		effects[i].Root = !ok || strings.Join(p.Loses, "|") != strings.Join(effects[i].Loses, "|") || strings.Join(p.Gains, "|") != strings.Join(effects[i].Gains, "|")
	}
	sort.SliceStable(effects, func(i, j int) bool {
		if effects[i].Root != effects[j].Root {
			return effects[i].Root
		}
		return len(splitDN(effects[i].ContainerDN)) < len(splitDN(effects[j].ContainerDN))
	})
	return effects
}
