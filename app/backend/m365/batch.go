package m365

// Microsoft Graph JSON batching. Resolving many identities one HTTP request each
// doesn't scale (a stale/reclaim report over a large directory = tens of
// thousands of sequential calls). LookupUsers batches up to 20 lookups per
// request via the $batch endpoint, then a second batched pass for license
// details, with Retry-After backoff on throttling (429).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const batchSize = 20 // Graph $batch hard limit

type batchRequest struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	URL    string `json:"url"`
}

type batchResponse struct {
	ID     string          `json:"id"`
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// LookupUsers resolves many identities (UPN/email) against Graph using JSON
// batching instead of one round-trip each. Results are returned in arbitrary
// order, each keyed back to the identity it was looked up by (User.Identity).
func LookupUsers(doer Doer, token string, identities []string) []User {
	users := make([]User, len(identities))
	objID := make(map[int]string) // user index -> Graph object id, for the license pass
	for i, id := range identities {
		users[i] = User{Identity: id}
	}

	// Pass 1 — resolve the users.
	forEachBatch(len(identities), func(start, end int) {
		reqs := make([]batchRequest, 0, end-start)
		for i := start; i < end; i++ {
			reqs = append(reqs, batchRequest{
				ID: strconv.Itoa(i), Method: "GET",
				URL: "/users/" + url.PathEscape(identities[i]) + "?$select=id,accountEnabled,displayName,userPrincipalName,mail,signInActivity",
			})
		}
		resps, err := postBatch(doer, token, reqs)
		if err != nil {
			for i := start; i < end; i++ {
				users[i].Error = err.Error()
			}
			return
		}
		for _, r := range resps {
			i, e := strconv.Atoi(r.ID)
			if e != nil || i < 0 || i >= len(users) {
				continue
			}
			switch {
			case r.Status == http.StatusNotFound:
				users[i].Exists = false
			case r.Status >= 200 && r.Status < 300:
				id := parseGraphUser(r.Body, &users[i])
				users[i].Exists = true
				if id != "" {
					objID[i] = id
				}
			default:
				users[i].Error = "graph: " + graphErr(r.Body, r.Status)
			}
		}
	})

	// Pass 2 — license details for the resolved users (best-effort).
	idxs := make([]int, 0, len(objID))
	for i := range objID {
		idxs = append(idxs, i)
	}
	forEachBatch(len(idxs), func(start, end int) {
		reqs := make([]batchRequest, 0, end-start)
		for _, i := range idxs[start:end] {
			reqs = append(reqs, batchRequest{
				ID: strconv.Itoa(i), Method: "GET",
				URL: "/users/" + url.PathEscape(objID[i]) + "/licenseDetails?$select=skuPartNumber",
			})
		}
		resps, err := postBatch(doer, token, reqs)
		if err != nil {
			return
		}
		for _, r := range resps {
			i, e := strconv.Atoi(r.ID)
			if e != nil || i < 0 || i >= len(users) {
				continue
			}
			if r.Status >= 200 && r.Status < 300 {
				users[i].Licenses = parseLicenses(r.Body)
			}
		}
	})
	return users
}

// forEachBatch invokes fn over [start,end) windows of size batchSize.
func forEachBatch(n int, fn func(start, end int)) {
	for start := 0; start < n; start += batchSize {
		end := start + batchSize
		if end > n {
			end = n
		}
		fn(start, end)
	}
}

// postBatch POSTs a Graph $batch and returns the sub-responses, retrying the
// whole batch on a top-level 429 (throttling), honouring Retry-After.
func postBatch(doer Doer, token string, reqs []batchRequest) ([]batchResponse, error) {
	payload, err := json.Marshal(map[string]any{"requests": reqs})
	if err != nil {
		return nil, err
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequest(http.MethodPost, graphBase+"/$batch", bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := doer.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests && attempt < 4 {
			sleepRetryAfter(resp.Header.Get("Retry-After"))
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("graph $batch: %s", graphErr(body, resp.StatusCode))
		}
		var out struct {
			Responses []batchResponse `json:"responses"`
		}
		if err := json.Unmarshal(body, &out); err != nil {
			return nil, err
		}
		return out.Responses, nil
	}
}

// sleepRetryAfter waits per a Retry-After header (seconds), clamped to a sane
// range. Defaults to a short pause when the header is missing/unparseable.
func sleepRetryAfter(h string) {
	secs := 2
	if n, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && n >= 0 && n <= 120 {
		secs = n
	}
	time.Sleep(time.Duration(secs) * time.Second)
}
