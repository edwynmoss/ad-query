package ldap

import (
	"fmt"
	"sort"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

// SchemaAttributeNames discovers every attribute type the directory defines, so
// the UI can offer "select almost any attribute" rather than a hardcoded list.
//
// It reads the RootDSE's subschemaSubentry pointer, then reads attributeTypes
// from that entry and extracts the NAME(s) from each RFC 4512 definition.
func (c *Conn) SchemaAttributeNames() ([]string, error) {
	if c == nil || c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}

	subschemaDN, err := c.subschemaSubentry()
	if err != nil {
		return nil, err
	}

	req := goldap.NewSearchRequest(
		subschemaDN,
		goldap.ScopeBaseObject,
		goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=subschema)",
		[]string{"attributeTypes"},
		nil,
	)
	res, err := c.conn.Search(req)
	if err != nil {
		return nil, fmt.Errorf("read schema at %q: %w", subschemaDN, err)
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("subschema entry %q returned nothing", subschemaDN)
	}

	defs := res.Entries[0].GetAttributeValues("attributeTypes")
	return parseSchemaNames(defs), nil
}

// subschemaSubentry resolves the DN of the schema entry from the RootDSE.
func (c *Conn) subschemaSubentry() (string, error) {
	req := goldap.NewSearchRequest(
		"",
		goldap.ScopeBaseObject,
		goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=*)",
		[]string{"subschemaSubentry"},
		nil,
	)
	res, err := c.conn.Search(req)
	if err != nil {
		return "", fmt.Errorf("read subschemaSubentry: %w", err)
	}
	if len(res.Entries) == 0 {
		return "", fmt.Errorf("RootDSE returned no entry")
	}
	dn := res.Entries[0].GetAttributeValue("subschemaSubentry")
	if dn == "" {
		// Fall back to the conventional names.
		return "cn=Subschema", nil
	}
	return dn, nil
}

// parseSchemaNames extracts attribute names from RFC 4512 attributeTypes
// definitions. Each definition looks like:
//
//	( 2.5.4.3 NAME 'cn' SUP name ... )
//	( 0.9.x NAME ( 'givenName' 'gn' ) ... )
//
// Returns a de-duplicated, case-insensitively sorted list.
func parseSchemaNames(defs []string) []string {
	seen := make(map[string]string) // lower -> original casing
	for _, def := range defs {
		for _, n := range namesInDefinition(def) {
			key := strings.ToLower(n)
			if _, ok := seen[key]; !ok {
				seen[key] = n
			}
		}
	}
	out := make([]string, 0, len(seen))
	for _, v := range seen {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]) < strings.ToLower(out[j])
	})
	return out
}

// namesInDefinition returns the name(s) declared by the NAME token of one
// attributeTypes definition.
func namesInDefinition(def string) []string {
	idx := strings.Index(def, "NAME")
	if idx < 0 {
		return nil
	}
	rest := strings.TrimSpace(def[idx+len("NAME"):])
	if rest == "" {
		return nil
	}
	if rest[0] == '(' {
		// Parenthesized list of quoted names.
		end := strings.IndexByte(rest, ')')
		if end < 0 {
			return nil
		}
		return quotedTokens(rest[1:end])
	}
	// Single quoted name.
	return quotedTokens(rest)
}

// quotedTokens pulls the contents of every single-quoted run in s.
func quotedTokens(s string) []string {
	var names []string
	for {
		start := strings.IndexByte(s, '\'')
		if start < 0 {
			break
		}
		end := strings.IndexByte(s[start+1:], '\'')
		if end < 0 {
			break
		}
		name := s[start+1 : start+1+end]
		if name != "" {
			names = append(names, name)
		}
		s = s[start+1+end+1:]
	}
	return names
}
