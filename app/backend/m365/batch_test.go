package m365

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestLookupUsersBatches(t *testing.T) {
	calls := 0
	doer := stubDoer{fn: func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/$batch") {
			t.Fatalf("expected POST /$batch, got %s %s", r.Method, r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), "licenseDetails") {
			return resp(200, `{"responses":[
				{"id":"0","status":200,"body":{"value":[{"skuPartNumber":"ENTERPRISEPACK"}]}}
			]}`), nil
		}
		return resp(200, `{"responses":[
			{"id":"0","status":200,"body":{"id":"oid0","accountEnabled":true,"displayName":"Jane","userPrincipalName":"jane@x","signInActivity":{"lastSignInDateTime":"2026-01-01T00:00:00Z"}}},
			{"id":"1","status":200,"body":{"id":"oid1","accountEnabled":false,"userPrincipalName":"bob@x"}},
			{"id":"2","status":404,"body":{"error":{"code":"Request_ResourceNotFound"}}}
		]}`), nil
	}}

	users := LookupUsers(doer, "tok", []string{"jane@x", "bob@x", "ghost@x"})

	// 3 users + 1 with a licence = two batched POSTs total, not one-per-user.
	if calls != 2 {
		t.Fatalf("expected 2 batched requests, got %d", calls)
	}
	m := map[string]User{}
	for _, u := range users {
		m[u.Identity] = u
	}
	if jane := m["jane@x"]; !jane.Exists || !jane.Enabled || jane.LastSignIn == "" || len(jane.Licenses) == 0 {
		t.Fatalf("jane wrong: %+v", jane)
	}
	if bob := m["bob@x"]; !bob.Exists || bob.Enabled {
		t.Errorf("bob should exist and be disabled: %+v", m["bob@x"])
	}
	if ghost := m["ghost@x"]; ghost.Exists {
		t.Errorf("ghost should not exist: %+v", ghost)
	}
}

func TestPostBatchRetriesOn429(t *testing.T) {
	calls := 0
	doer := stubDoer{fn: func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			rr := resp(http.StatusTooManyRequests, `{"error":{"code":"TooManyRequests"}}`)
			rr.Header.Set("Retry-After", "0") // don't actually sleep in the test
			return rr, nil
		}
		return resp(200, `{"responses":[{"id":"0","status":200,"body":{"id":"x","userPrincipalName":"a@x"}}]}`), nil
	}}
	users := LookupUsers(doer, "tok", []string{"a@x"})
	if calls < 2 {
		t.Fatalf("expected a retry after 429, calls=%d", calls)
	}
	if !users[0].Exists {
		t.Fatalf("user should resolve after retry: %+v", users[0])
	}
}
