package ldap

import "testing"

func TestSearchRequestValidate(t *testing.T) {
	cases := []struct {
		name    string
		req     SearchRequest
		wantErr bool
	}{
		{"valid", SearchRequest{BaseDN: "dc=x", Scope: ScopeSubtree, Filter: "(objectClass=user)"}, false},
		{"empty filter defaults ok", SearchRequest{BaseDN: "dc=x", Scope: ScopeBase, Filter: ""}, false},
		{"bad scope", SearchRequest{Scope: 99, Filter: "(cn=*)"}, true},
		{"negative size limit", SearchRequest{Scope: ScopeBase, SizeLimit: -1, Filter: "(cn=*)"}, true},
		{"malformed filter", SearchRequest{Scope: ScopeBase, Filter: "(objectClass=user"}, true},
		{"malformed filter 2", SearchRequest{Scope: ScopeBase, Filter: "not a filter"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.req.Validate()
			if (err != nil) != c.wantErr {
				t.Errorf("Validate() error = %v, wantErr = %v", err, c.wantErr)
			}
		})
	}
}
