# AD Query

A Windows desktop app for running **granular, ad-hoc queries against Active Directory / LDAP** and exporting exactly the fields you want to **CSV**.

Pick an object type, narrow it with a filter, choose *any* attributes as columns (last logon, account flags, group membership, ACLs…), run it, and export the rows/columns you care about.

> **Running it?** See **[docs/BETA.md](docs/BETA.md)** for install, connecting, data handling, and known limits. Full product spec, stack rationale, and roadmap are in **[docs/PRD.md](docs/PRD.md)**.

## Screenshots

The app is one document: a running head, a sheet with register tabs along its top edge, and a foot. Open a directory (a joined domain is one sentence and one button), then ask in plain words: what, where, and the conditions, with the search as a rule.

| Open a directory | Opening sheet | The question as a heading |
|---|---|---|
| ![Connect](docs/screenshots/01-connect.png) | ![Opening](docs/screenshots/02-opening.png) | ![Heading](docs/screenshots/03-heading.png) |

The ledger: a numbered margin, mono figures, account flags as small capitals. The right pane gives facts about a column (click a value to keep it, Alt-click to exclude) or one row in full.

| Ledger | Column facts | A row in full | Login across every DC |
|---|---|---|---|
| ![Ledger](docs/screenshots/04-ledger.png) | ![Facts](docs/screenshots/05-facts.png) | ![Row](docs/screenshots/06-row.png) | ![Login](docs/screenshots/07-login.png) |

| Risk | Security descriptor | Export | Dark |
|---|---|---|---|
| ![Risk](docs/screenshots/08-risk.png) | ![Security](docs/screenshots/09-security.png) | ![Export](docs/screenshots/10-export.png) | ![Dark](docs/screenshots/16-ledger-dark.png) |

Registers are pages of the same sheet: stale accounts across AD and Microsoft 365, privileged access with nested membership and risk, licences held by dormant accounts, and bulk lookup from a spreadsheet.

| Stale accounts | Privileged access | Licences | Bulk lookup | 365 sign-in |
|---|---|---|---|---|
| ![Stale](docs/screenshots/11-stale.png) | ![Privileged](docs/screenshots/12-privileged.png) | ![Licences](docs/screenshots/13-licences.png) | ![Bulk](docs/screenshots/14-bulk.png) | ![365](docs/screenshots/15-m365-signin.png) |

Group Policy, as far as the directory can tell. A row's Policies section answers in a sentence ("Terry Wong gets 5 policies. 2 more are linked above them but never arrive.") and then shows the working: policy flowing down the tree, each link with its fate in plain words, blocked inheritance as a dashed rule only enforced links pass. The Policies register opens on the question: trace policy to a person, a computer or a container; browse the tree, which folds branches with nothing linked; or list every policy.

| Flow to a row | The question | A container trace |
|---|---|---|
| ![Row policies](docs/screenshots/17-row-policies.png) | ![Policies](docs/screenshots/18-policies.png) | ![Trace](docs/screenshots/19-policies-trace.png) |

| The tree | Every policy |
|---|---|
| ![Tree](docs/screenshots/20-policies-tree.png) | ![Policies list](docs/screenshots/21-policies-list.png) |

Any line can be tried as a hypothetical: unlink a policy, stop a container blocking inheritance, or move a person and watch the flow redraw. A person signed in on a machine is traced as two halves, the person's user settings beside the machine's computer settings. Two people can be compared the same way, with the policies only one of them receives marked on each side, and any trace copies as text or exports as CSV.

| A policy, with a change tried on it | Signed in on a machine |
|---|---|
| ![Policy page](docs/screenshots/22-policy-page.png) | ![Person on a machine](docs/screenshots/23-person-on-machine.png) |

> Regenerate with `cd app/frontend && npm run shots` (builds the app, serves it, and drives the journey through Playwright into `docs/screenshots/`). `node scripts/e2e-ledger.mjs` drives the real backend through `wails dev` against the Samba AD container in `test/samba-ad`.

## Stack

- **Wails v2** desktop shell (Go ↔ WebView2)
- **Go 1.26** backend: `go-ldap/ldap/v3`, streaming CSV, AD type decoders
- **React 18 + TypeScript + Vite** frontend, Tailwind + TanStack Table

## Layout

```
app/            Wails application (Go backend + React/TS frontend)
docs/           PRD and design docs
test/openldap/  Dockerized OpenLDAP test directory + seed LDIF
test/samba-ad/  Dockerized real Active Directory DC (KDC) for AD-mode + Kerberos
```

## Authentication

- **Password**: simple bind (DN/UPN + password). Works against any LDAP/AD; used for the test directories.
- **Windows SSO**: SASL GSSAPI over SSPI: binds as the **current logged-in Windows user** with no prompt. Requires a domain-joined machine.
- **Kerberos**: explicit-credential GSSAPI against a named KDC (cross-platform; what the Samba AD test directory validates).

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

## Install

Grab `ADQuery-x.y.z-x64-setup.exe` from the [latest release](https://github.com/edwynmoss/ad-query/releases/latest). It installs for your account only (no administrator prompt) and adds a Start menu entry. From 1.0.0 the app checks for a newer release a few seconds after launch and while it stays open, and offers it in a toast; **Check for updates** is in the Tools menu. Installers are signed with the project's release key and verified before they run.

### Windows will warn you the first time

The installer is not code-signed, and it is not going to be: a certificate costs
real money every year and this is a free tool. So Windows SmartScreen shows
"Windows protected your PC" on the first run. Click **More info**, then **Run
anyway**.

That warning is about who published the installer, not about whether it has been
tampered with. Every release is signed with the project's own key, and the app
checks that signature before it runs an update, so an installer that has been
altered in transit is refused. If you would rather verify by hand, each release
carries a `.sig` next to the installer and the public key is in `app/app.go`.

## Build a release locally

```powershell
cd app
wails build -nsis -ldflags "-X main.Version=1.0.0"   # app/build/bin/AD Query-amd64-installer.exe
```

Needs NSIS (`makensis`) on the PATH. The icon set and installer artwork are generated from the mark by `python scripts/installer-art.py`; the same geometry is drawn inline by `app/frontend/src/components/Mark.tsx`.

Tagging `vX.Y.Z` runs the release workflow: it stamps the version, builds and signs the installer, writes the update manifest, and opens a draft release with notes from `docs/releases/vX.Y.Z.md`. Publishing the draft is what makes installed copies start offering the update.

## Testing

```powershell
cd app && go test ./...              # backend (incl. the read-only guard)
cd app/frontend && npx vitest run    # lib unit + UI component tests
```

The **read-only guarantee** (`app/readonly_guard_test.go`) is enforced by the
test suite: the build fails if any LDAP write or non-GET Graph call is ever
introduced.

CI runs the same suite on every pull request. A `.githooks/pre-push` hook can
run it locally before any push as well. Enable it once per clone:

```powershell
git config core.hooksPath .githooks
```

## Requirements

- Go 1.26+, Node 20+, Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- Docker (for the test directories)
- WebView2 runtime (preinstalled on Windows 11)
