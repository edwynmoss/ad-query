package gpo

import (
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
	Users            int    `json:"users"`
	Computers        int    `json:"computers"`
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
