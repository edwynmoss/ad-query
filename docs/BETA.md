# AD Query, beta guide

A read-only desktop tool for ad-hoc Active Directory / LDAP queries with CSV
export, bulk lookup from CSV/Excel, and optional Microsoft 365 enrichment.

This guide covers running the beta, connecting, what the tool does and doesn't
do with your data, current limits, and how to report problems.

## Install and run

- **Requirements:** Windows 10 or 11. The app uses the WebView2 runtime, which
  ships with Windows 11; on older Windows 10 builds, install it from Microsoft
  ("Evergreen Standalone Installer") if the window comes up blank.
- **No installer, no admin rights.** It's a single `ADQuery.exe` (~15 MB). Copy
  it anywhere and double-click.
- **It's unsigned during the beta.** SmartScreen will say "Windows protected
  your PC." Click **More info → Run anyway**. This is expected, we haven't
  bought a code-signing certificate yet.

## Connect

On a domain-joined machine the connect screen detects your domain and offers a
one-click **Sign in as you** (Windows SSO, no password typed or stored).

To connect to a specific directory instead:

1. **Server address**, your DC or directory host, e.g. `dc01.contoso.com`.
   Prefix with `ldaps://` for an encrypted connection.
2. **Sign in with**, *Username & password* (accepts `you@contoso.com`,
   `CONTOSO\you`, or a full DN) or *Windows sign-in*.
3. **LDAPS:** the server certificate is verified by default. Only tick
   *Accept self-signed certificate* for a lab DC whose cert isn't trusted by
   the machine.

Save a connection (host/DN, not the password) from **Save current**. The
password is kept in Windows Credential Manager, keyed to the saved name.

## What it does

- **Query** users, groups, computers, OUs. Search by name/email/username, or
  build structured filters (the raw LDAP filter is one "advanced" level down).
- **Pick any attributes as columns** and sort/scroll the results grid.
- **Export CSV**, optionally with an evidence header (who ran it, when, the
  directory, scope, and filter) for audit trails.
- **Bulk lookup:** import a CSV/Excel list of identities, match them against the
  directory, and export the enriched rows. Unmatched rows are listed and can be
  exported on their own.
- **Reports:** stale accounts, privileged-group members (including nested),
  license/sign-in, and an all-users export.
- **Inspect** a row for full attributes, accurate last-logon (queried across
  every DC, since `lastLogon` isn't replicated), risk flags, and the security
  descriptor (ACL).

## Read-only, always

The tool never writes to your directory. No add, modify, move, or delete is
possible, and a build-time test fails the release if a write call is ever
introduced. Microsoft 365 access is GET-only (the sign-in itself is the only
POST).

## Microsoft 365 (optional)

Click the **365** button to sign in with your own Microsoft account. This is a
delegated, read-only sign-in, no app registration, no client secret, and the
token is held in memory for the session only (never written to disk; gone when
you sign out or close the app). It adds account-enabled, license, and
last-sign-in columns, joined to AD accounts by UPN/email.

Permissions are read-only directory scopes; your tenant admin may have to
approve them once.

## Your data

- Everything runs on your machine. LDAP traffic goes only to the directory you
  connect to.
- The only outbound internet calls are to Microsoft Graph, and only after you
  sign in to 365, read-only lookups of the accounts you query.
- Passwords live in Windows Credential Manager, not in the app or on disk. The
  365 token lives in memory only.
- CSV files are written where you choose. Nothing is uploaded anywhere.
- **Query results are cached locally** at `%AppData%\ADQuery\cache.db` so
  re-running a query against a large domain is instant. This file holds the
  directory attributes you've queried; it lives in your Windows profile and is
  **not encrypted**. Clear it any time with **Tools → Clear cached data**.
  Each result shows "as of <time>", click **Rescan** to pull fresh values.

## Known limits in this beta

- **Unsigned binary**, the SmartScreen prompt above.
- **365 enrichment is slow at large scale.** It looks each identity up
  individually, so a stale report or bulk file covering many thousands of
  365-checked users will be slow and may hit Graph rate limits. Keep
  365-enriched sets to the low hundreds for now. AD-only queries are unaffected
  and handle 25k+ users comfortably.
- **Accurate last-logon** queries every domain controller; in a forest with
  many DCs that one lookup takes longer.
- Validated against Active Directory and OpenLDAP. Unusual schemas may surface
  attributes the friendly labels don't yet cover (the raw name is always shown).

## If something goes wrong

- **"Connection refused" / can't connect**, check the host and port, that LDAP
  (389) or LDAPS (636) is reachable, and that a firewall isn't blocking it.
- **Certificate error on LDAPS**, the DC's certificate chain isn't trusted by
  this machine. Install the issuing CA, or (lab only) tick *Accept self-signed*.
- **365 sign-in doesn't return**, complete it in the browser window it opened.
  If the browser can't be used, choose *Sign in with a code*.
- **Results say "partial"**, the server capped the result set; narrow the
  filter or the search location to see the rest.
- Every error has a **Details** expander with the raw message, include that
  when reporting.

## Reporting feedback

Open an issue at **https://github.com/edwynmoss/ad-query/issues**, the bug-report
form prompts for everything below. Include:

1. What you were doing (the query, report, or action).
2. What you expected vs. what happened.
3. The directory type (Active Directory or LDAP) and roughly how large it is.
4. The text under **Details** on any error.

Please don't include screenshots or exports containing real user data, a
description of the shape of the problem is enough.
