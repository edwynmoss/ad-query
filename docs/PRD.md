# AD Query, Product Requirements Document

**Status:** Draft v1 · **Owner:** edwyn · **Last updated:** 2026-06-06

---

## 1. Summary

**AD Query** is a Windows desktop application for IT administrators and analysts to run **granular, ad-hoc queries against Active Directory (AD) / LDAP directories** and **export exactly the fields they care about to CSV**.

The user picks a directory object type (users, groups, computers, OUs…), narrows it with filters, chooses **any** set of attributes to display as columns (last login, ACLs, account flags, group membership, etc.), runs the query, inspects results in a fast data grid, and exports the selection to CSV.

The guiding principle is **granularity**: the user should be able to select almost anything, any object class, any attribute, any subset of rows/columns, and get it out as CSV.

---

## 2. Goals & non-goals

### Goals
- Connect to AD/LDAP and authenticate (v1: manual credentials; later: Windows SSO).
- Browse the directory schema so the user can pick **any** attribute, not a fixed list.
- Compose queries visually (object type + filter builder) **and** via raw LDAP filter for power users.
- Surface "hard" data that admins actually want: **last logon**, **account status flags**, **password age**, **group membership**, and **ACLs / security descriptors**.
- Present results in a dense, sortable, filterable grid with show/hide columns.
- **Export to CSV**, all rows or a selected subset, all columns or a chosen subset.
- Be testable end-to-end against **OpenLDAP in Docker** (no real domain required for dev).

### Non-goals (v1)
- **Writing** to the directory (create/modify/delete objects). Read-only in v1.
- Full GPO editing / RSoP analysis.
- Cross-forest trust resolution beyond what a single bind exposes.
- Non-Windows builds as a first-class target (Wails supports it, but Windows is the priority).

---

## 3. Target users & use cases

| User | Use case |
|---|---|
| Sysadmin | "Export all enabled users in OU=Sales who haven't logged in for 90 days, with their manager and last logon date." |
| Security analyst | "Who has explicit permissions on this OU? Dump the ACL." |
| Helpdesk | "Find a locked-out account and see why (bad pwd count, lockout time)." |
| Auditor | "Give me every group and its members as CSV for the access review." |
| IT ops | "List all computers, their OS version, and last logon, sorted by stalest." |

---

## 4. Research notes (informing the design)

### 4.1 Auth & connectivity
- AD speaks **LDAP v3**. Production auth is **Integrated Windows Auth** (Kerberos, fallback NTLM via SSPI). For v1 we use **manual bind** (server host:port, bind DN or UPN, password, StartTLS/LDAPS toggle) because it works identically against AD and against OpenLDAP, and is fully testable. SSO is a fast-follow.
- Library: **`github.com/go-ldap/ldap/v3`**, supports simple bind, SASL, NTLM (`go-ntlmssp`), StartTLS, paged search controls. The Go ecosystem keeps the backend small and lets us defer Kerberos to a later milestone without rewriting.
- Always use **paged search** (control `1.2.840.113556.1.4.319`, page size ~1000), AD caps results at 1000 by default; without paging large queries silently truncate.

### 4.2 "Last login" is a trap, handle it explicitly
- `lastLogonTimestamp`, **replicated**, but deliberately imprecise (updated only when the prior value is older than ~9-14 days). Good enough for "stale account" reports; this is the default we surface.
- `lastLogon`, **accurate but per-DC and NOT replicated**. A true "last logon" requires querying *every* DC and taking the max. We expose it but label it clearly and (later) offer multi-DC aggregation.
- Both are stored as Windows **FILETIME** (100-ns ticks since 1601-01-01 UTC). We convert to local datetime in the UI and ISO-8601 in CSV.

### 4.3 Account status lives in `userAccountControl` (UAC) bit flags
We decode the bitmask into friendly booleans, e.g.:
- `0x0002` ACCOUNTDISABLE → **Disabled**
- `0x0010` LOCKOUT → **Locked out** (also check `lockoutTime`)
- `0x10000` DONT_EXPIRE_PASSWORD → **Password never expires**
- `0x800000` PASSWORD_EXPIRED, `0x0020` PASSWD_NOTREQD, `0x80000` TRUSTED_FOR_DELEGATION, etc.

Other time fields are FILETIME too: `pwdLastSet`, `accountExpires`, `badPasswordTime`, `lockoutTime`.

### 4.4 ACLs / security descriptors
- The ACL lives in the **`nTSecurityDescriptor`** attribute, returned as a binary blob (self-relative `SECURITY_DESCRIPTOR`).
- To read it you must request the attribute **with an LDAP Security Descriptor control** (`LDAP_SERVER_SD_FLAGS_OID` = `1.2.840.113556.1.4.801`) specifying which parts (Owner/Group/DACL/SACL) you want; SACL needs `SeSecurityPrivilege`.
- We parse the SD into a list of ACEs: trustee SID (resolved to name where possible), allow/deny, rights mask, and any object-type GUID (mapped to friendly AD extended-right / property-set names where known).
- OpenLDAP does **not** have `nTSecurityDescriptor`; for dev/testing of the ACL feature we surface OpenLDAP's own ACL model only at a basic level, and gate full SD parsing behind "AD mode." ACL parsing is therefore a **milestone of its own** and validated against real AD / a Samba-AD container if available.

### 4.5 Schema-driven attribute picker
- AD/LDAP publish their schema. We read the **subschemaSubentry** (attribute types & object classes) so the attribute picker is **discovered, not hardcoded**, this is what makes the tool "select almost anything." We cache it per-connection.

### 4.6 Stack choice (decided with user)
- **Wails (Go + React/TypeScript).** Go core (LDAP, CSV, schema, conversions) exposed to a React/Vite/TS frontend via Wails bindings. Rationale: native-feeling, small binary, web-grade UI flexibility for a data-heavy tool, and Go's LDAP/CSV story is mature. (.NET was explicitly ruled out by the user.)
- Sources:
  - [go-ldap/ldap](https://github.com/go-ldap/ldap)
  - [Wails](https://wails.io)
  - [System.DirectoryServices.Protocols vs DirectorySearcher (background reading)](https://dartinnovations.com/system-directoryservices-vs-system-directoryservices-protocols-which-is-best/)
  - [LDAP_SERVER_SD_FLAGS_OID / reading nTSecurityDescriptor](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/)

---

## 5. Stack

| Layer | Choice |
|---|---|
| Shell | **Wails v2** (Go ↔ WebView2 on Windows) |
| Backend | **Go 1.26**, `go-ldap/ldap/v3`, stdlib `encoding/csv`, custom AD type converters |
| Frontend | **React 18 + TypeScript + Vite** |
| UI / design | Tailwind CSS + custom design system (see §7); **TanStack Table** for the virtualized data grid; **TanStack Query** for async state |
| Testing | **OpenLDAP in Docker** (`bitnami/openldap` or `osixia/openldap`) seeded via LDIF; Go unit tests; Vitest + Playwright (later) for UI |
| Packaging | `wails build` → signed Windows installer (NSIS) |

---

## 6. Functional requirements

### 6.1 Connection
- Connection form: **host, port, encryption (None / StartTLS / LDAPS), bind DN or UPN, password, Base DN** (auto-suggest from RootDSE `defaultNamingContext`).
- "Test connection" + RootDSE probe; remember connection profiles (password stored in **Windows Credential Manager**, never plaintext).
- Show server info (vendor, naming contexts, supported controls) so the user knows AD vs OpenLDAP.

### 6.2 Query builder
- **Object type** quick-pick: Users / Groups / Computers / OUs / Contacts / Any (maps to objectClass/objectCategory filters).
- **Visual filter builder**: rows of `attribute · operator · value`, AND/OR groups, with operators `=`, `≠`, `present`, `starts/ends/contains`, `<=`, `>=`, plus AD niceties (e.g. "disabled", "stale > N days", "member of group").
- **Raw LDAP filter** mode for power users, with live validation, kept in sync with the visual builder where possible.
- **Scope**: Base / One-level / Subtree; **Base DN** override per query.
- Saved queries (named, reusable).

### 6.3 Attribute / column selection (the core "granular" feature)
- Attribute picker populated from the **live schema** + a curated "common attributes" shortlist per object type.
- Search/filter attributes; multi-select; reorder columns; show/hide without re-querying.
- Special **computed columns** layered on raw attributes: decoded UAC flags, "days since last logon," human-readable FILETIME, group-membership count, etc.
- ACL column/panel: expand a row to see parsed ACEs.

### 6.4 Results grid
- Virtualized (handles 10k+ rows), client-side sort & quick-filter, row selection (checkbox + select-all-matching).
- Multi-valued attributes shown as chips / joined with a configurable delimiter.
- Per-cell copy; expand row to a detail/raw-LDIF view.

### 6.5 CSV export
- Export **all rows or selected rows**, **all columns or visible/selected columns**, in the **current column order**.
- Options: delimiter (`,` / `;` / tab), quoting, multi-value join string, datetime format (local / UTC / raw FILETIME / ISO-8601), include a header row, BOM for Excel.
- Streamed export in Go (no full in-memory blob) for large result sets; progress + cancel.
- Export the **raw LDAP filter + selected attributes** alongside (a `.query.json`) so a run is reproducible.

### 6.6 Safety & UX
- Read-only guarantee in v1 (no write operations exist in the binary's LDAP layer).
- Clear error surfaces for bind failures, referrals, size/time limits, and partial results.
- Audit log of queries run (local, optional).

---

## 7. Design theme

**Name:** *"Console"*, a calm, dense, professional IT-tool aesthetic. Dark-first, information-dense without feeling cramped, fast.

- **Mood:** modern terminal/observability dashboard meets Windows 11 Fluent. Think Grafana/Datadog density with cleaner typography.
- **Palette (dark default):**
  - Background `#0E1116`, surface `#161B22`, raised `#1C232C`
  - Border/hairline `#2A323D`
  - Text primary `#E6EDF3`, secondary `#9DA7B3`, muted `#6B7682`
  - Accent (actions/links) `#3B82F6` (azure), success `#3FB950`, warning `#D29922`, danger `#F85149`
  - Status chips: Enabled=green, Disabled=muted, Locked=red, Stale=amber
- **Light theme:** mirrored tokens, paper `#FFFFFF` / `#F6F8FA`, same accents.
- **Type:** UI in **Inter**; all DNs, filters, attribute values, and the grid in a mono face (**JetBrains Mono / Cascadia Code**), directory data is code-like and benefits from monospace alignment.
- **Layout:** left rail (connections / saved queries), center query builder collapsing into a results grid, right inspector panel (row detail / ACL viewer). Sticky toolbar with Run / Export.
- **Density:** compact row height (~28px) toggleable to comfortable; tabular numerals.
- **Motion:** minimal, 120ms ease for panel/inspector transitions; no decorative animation.
- **Icons:** Lucide (line icons), consistent 16px in the grid.

---

## 8. Architecture (high level)

```
┌─────────────────────────────────────────────┐
│ React/TS frontend (Vite)                      │
│  • Connection UI  • Query builder             │
│  • Attribute picker (schema-driven)           │
│  • TanStack Table grid  • CSV export dialog   │
└───────────────▲───────────────────────────────┘
                │ Wails bindings (typed Go ↔ TS)
┌───────────────┴───────────────────────────────┐
│ Go backend                                     │
│  ldap/      connect, bind, paged search,       │
│             schema read, SD-flags control      │
│  adtypes/   FILETIME, UAC, SID/GUID decoders   │
│  query/     filter model → LDAP filter string  │
│  export/    streaming CSV writer               │
│  creds/     Windows Credential Manager store   │
└────────────────────────────────────────────────┘
```

**Key modules**
- `ldap`: connection lifecycle, `SearchPaged`, schema fetch, ACL fetch via SD-flags control.
- `adtypes`: pure functions (FILETIME↔time, UAC↔flags, SID↔string, GUID maps), heavily unit-tested.
- `query`: a serializable filter model (the visual builder's source of truth) that compiles to a validated LDAP filter; round-trips to/from raw.
- `export`: takes (rows iterator, column spec, options) → streamed CSV.

---

## 9. Milestones / roadmap

- **M0, Scaffold & infra:** ✅ Wails project, React+Tailwind+TS, Docker OpenLDAP with seed LDIF, Go tests.
- **M1, Connect & search:** ✅ connection form, bind, RootDSE, paged search, raw filter, results grid.
- **M2, Granular selection:** ✅ schema-driven attribute picker, visual filter builder, column show/hide, saved queries.
- **M3, CSV export:** ✅ export dialog with all options, row/column subset. *(Go streaming writer + `.query.json`: future.)*
- **M4, AD-specific value:** ✅ UAC decode, FILETIME columns, last-logon. *(Multi-DC `lastLogon` aggregation, group-membership expansion: future.)*
- **M5, ACLs:** ✅ SD-flags control fetch, security-descriptor parse, ACE viewer, SID/GUID resolution.
- **M6, Polish & auth:** ✅ Windows Credential Manager + connection profiles, theming. ⏳ **Windows SSO (Kerberos/NTLM)**, deferred: needs a domain to validate and explicit go-ahead (`gokrb5`/`sspi` already vendored). ⏳ Installer packaging (`wails build -nsis`).

---

## 10. Open questions
1. Multi-DC `lastLogon` aggregation in v1, or accept `lastLogonTimestamp` only? (Leaning: ts only in v1.)
2. Should saved queries / profiles sync anywhere, or stay purely local? (Assumption: local only.)
3. Packaging: do we need a signed installer for v1 distribution, or is a portable exe enough?
