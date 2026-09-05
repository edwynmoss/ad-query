# Samba AD test directory

A **real Active Directory domain controller** (Samba, with a Kerberos KDC) for
validating AD Query's "AD mode" features and the SSO/Kerberos auth path, the
things OpenLDAP can't exercise:

- `nTSecurityDescriptor` (ACLs), the SD-flags control fetch + the security-descriptor parser
- `userAccountControl` flags, `sAMAccountName`, `objectCategory`
- AD object-type filters, the AD subschema, RootDSE AD detection
- **Kerberos / GSSAPI bind** against a live KDC (port 88)

> Image: [`diegogslomp/samba-ad-dc`](https://hub.docker.com/r/diegogslomp/samba-ad-dc), a full Samba AD DC.
> Runs a KDC, so the GSSAPI/Kerberos bind is testable with explicit credentials. (True zero-prompt
> Windows SSPI SSO still requires a domain-joined host, no container can supply the host's ticket.)
> The image already sets `ldap server require strong auth = No`, so plain-LDAP simple binds work for dev.

## Usage

```powershell
cd test/samba-ad
docker compose up -d         # provisions a DC + KDC (~1-2 min); wait for "healthy"
./seed.ps1                   # add sample OUs / users / groups
./seed-gpo.ps1               # Group Policy only: links, inheritance, filtering (seed.ps1 runs it too)
docker compose down -v       # wipe
```

## Connection

| | |
|---|---|
| URL | `ldap://localhost:1389` (LDAPS on `1636`) |
| Base DN | `dc=adquery,dc=test` |
| Bind | `administrator@adquery.test` |
| Password | `AdminPass123!` |
| Sample users | `jdoe`, `ckent`, `llane` (disabled), password `Passw0rd!` |

Ports (1389/1636) differ from the OpenLDAP stack (3389/6636) so both can run at once.
The KDC is on **88** (tcp+udp) and kpasswd on **464**.

### Kerberos / SSO testing

```
Auth:    kerberos
Username: administrator       Realm: ADQUERY.TEST
KDC:     127.0.0.1:88         Service principal: ldap/dc1.adquery.test
```

## Validated by

- `app/backend/ldap/samba_integration_test.go`, AD detection, AD-mode user filter,
  and parsing a **real** `nTSecurityDescriptor`.
- `app/backend/ldap/samba_kerberos_test.go`, a real **SASL GSSAPI / Kerberos bind**
  against the KDC, then an authenticated search.

Run: `go test ./backend/ldap/ -run Samba -count=1`

## Group Policy in the seed

`seed-gpo.ps1` creates eleven policies so every verdict the policy chain can give has a case:

| Policy | Linked at | Twist |
|---|---|---|
| Corporate Baseline | domain | enforced |
| VPN Client Settings | domain | Apply Group Policy denied to Sales Team |
| Site Time Sync | Default-First-Site-Name | site-level link |
| People Screensaver | OU=People | computer half disabled (flags 2) |
| Sales Drive Maps | OU=Sales | plain link |
| Sales Printers | OU=Sales | link disabled |
| IT Admin Tools | OU=IT | applies only to IT Team (Authenticated Users removed) |
| Finance Lockdown | OU=Finance | the OU blocks inheritance |
| Workstation Hardening | OU=Workstations | WMI filter reference |
| Server Config | OU=Servers | user half disabled (flags 1) |
| Legacy Proxy | nowhere | orphan |

So a Sales user should see Corporate Baseline, People Screensaver and Sales Drive Maps apply, VPN Client Settings filtered out, Sales Printers disabled; a Finance user only Corporate Baseline (enforced through the block) and Finance Lockdown.

