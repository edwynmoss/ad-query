package main

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"app/backend/adtypes"
	"app/backend/creds"
	"app/backend/ldap"
	"app/backend/m365"
	"app/backend/sysenv"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound application. It owns a single active directory
// connection (a "session") that the frontend connects/queries/disconnects.
type App struct {
	ctx context.Context

	mu     sync.Mutex
	conn   *ldap.Conn
	server *ldap.ServerInfo
	opts   ldap.ConnectOptions // retained (in-memory) so we can re-dial other DCs

	// Microsoft 365 / Entra (Graph) session.
	m365cfg     Config365
	m365dc      *m365.DeviceCode
	m365tok     m365.Token
	m365account string // signed-in identity (UPN/email), for display
	http        *http.Client
}

// Config365 is the tenant + public client app registration for the 365 check.
type Config365 struct {
	TenantID string `json:"tenantID"`
	ClientID string `json:"clientID"`
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{http: &http.Client{Timeout: 30 * time.Second}}
}

// ---- Microsoft 365 / Entra (Graph) -----------------------------------------

// M365SignInInteractive runs the seamless auth-code + PKCE flow: it opens the
// user's default browser to the Microsoft sign-in page (silent if they already
// have an Entra session) and captures the token over a loopback redirect.
// Blocks until sign-in completes, is cancelled, or times out. Returns when a
// token is held; the frontend then just calls M365SignedIn/M365Check.
func (a *App) M365SignInInteractive(tenantID string, clientID string) error {
	a.mu.Lock()
	a.m365cfg = Config365{TenantID: tenantID, ClientID: clientID}
	ctx := a.ctx
	a.mu.Unlock()

	cfg := m365.Config{TenantID: tenantID, ClientID: clientID}
	flowCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	open := func(url string) error { wruntime.BrowserOpenURL(a.ctx, url); return nil }
	tok, err := m365.AcquireInteractive(flowCtx, a.http, open, cfg, m365.DefaultScopes)
	if err != nil {
		return err
	}

	a.mu.Lock()
	a.m365tok = *tok
	a.m365account = m365.AccountName(tok.AccessToken)
	a.m365dc = nil
	a.mu.Unlock()
	return nil
}

// M365StartSignIn begins delegated device-code sign-in and returns the code +
// URL to present to the user.
func (a *App) M365StartSignIn(tenantID string, clientID string) (*m365.DeviceCode, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.m365cfg = Config365{TenantID: tenantID, ClientID: clientID}
	dc, err := m365.StartDeviceCode(a.http, m365.Config{TenantID: tenantID, ClientID: clientID}, m365.DefaultScopes)
	if err != nil {
		return nil, err
	}
	a.m365dc = dc
	a.m365tok = m365.Token{}
	return dc, nil
}

// M365PollSignIn polls once; true = signed in, false = still pending.
func (a *App) M365PollSignIn() (bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.m365dc == nil {
		return false, fmt.Errorf("no sign-in in progress")
	}
	cfg := m365.Config{TenantID: a.m365cfg.TenantID, ClientID: a.m365cfg.ClientID}
	tok, pending, err := m365.PollToken(a.http, cfg, a.m365dc.DeviceCode)
	if err != nil {
		a.m365dc = nil
		return false, err
	}
	if pending {
		return false, nil
	}
	a.m365tok = *tok
	a.m365account = m365.AccountName(tok.AccessToken)
	a.m365dc = nil
	return true, nil
}

// M365SignedIn reports whether a valid Graph token is held.
func (a *App) M365SignedIn() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.m365tok.Valid()
}

// M365Account returns the signed-in identity (UPN/email) for display, or "".
func (a *App) M365Account() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.m365tok.Valid() {
		return ""
	}
	return a.m365account
}

// M365SignOut clears the 365 session.
func (a *App) M365SignOut() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.m365tok = m365.Token{}
	a.m365account = ""
	a.m365dc = nil
}

// accessToken returns a currently-valid Graph access token, silently refreshing
// via the stored refresh token when the current one is expired/near-expiry.
func (a *App) accessToken() (string, error) {
	a.mu.Lock()
	tok := a.m365tok
	cfg := m365.Config{TenantID: a.m365cfg.TenantID, ClientID: a.m365cfg.ClientID}
	doer := a.http
	a.mu.Unlock()

	if tok.AccessToken == "" {
		return "", fmt.Errorf("not signed in to Microsoft 365")
	}
	if tok.Expiring() && tok.RefreshToken != "" {
		fresh, err := m365.Refresh(doer, cfg, tok.RefreshToken, m365.DefaultScopes)
		if err == nil && fresh != nil {
			if fresh.RefreshToken == "" {
				fresh.RefreshToken = tok.RefreshToken // reuse if the response didn't rotate it
			}
			a.mu.Lock()
			a.m365tok = *fresh
			a.m365account = m365.AccountName(fresh.AccessToken)
			a.mu.Unlock()
			return fresh.AccessToken, nil
		}
		// refresh failed — fall through to whatever we have (may still be valid)
	}
	if !tok.Valid() {
		return "", fmt.Errorf("Microsoft 365 session expired — sign in again")
	}
	return tok.AccessToken, nil
}

// M365LicenseReport returns the tenant's per-SKU seat counts.
func (a *App) M365LicenseReport() ([]m365.LicenseSku, error) {
	token, err := a.accessToken()
	if err != nil {
		return nil, err
	}
	return m365.LicenseReport(a.http, token)
}

// M365Check resolves each identity (UPN/email) against Microsoft Graph.
func (a *App) M365Check(identities []string) ([]m365.User, error) {
	token, err := a.accessToken()
	if err != nil {
		return nil, err
	}
	doer := a.http
	out := make([]m365.User, 0, len(identities))
	for _, id := range identities {
		if id == "" {
			continue
		}
		out = append(out, m365.LookupUser(doer, token, id))
	}
	return out, nil
}

// DetectDomain reports whether this machine is domain-joined, enabling a
// zero-config "connect to my domain as the current user (SSO)" path.
func (a *App) DetectDomain() sysenv.Domain {
	return sysenv.Detect()
}

// startup is called when the app starts. The context is saved so we can call
// the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown closes any open connection when the window closes.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn != nil {
		_ = a.conn.Close()
		a.conn = nil
	}
}

// Connect opens (replacing any existing) a directory session and returns the
// server info gathered from the RootDSE.
func (a *App) Connect(opts ldap.ConnectOptions) (*ldap.ServerInfo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.conn != nil {
		_ = a.conn.Close()
		a.conn = nil
		a.server = nil
	}

	conn, err := ldap.Connect(opts)
	if err != nil {
		return nil, err
	}

	info, err := conn.RootDSE()
	if err != nil {
		// Connection bound but RootDSE failed (some servers restrict it).
		// Keep the session usable rather than tearing it down.
		info = &ldap.ServerInfo{}
	}

	a.conn = conn
	a.server = info
	a.opts = opts
	return info, nil
}

// AccurateLastLogon queries every domain controller for the user's (non-
// replicated) lastLogon and returns the newest — the reliable "last login".
// Falls back to the connected host if DC enumeration isn't possible.
func (a *App) AccurateLastLogon(dn string) (*ldap.LastLogonReport, error) {
	a.mu.Lock()
	conn := a.conn
	opts := a.opts
	a.mu.Unlock()
	if conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	dcs, err := conn.DomainControllers()
	if err != nil || len(dcs) == 0 {
		dcs = []string{opts.Host} // not AD / can't enumerate — use the connected server
	}
	return ldap.AccurateLastLogon(opts, dcs, dn), nil
}

// Disconnect closes the active session.
func (a *App) Disconnect() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn == nil {
		return nil
	}
	err := a.conn.Close()
	a.conn = nil
	a.server = nil
	return err
}

// IsConnected reports whether a session is active.
func (a *App) IsConnected() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conn != nil
}

// ServerInfo returns the cached RootDSE summary for the active session.
func (a *App) ServerInfo() *ldap.ServerInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.server
}

// Search runs a query against the active session.
func (a *App) Search(req ldap.SearchRequest) (*ldap.SearchResult, error) {
	a.mu.Lock()
	conn := a.conn
	a.mu.Unlock()
	if conn == nil {
		return nil, fmt.Errorf("not connected: open a connection first")
	}
	return conn.Search(req)
}

// SchemaAttributes returns every attribute name the connected directory defines,
// so the column picker can offer the full schema rather than a fixed list.
func (a *App) SchemaAttributes() ([]string, error) {
	a.mu.Lock()
	conn := a.conn
	a.mu.Unlock()
	if conn == nil {
		return nil, fmt.Errorf("not connected: open a connection first")
	}
	return conn.SchemaAttributeNames()
}

// GetACL fetches and parses the security descriptor (owner, group, DACL) for an
// object. AD-only: directories without nTSecurityDescriptor return an error.
func (a *App) GetACL(dn string) (*adtypes.SecurityDescriptor, error) {
	a.mu.Lock()
	conn := a.conn
	a.mu.Unlock()
	if conn == nil {
		return nil, fmt.Errorf("not connected: open a connection first")
	}
	raw, err := conn.FetchSecurityDescriptor(dn, 0)
	if err != nil {
		return nil, err
	}
	return adtypes.ParseSecurityDescriptor(raw)
}

// Connection-profile secret storage (Windows Credential Manager). Profile
// metadata (host/port/etc.) lives in the frontend; only the password is stored
// here, keyed by profile name.

// StoreSecret saves a profile's password in the OS credential store.
func (a *App) StoreSecret(profile string, secret string) error {
	return creds.Store(profile, secret)
}

// GetSecret retrieves a profile's stored password.
func (a *App) GetSecret(profile string) (string, error) {
	return creds.Get(profile)
}

// HasSecret reports whether a stored password exists for a profile.
func (a *App) HasSecret(profile string) bool {
	return creds.Exists(profile)
}

// DeleteSecret removes a profile's stored password.
func (a *App) DeleteSecret(profile string) error {
	return creds.Delete(profile)
}
