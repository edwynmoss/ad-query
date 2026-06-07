package m365

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// stubDoer returns canned responses chosen by the request URL.
type stubDoer struct{ fn func(*http.Request) (*http.Response, error) }

func (s stubDoer) Do(r *http.Request) (*http.Response, error) { return s.fn(r) }

func resp(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}

func TestParseDeviceCode(t *testing.T) {
	dc, err := parseDeviceCode([]byte(`{"device_code":"DC","user_code":"ABCD-EFGH","verification_uri":"https://microsoft.com/devicelogin","expires_in":900,"interval":5,"message":"go here"}`))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if dc.UserCode != "ABCD-EFGH" || dc.VerificationURI == "" || dc.Interval != 5 {
		t.Errorf("bad parse: %+v", dc)
	}
	if _, err := parseDeviceCode([]byte(`{}`)); err == nil {
		t.Errorf("expected error for empty device code")
	}
}

func TestParseTokenResponse(t *testing.T) {
	tok, pending, err := parseTokenResponse(200, []byte(`{"access_token":"AT","expires_in":3600}`))
	if err != nil || pending || tok.AccessToken != "AT" {
		t.Errorf("success case wrong: tok=%v pending=%v err=%v", tok, pending, err)
	}
	if !tok.Valid() {
		t.Errorf("fresh token should be valid")
	}
	if _, pending, err := parseTokenResponse(400, []byte(`{"error":"authorization_pending"}`)); err != nil || !pending {
		t.Errorf("pending case wrong: pending=%v err=%v", pending, err)
	}
	if _, _, err := parseTokenResponse(400, []byte(`{"error":"expired_token","error_description":"AADSTS70019: code expired\r\nTrace..."}`)); err == nil {
		t.Errorf("expected error for expired_token")
	}
}

func TestFriendlySku(t *testing.T) {
	if FriendlySku("SPE_E3") != "Microsoft 365 E3" {
		t.Errorf("E3 map wrong")
	}
	if FriendlySku("WEIRD_SKU") != "WEIRD_SKU" {
		t.Errorf("unknown SKU should pass through")
	}
}

func TestLookupUserFound(t *testing.T) {
	doer := stubDoer{fn: func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "/licenseDetails") {
			return resp(200, `{"value":[{"skuPartNumber":"SPE_E5"},{"skuPartNumber":"POWER_BI_PRO"}]}`), nil
		}
		return resp(200, `{"id":"abc-123","accountEnabled":true,"displayName":"Jane Doe","userPrincipalName":"jane@corp.com","signInActivity":{"lastSignInDateTime":"2026-05-30T08:15:00Z"}}`), nil
	}}
	u := LookupUser(doer, "tok", "jane@corp.com")
	if !u.Exists || !u.Enabled || u.DisplayName != "Jane Doe" {
		t.Errorf("user fields wrong: %+v", u)
	}
	if u.LastSignIn != "2026-05-30T08:15:00Z" {
		t.Errorf("last sign-in wrong: %q", u.LastSignIn)
	}
	if len(u.Licenses) != 2 || u.Licenses[0] != "Microsoft 365 E5" {
		t.Errorf("licenses wrong: %v", u.Licenses)
	}
}

func TestParseSubscribedSkus(t *testing.T) {
	skus := parseSubscribedSkus([]byte(`{"value":[
		{"skuPartNumber":"SPE_E3","prepaidUnits":{"enabled":100},"consumedUnits":83},
		{"skuPartNumber":"POWER_BI_PRO","prepaidUnits":{"enabled":25},"consumedUnits":25}
	]}`))
	if len(skus) != 2 {
		t.Fatalf("expected 2 skus, got %d", len(skus))
	}
	if skus[0].Product != "Microsoft 365 E3" || skus[0].Purchased != 100 || skus[0].Assigned != 83 || skus[0].Available != 17 {
		t.Errorf("E3 sku wrong: %+v", skus[0])
	}
	if skus[1].Available != 0 {
		t.Errorf("PBI available should be 0, got %d", skus[1].Available)
	}
}

func TestLookupUserNotFound(t *testing.T) {
	doer := stubDoer{fn: func(r *http.Request) (*http.Response, error) {
		return resp(404, `{"error":{"code":"Request_ResourceNotFound","message":"not found"}}`), nil
	}}
	u := LookupUser(doer, "tok", "ghost@corp.com")
	if u.Exists {
		t.Errorf("expected not found")
	}
}
