package m365

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

const graphBase = "https://graph.microsoft.com/v1.0"

// User is the Microsoft 365 / Entra view of one identity, keyed back to the
// identity string that was looked up (so it can be joined to AD rows).
type User struct {
	Identity    string   `json:"identity"` // what we searched for (UPN/mail)
	Exists      bool     `json:"exists"`
	Enabled     bool     `json:"enabled"`
	DisplayName string   `json:"displayName"`
	UPN         string   `json:"upn"`
	Licenses    []string `json:"licenses"`
	LastSignIn  string   `json:"lastSignIn"`
	Error       string   `json:"error"` // per-identity note (e.g. permission denied)
}

// LookupUser resolves one identity (UPN or email) against Graph and, if found,
// fetches its license details. Network errors surface on User.Error rather than
// failing the whole batch.
func LookupUser(doer Doer, token string, identity string) User {
	u := User{Identity: identity}
	body, status, err := graphGet(doer, token, "/users/"+url.PathEscape(identity)+
		"?$select=id,accountEnabled,displayName,userPrincipalName,mail,signInActivity")
	if err != nil {
		u.Error = err.Error()
		return u
	}
	if status == http.StatusNotFound {
		u.Exists = false
		return u
	}
	if status != http.StatusOK {
		u.Error = "graph: " + graphErr(body, status)
		return u
	}

	id := parseGraphUser(body, &u)
	u.Exists = true

	// Licenses (best-effort, a permission gap here shouldn't fail the row).
	if id != "" {
		lbody, lstatus, lerr := graphGet(doer, token, "/users/"+url.PathEscape(id)+"/licenseDetails?$select=skuPartNumber")
		if lerr == nil && lstatus == http.StatusOK {
			u.Licenses = parseLicenses(lbody)
		}
	}
	return u
}

// parseGraphUser fills the user fields and returns the object id.
func parseGraphUser(body []byte, u *User) string {
	var r struct {
		ID             string `json:"id"`
		AccountEnabled bool   `json:"accountEnabled"`
		DisplayName    string `json:"displayName"`
		UPN            string `json:"userPrincipalName"`
		SignInActivity *struct {
			LastSignInDateTime string `json:"lastSignInDateTime"`
		} `json:"signInActivity"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		u.Error = "parse user: " + err.Error()
		return ""
	}
	u.Enabled = r.AccountEnabled
	u.DisplayName = r.DisplayName
	u.UPN = r.UPN
	if r.SignInActivity != nil {
		u.LastSignIn = r.SignInActivity.LastSignInDateTime
	}
	return r.ID
}

// LicenseSku is one tenant subscription line: how many seats are purchased,
// assigned, and free.
type LicenseSku struct {
	Product       string `json:"product"`
	SkuPartNumber string `json:"skuPartNumber"`
	Purchased     int    `json:"purchased"`
	Assigned      int    `json:"assigned"`
	Available     int    `json:"available"`
}

// LicenseReport returns the tenant's per-SKU seat counts (Graph subscribedSkus).
func LicenseReport(doer Doer, token string) ([]LicenseSku, error) {
	body, status, err := graphGet(doer, token, "/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits")
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("license report: %s", graphErr(body, status))
	}
	return parseSubscribedSkus(body), nil
}

func parseSubscribedSkus(body []byte) []LicenseSku {
	var r struct {
		Value []struct {
			SkuPartNumber string `json:"skuPartNumber"`
			PrepaidUnits  struct {
				Enabled int `json:"enabled"`
			} `json:"prepaidUnits"`
			ConsumedUnits int `json:"consumedUnits"`
		} `json:"value"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil
	}
	out := make([]LicenseSku, 0, len(r.Value))
	for _, v := range r.Value {
		out = append(out, LicenseSku{
			Product:       FriendlySku(v.SkuPartNumber),
			SkuPartNumber: v.SkuPartNumber,
			Purchased:     v.PrepaidUnits.Enabled,
			Assigned:      v.ConsumedUnits,
			Available:     v.PrepaidUnits.Enabled - v.ConsumedUnits,
		})
	}
	return out
}

func parseLicenses(body []byte) []string {
	var r struct {
		Value []struct {
			SkuPartNumber string `json:"skuPartNumber"`
		} `json:"value"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil
	}
	out := make([]string, 0, len(r.Value))
	for _, v := range r.Value {
		out = append(out, FriendlySku(v.SkuPartNumber))
	}
	return out
}

func graphErr(body []byte, status int) string {
	var r struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &r)
	if r.Error.Message != "" {
		return firstLine(r.Error.Message)
	}
	return fmt.Sprintf("HTTP %d", status)
}

func graphGet(doer Doer, token, pathQuery string) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodGet, graphBase+pathQuery, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := doer.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}
