// Package m365 is a thin Microsoft Graph connector for enriching directory
// results with Entra ID / Microsoft 365 facts (account exists/enabled,
// assigned licenses, last sign-in).
//
// Auth is the OAuth2 *device code* flow against a public client app
// registration, delegated, so it runs as the signed-in user with their
// permissions and needs no client secret. On a domain/Entra-joined machine the
// browser step is silent (SSO via the user's PRT).
//
// The HTTP layer is an injectable Doer so the parsing/flow logic is unit-tested
// without a tenant. The live calls require a real Entra app registration.
package m365

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Doer is the minimal HTTP surface (so tests can stub responses).
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// DefaultClientID is Microsoft's first-party "Microsoft Graph Command Line
// Tools" public client (the same app id `Connect-MgGraph` uses). Using it means
// the user signs in with their own credentials and needs NO app registration 
// they just consent to the delegated, read-only scopes (an admin may approve
// the cross-user read scopes once for the tenant). Organisations that prefer
// their own app registration can override ClientID.
const DefaultClientID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"

// Config identifies the tenant + public client app registration.
type Config struct {
	TenantID string `json:"tenantID"`
	ClientID string `json:"clientID"`
}

// clientID returns the configured client or the built-in default.
func (c Config) clientID() string {
	if strings.TrimSpace(c.ClientID) == "" {
		return DefaultClientID
	}
	return c.ClientID
}

// DefaultScopes are the delegated Graph permissions the check needs.
// offline_access yields a refresh token; the rest are read-only.
var DefaultScopes = []string{
	"https://graph.microsoft.com/User.Read.All",
	"https://graph.microsoft.com/Directory.Read.All",
	"offline_access",
	"openid",
	"profile",
}

func (c Config) authority() string {
	t := c.TenantID
	if t == "" {
		t = "organizations"
	}
	return "https://login.microsoftonline.com/" + t
}

// DeviceCode is the response from the device-authorization endpoint: show the
// user UserCode + VerificationURI, then poll for the token.
type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
	Message         string `json:"message"`
}

// Token is an acquired access token (+ refresh token for silent renewal).
type Token struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"-"`
	ExpiresIn    int       `json:"expires_in"`
	Acquired     time.Time `json:"-"`
}

func (t Token) Valid() bool {
	return t.AccessToken != "" && time.Now().Before(t.Acquired.Add(time.Duration(t.ExpiresIn)*time.Second))
}

// Expiring reports whether the token is gone or within 60s of expiry, the cue
// to refresh it silently before the next Graph call.
func (t Token) Expiring() bool {
	return t.AccessToken == "" || time.Now().After(t.Acquired.Add(time.Duration(t.ExpiresIn-60)*time.Second))
}

// Refresh exchanges a refresh token for a fresh access token (silent renewal,
// no user interaction). offline_access on the original grant is what yields the
// refresh token.
func Refresh(doer Doer, cfg Config, refreshToken string, scopes []string) (*Token, error) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {cfg.clientID()},
		"refresh_token": {refreshToken},
		"scope":         {strings.Join(scopes, " ")},
	}
	body, status, err := postForm(doer, cfg.authority()+"/oauth2/v2.0/token", form)
	if err != nil {
		return nil, err
	}
	tok, _, err := parseTokenResponse(status, body)
	if err != nil {
		return nil, err
	}
	if tok == nil {
		return nil, fmt.Errorf("refresh returned no token (status %d)", status)
	}
	return tok, nil
}

// AccountName extracts a best-effort sign-in identity (UPN / email / name) from
// the access token's JWT claims, for showing *who* is connected. Display-only
// (not validated); returns "" if it can't be read.
func AccountName(accessToken string) string {
	parts := strings.Split(accessToken, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var c struct {
		UPN               string `json:"upn"`
		PreferredUsername string `json:"preferred_username"`
		Email             string `json:"email"`
		Name              string `json:"name"`
	}
	if json.Unmarshal(payload, &c) != nil {
		return ""
	}
	for _, v := range []string{c.UPN, c.PreferredUsername, c.Email, c.Name} {
		if v != "" {
			return v
		}
	}
	return ""
}

// StartDeviceCode kicks off the device-code flow.
func StartDeviceCode(doer Doer, cfg Config, scopes []string) (*DeviceCode, error) {
	form := url.Values{"client_id": {cfg.clientID()}, "scope": {strings.Join(scopes, " ")}}
	body, status, err := postForm(doer, cfg.authority()+"/oauth2/v2.0/devicecode", form)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("device code request failed: %s", oauthError(body))
	}
	return parseDeviceCode(body)
}

// PollToken polls once for the token. pending=true means keep waiting.
func PollToken(doer Doer, cfg Config, deviceCode string) (tok *Token, pending bool, err error) {
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"},
		"client_id":  {cfg.clientID()},
		"device_code": {deviceCode},
	}
	body, status, err := postForm(doer, cfg.authority()+"/oauth2/v2.0/token", form)
	if err != nil {
		return nil, false, err
	}
	return parseTokenResponse(status, body)
}

// ---- pure parsers (unit-tested) -------------------------------------------

func parseDeviceCode(body []byte) (*DeviceCode, error) {
	var dc DeviceCode
	if err := json.Unmarshal(body, &dc); err != nil {
		return nil, fmt.Errorf("parse device code: %w", err)
	}
	if dc.DeviceCode == "" || dc.UserCode == "" {
		return nil, fmt.Errorf("device code response missing fields")
	}
	if dc.Interval == 0 {
		dc.Interval = 5
	}
	return &dc, nil
}

func parseTokenResponse(status int, body []byte) (*Token, bool, error) {
	var r struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, false, fmt.Errorf("parse token response: %w", err)
	}
	if r.AccessToken != "" {
		return &Token{AccessToken: r.AccessToken, RefreshToken: r.RefreshToken, ExpiresIn: r.ExpiresIn, Acquired: time.Now()}, false, nil
	}
	switch r.Error {
	case "authorization_pending", "slow_down":
		return nil, true, nil
	case "":
		return nil, false, fmt.Errorf("token endpoint returned no token (status %d)", status)
	default:
		msg := r.Error
		if r.ErrorDesc != "" {
			msg = firstLine(r.ErrorDesc)
		}
		return nil, false, fmt.Errorf("sign-in failed: %s", msg)
	}
}

func oauthError(body []byte) string {
	var r struct {
		Error     string `json:"error"`
		ErrorDesc string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &r)
	if r.ErrorDesc != "" {
		return firstLine(r.ErrorDesc)
	}
	if r.Error != "" {
		return r.Error
	}
	return "unknown error"
}

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i]
	}
	return s
}

func postForm(doer Doer, endpoint string, form url.Values) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := doer.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}
