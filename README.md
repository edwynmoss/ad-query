# AD Query

A Windows desktop app for running **granular, ad-hoc queries against Active Directory / LDAP** and exporting exactly the fields you want to **CSV**.

Pick an object type, narrow it with a filter, choose *any* attributes as columns (last logon, account flags, group membership, ACLs…), run it, and export the rows/columns you care about.

> Status: early development. See **[docs/PRD.md](docs/PRD.md)** for the full product spec, stack rationale, design theme, and roadmap.

## Screenshots

Connect (auto-detects your domain → sign in as you, no password) and the results "ledger":

| Connect | Results |
|---|---|
| ![Connect](docs/screenshots/01-connect.png) | ![Ledger](docs/screenshots/02-ledger.png) |

| Filters | Inspect (attributes + ACL) | Accurate last login (all DCs) |
|---|---|---|
| ![Filters](docs/screenshots/03-filters.png) | ![Inspector](docs/screenshots/04-inspector.png) | ![Login](docs/screenshots/12-login.png) |

| Bulk lookup from CSV/Excel | Export | Dark theme |
|---|---|---|
| ![Bulk](docs/screenshots/05-bulk.png) | ![Export](docs/screenshots/06-export.png) | ![Dark](docs/screenshots/07-ledger-dark.png) |

Reports — one-click run/download recipes, **unused-license reclamation** (licensed users dormant in AD *and* 365), stale-account review, and Microsoft 365 sign-in:

| Reports | Licenses & sign-in | Stale accounts | 365 sign-in |
|---|---|---|---|
| ![Reports](docs/screenshots/08-reports.png) | ![Licenses](docs/screenshots/09-reclaim.png) | ![Stale](docs/screenshots/10-stale.png) | ![365](docs/screenshots/11-m365-signin.png) |

> Regenerate with `cd app/frontend && npm run shots` (builds the app, serves it, and drives the journey via Playwright into `docs/screenshots/`).

## Stack

- **Wails v2** desktop shell (Go ↔ WebView2)
- **Go 1.26** backend — `go-ldap/ldap/v3`, streaming CSV, AD type decoders
- **React 18 + TypeScript + Vite** frontend, Tailwind + TanStack Table

## Layout

```
app/            Wails application (Go backend + React/TS frontend)
docs/           PRD and design docs
test/openldap/  Dockerized OpenLDAP test directory + seed LDIF
test/samba-ad/  Dockerized real Active Directory DC (KDC) for AD-mode + Kerberos
```

## Authentication

- **Password** — simple bind (DN/UPN + password). Works against any LDAP/AD; used for the test directories.
- **Windows SSO** — SASL GSSAPI over SSPI: binds as the **current logged-in Windows user** with no prompt. Requires a domain-joined machine.
- **Kerberos** — explicit-credential GSSAPI against a named KDC (cross-platform; what the Samba AD test directory validates).

## Quick start (development)

### 1. Start the test directory

```powershell
cd test/openldap
docker compose up -d
```

This brings up OpenLDAP seeded with sample users/groups/OUs/computers:

- **URL:** `ldap://localhost:3389` (LDAPS on `6636`)
- **Base DN:** `dc=adquery,dc=test`
- **Bind DN:** `cn=admin,dc=adquery,dc=test`
- **Password:** `AdminPass123!`
- Sample user password (all users): `Passw0rd!`
- Optional web UI: phpLDAPadmin at <http://localhost:8082>

### 2. Run the app

```powershell
cd app
wails dev
```

## Build a release

```powershell
cd app
wails build              # → app/build/bin/ADQuery.exe
```

Produces a standalone ~14 MB Windows executable (no installer required; the
WebView2 runtime ships with Windows 11). For distribution outside your own
machine you'll want to code-sign the binary. `wails build -nsis` produces an
installer if you have NSIS installed.

## Testing

```powershell
cd app && go test ./...              # backend (incl. the read-only guard)
cd app/frontend && npx vitest run    # lib unit + UI component tests
```

The **read-only guarantee** (`app/readonly_guard_test.go`) is enforced by the
test suite: the build fails if any LDAP write or non-GET Graph call is ever
introduced.

## Requirements

- Go 1.26+, Node 20+, Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- Docker (for the test directories)
- WebView2 runtime (preinstalled on Windows 11)
