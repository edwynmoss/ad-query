package ldap

import (
	"fmt"

	goldap "github.com/go-ldap/ldap/v3"
)

// Scope mirrors the LDAP search scope.
type Scope int

const (
	ScopeBase     Scope = iota // the base object only
	ScopeOneLevel              // immediate children
	ScopeSubtree               // the base object and all descendants
)

func (s Scope) goldap() int {
	switch s {
	case ScopeBase:
		return goldap.ScopeBaseObject
	case ScopeOneLevel:
		return goldap.ScopeSingleLevel
	default:
		return goldap.ScopeWholeSubtree
	}
}

// SearchRequest is a simplified, JSON-friendly search description.
type SearchRequest struct {
	BaseDN     string   `json:"baseDN"`
	Scope      Scope    `json:"scope"`
	Filter     string   `json:"filter"`     // raw LDAP filter, e.g. (objectClass=*)
	Attributes []string `json:"attributes"` // empty => all user attributes
	PageSize   uint32   `json:"pageSize"`   // 0 => 1000
	SizeLimit  int      `json:"sizeLimit"`  // 0 => server default; total cap across pages
}

// Entry is one directory object. Values are kept as raw strings (caller decodes
// FILETIME/UAC/SID via the adtypes package as needed). RawValues retains the
// binary form for attributes like objectSid / nTSecurityDescriptor.
type Entry struct {
	DN         string              `json:"dn"`
	Attributes map[string][]string `json:"attributes"`
	RawValues  map[string][][]byte `json:"-"`
}

// SearchResult is the outcome of a (possibly paged) search.
type SearchResult struct {
	Entries  []Entry `json:"entries"`
	Count    int     `json:"count"`
	Truncated bool   `json:"truncated"` // SizeLimit was hit
}

// Validate checks a request before it is sent: the filter must be well-formed,
// the scope known, and limits non-negative. Catching this here yields a clear
// message instead of an opaque protocol error from the server.
func (req SearchRequest) Validate() error {
	if req.Scope < ScopeBase || req.Scope > ScopeSubtree {
		return fmt.Errorf("invalid scope %d", req.Scope)
	}
	if req.SizeLimit < 0 {
		return fmt.Errorf("size limit must not be negative")
	}
	filter := req.Filter
	if filter == "" {
		filter = "(objectClass=*)"
	}
	if _, err := goldap.CompileFilter(filter); err != nil {
		return fmt.Errorf("invalid LDAP filter %q: %w", filter, err)
	}
	return nil
}

// Search runs a paged search and collects all entries (up to SizeLimit, if set).
func (c *Conn) Search(req SearchRequest) (*SearchResult, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	if c == nil || c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	filter := req.Filter
	if filter == "" {
		filter = "(objectClass=*)"
	}
	pageSize := req.PageSize
	if pageSize == 0 {
		pageSize = 1000
	}

	search := goldap.NewSearchRequest(
		req.BaseDN,
		req.Scope.goldap(),
		goldap.NeverDerefAliases,
		req.SizeLimit, // 0 => no client-imposed limit
		0,             // time limit (server default)
		false,         // typesOnly
		filter,
		req.Attributes,
		nil,
	)

	res, err := c.conn.SearchWithPaging(search, pageSize)
	if err != nil {
		// A size-limit-exceeded result still carries the entries gathered so far.
		if ldapErr, ok := err.(*goldap.Error); ok && ldapErr.ResultCode == goldap.LDAPResultSizeLimitExceeded && res != nil {
			return buildResult(res, true), nil
		}
		return nil, fmt.Errorf("search %q: %w", filter, err)
	}
	return buildResult(res, false), nil
}

func buildResult(res *goldap.SearchResult, truncated bool) *SearchResult {
	out := &SearchResult{Entries: make([]Entry, 0, len(res.Entries)), Truncated: truncated}
	for _, e := range res.Entries {
		entry := Entry{
			DN:         e.DN,
			Attributes: make(map[string][]string, len(e.Attributes)),
			RawValues:  make(map[string][][]byte, len(e.Attributes)),
		}
		for _, a := range e.Attributes {
			entry.Attributes[a.Name] = a.Values
			entry.RawValues[a.Name] = a.ByteValues
		}
		out.Entries = append(out.Entries, entry)
	}
	out.Count = len(out.Entries)
	return out
}
