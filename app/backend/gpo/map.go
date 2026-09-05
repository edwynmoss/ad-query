package gpo

import (
	"net"
	"sort"
	"strings"
)

// MapNode is one container in the policy map: the site (when the forest has
// one), the domain, or an organizational unit, with what it links and how
// many accounts sit directly in it.
type MapNode struct {
	DN               string `json:"dn"`
	ParentDN         string `json:"parentDN"`
	Kind             string `json:"kind"` // site | domain | ou
	Name             string `json:"name"`
	Links            []Link `json:"links"`
	BlockInheritance bool   `json:"blockInheritance"`
	// Relevant marks a container that links or blocks policy, or has a
	// descendant that does; the map opens showing only these.
	Relevant bool `json:"relevant"`
}

// Map is the whole tree, ready to draw.
type Map struct {
	Nodes    []MapNode         `json:"nodes"`
	Policies map[string]Policy `json:"policies"` // keyed by lower-case DN
	Names    map[string]string `json:"names"`
	Notes    []string          `json:"notes"`
}

// ParentOf returns the DN one level up.
func ParentOf(dn string) string {
	parts := splitDN(dn)
	if len(parts) < 2 {
		return ""
	}
	return strings.Join(parts[1:], ",")
}

// NearestContainer walks up from an object's DN to the closest DN that is
// one of the map's nodes (an OU or the domain). Accounts under CN=Users or
// CN=Computers land on the domain.
func NearestContainer(objectDN string, nodes map[string]bool) string {
	dn := ParentOf(objectDN)
	for dn != "" {
		if nodes[strings.ToLower(dn)] {
			return dn
		}
		dn = ParentOf(dn)
	}
	return ""
}

// MarkRelevant sets Relevant on every container that links a policy or
// blocks inheritance, and on every ancestor of one, so the map can open
// on the containers that matter and fold the rest.
func MarkRelevant(nodes []MapNode) {
	idx := map[string]int{}
	for i, n := range nodes {
		idx[strings.ToLower(n.DN)] = i
	}
	for i := range nodes {
		if len(nodes[i].Links) > 0 || nodes[i].BlockInheritance || nodes[i].Kind != "ou" {
			for j := i; j >= 0; {
				nodes[j].Relevant = true
				p, ok := idx[strings.ToLower(nodes[j].ParentDN)]
				if !ok {
					break
				}
				j = p
			}
		}
	}
}

// Subnet is one entry under CN=Subnets in the configuration partition.
type Subnet struct {
	Prefix *net.IPNet
	SiteDN string
}

// ParseSubnet turns "10.1.0.0/16" (the subnet object's name) into a prefix.
func ParseSubnet(name, siteDN string) (Subnet, bool) {
	_, n, err := net.ParseCIDR(strings.TrimSpace(name))
	if err != nil || n == nil {
		return Subnet{}, false
	}
	return Subnet{Prefix: n, SiteDN: siteDN}, true
}

// SiteForIP picks the site whose subnet matches the address most tightly,
// which is how a domain member chooses its own site.
func SiteForIP(ip net.IP, subnets []Subnet) string {
	best, bestBits := "", -1
	for _, s := range subnets {
		if s.Prefix == nil || !s.Prefix.Contains(ip) {
			continue
		}
		ones, _ := s.Prefix.Mask.Size()
		if ones > bestBits {
			best, bestBits = s.SiteDN, ones
		}
	}
	return best
}

// SortNodes orders parents before children and siblings by name, so the
// frontend can build the tree in one pass.
func SortNodes(nodes []MapNode) {
	depth := func(dn string) int { return len(splitDN(dn)) }
	sort.SliceStable(nodes, func(i, j int) bool {
		di, dj := depth(nodes[i].DN), depth(nodes[j].DN)
		if nodes[i].Kind == "site" {
			di = -1
		}
		if nodes[j].Kind == "site" {
			dj = -1
		}
		if di != dj {
			return di < dj
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
}
