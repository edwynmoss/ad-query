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
	// SDFlags, when set, attaches the SD-flags control so nTSecurityDescriptor
	// comes back with just those parts (SDDACL alone avoids needing the SACL
	// privilege). Only meaningful when nTSecurityDescriptor is requested.
	SDFlags int `json:"sdFlags"`
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
	Entries   []Entry `json:"entries"`
	Count     int     `json:"count"`
	Truncated bool    `json:"truncated"` // SizeLimit was hit
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
	if req.SDFlags > 0 && req.SDFlags <= 0xff {
		search.Controls = append(search.Controls, goldap.NewControlString(sdFlagsControlOID, true, string([]byte{0x30, 0x03, 0x02, 0x01, byte(req.SDFlags)})))
	}
	if req.SizeLimit > 0 && uint32(req.SizeLimit) < pageSize {
		pageSize = uint32(req.SizeLimit)
	}

	res, truncated, err := c.searchPaged(search, pageSize, req.SizeLimit)
	if err != nil {
		return nil, fmt.Errorf("search %q: %w", filter, err)
	}
	return buildResult(res, truncated), nil
}

// searchPaged walks the pages itself rather than using SearchWithPaging,
// which reads every page whatever the size limit says. On a directory with
// tens of thousands of accounts that difference is the whole cost of a
// lookup: a picker asking for forty matches would otherwise drag back every
// one of the twelve hundred people whose name starts the same way.
//
// Stopping early leaves the server holding a paged search, so the cookie is
// handed back with a page size of zero, which is how the protocol says to
// abandon one.
func (c *Conn) searchPaged(search *goldap.SearchRequest, pageSize uint32, limit int) (*goldap.SearchResult, bool, error) {
	paging := goldap.NewControlPaging(pageSize)
	search.Controls = append(search.Controls, paging)
	out := &goldap.SearchResult{}
	truncated := false

	for {
		page, err := c.conn.Search(search)
		if page != nil {
			out.Entries = append(out.Entries, page.Entries...)
			out.Referrals = append(out.Referrals, page.Referrals...)
			out.Controls = append(out.Controls, page.Controls...)
		}
		if err != nil {
			// The server enforcing its own limit is an answer, not a failure:
			// what it sent before stopping is still worth showing.
			if e, ok := err.(*goldap.Error); ok && e.ResultCode == goldap.LDAPResultSizeLimitExceeded {
				truncated = true
				break
			}
			return out, truncated, err
		}
		if limit > 0 && len(out.Entries) >= limit {
			// More may be waiting; say so only if the server still has a page.
			if ctrl := goldap.FindControl(page.Controls, goldap.ControlTypePaging); ctrl != nil && len(ctrl.(*goldap.ControlPaging).Cookie) > 0 {
				truncated = true
				paging.SetCookie(ctrl.(*goldap.ControlPaging).Cookie)
				paging.PagingSize = 0
				_, _ = c.conn.Search(search)
			}
			break
		}
		ctrl := goldap.FindControl(page.Controls, goldap.ControlTypePaging)
		if ctrl == nil {
			break
		}
		cookie := ctrl.(*goldap.ControlPaging).Cookie
		if len(cookie) == 0 {
			break
		}
		paging.SetCookie(cookie)
	}

	if limit > 0 && len(out.Entries) > limit {
		out.Entries = out.Entries[:limit]
	}
	return out, truncated, nil
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
