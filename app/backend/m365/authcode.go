package m365

// Interactive sign-in via the OAuth2 authorization-code flow with PKCE over a
// loopback redirect (RFC 8252). This is the primary, seamless path: it opens
// the user's default browser to the Microsoft sign-in page, which is usually
// already signed in (SSO via the existing Entra session) so it bounces straight
// back with no prompt. `prompt=select_account` lets a user with access to more
// than one tenant pick which account/tenant to use. No code to type, no client
// secret, no app registration (the built-in public client has http://localhost
// registered).

import (
	crand "crypto/rand"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
)

func newPKCE() (verifier, challenge string, err error) {
	b := make([]byte, 32)
	if _, err = crand.Read(b); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}

func randToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := crand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// authorizeURL builds the authorize endpoint URL for the loopback redirect.
func (c Config) authorizeURL(redirect, challenge, state, scope string) string {
	q := url.Values{
		"client_id":             {c.clientID()},
		"response_type":         {"code"},
		"redirect_uri":          {redirect},
		"scope":                 {scope},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {state},
		"prompt":                {"select_account"},
	}
	return c.authority() + "/oauth2/v2.0/authorize?" + q.Encode()
}

// AcquireInteractive runs the auth-code + PKCE flow: it binds a loopback
// listener, opens the browser via openURL, waits for the redirect, validates
// state, and exchanges the code for a token. Blocks until the user finishes,
// ctx is cancelled, or the listener errors.
func AcquireInteractive(ctx context.Context, doer Doer, openURL func(string) error, cfg Config, scopes []string) (*Token, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("start loopback listener: %w", err)
	}
	defer ln.Close()
	redirect := fmt.Sprintf("http://localhost:%d/callback", ln.Addr().(*net.TCPAddr).Port)

	verifier, challenge, err := newPKCE()
	if err != nil {
		return nil, err
	}
	state, err := randToken(16)
	if err != nil {
		return nil, err
	}

	type result struct {
		code string
		err  error
	}
	resCh := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if e := q.Get("error"); e != "" {
			writeClose(w, "Sign-in failed — you can close this window.")
			resCh <- result{err: fmt.Errorf("sign-in failed: %s", firstLine(q.Get("error_description")))}
			return
		}
		if q.Get("state") != state {
			writeClose(w, "Sign-in could not be verified — you can close this window.")
			resCh <- result{err: fmt.Errorf("state mismatch")}
			return
		}
		writeClose(w, "Signed in to AD Query — you can close this window and return to the app.")
		resCh <- result{code: q.Get("code")}
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	defer srv.Close()

	if err := openURL(cfg.authorizeURL(redirect, challenge, state, strings.Join(scopes, " "))); err != nil {
		return nil, fmt.Errorf("open browser: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-resCh:
		if res.err != nil {
			return nil, res.err
		}
		if res.code == "" {
			return nil, fmt.Errorf("no authorization code returned")
		}
		return exchangeCode(doer, cfg, redirect, res.code, verifier)
	}
}

func exchangeCode(doer Doer, cfg Config, redirect, code, verifier string) (*Token, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {cfg.clientID()},
		"code":          {code},
		"redirect_uri":  {redirect},
		"code_verifier": {verifier},
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
		return nil, fmt.Errorf("token endpoint returned no token (status %d)", status)
	}
	return tok, nil
}

func writeClose(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><title>AD Query</title>"+
		"<body style='margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui;background:#0a0a0b;color:#f4f4f5'>"+
		"<div style='text-align:center'><div style='font-size:15px;font-weight:600'>%s</div></div></body>", msg)
}
