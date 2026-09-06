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


## Measuring at the size of a real estate

`seed-gpo.ps1` proves the policy chain is **correct**. `seed-enterprise.ps1`
proves it is **usable**, by growing the directory to the size of a company with
twenty-five thousand seats:

```powershell
./seed-enterprise.ps1          # ~75 minutes, see below
./seed-enterprise.ps1 -Remove  # take it out again
```

| | |
|---|---|
| Users | 23,000 across 288 department OUs |
| Computers | 25,000 (22,000 workstations, 3,000 servers) |
| Organizational units | 831, eight regions of twelve sites |
| Policies | 466, linked in 683 places |
| Security groups | 120, used for the filtering on 1 policy in 7 |
| Total objects | 49,755 |

The load is slow and there is no way round it: Samba takes a single database
write lock, so it accepts about twenty records a second no matter how many
writers push at it. Six parallel `ldbadd` streams finish in the same time as
one. That is the write path only, and it says nothing about the read
performance being measured.

### The two measurements

**The backend**, calling the same methods the window calls:

```powershell
cd app
$env:ADQ_BENCH=1; go test -run TestPolicyPerformance -v -timeout 40m .
```

It prints each operation cold and warm, the size of the JSON that crosses to
the window, and the pieces `PolicyMap` is built from so a slow map can be
blamed on one of them.

**The window**, timing click to answer with the app actually running:

```powershell
cd app; wails dev          # in one terminal
cd app/frontend; node scripts/e2e-scale.mjs
```

It types into the picker a letter at a time, at the speed a person types,
because filling the box in one go hides the cost of a search per keystroke.
Screenshots and a `timings.json` land in `node_modules/.cache/adquery-e2e/scale`.

### What the numbers were

Against the seed above, on a laptop, after the fixes in this pass:

| | |
|---|---|
| Trace one person or one computer | 0.3 s |
| Try a hypothetical on a trace | 0.1 s |
| Look a name up in the picker | ~3 s |
| Read the whole tree (`PolicyMap`) | 0.9 s, 520 KB |
| Every policy and its links | 1.5 s |
| Draw the tree, 669 containers | 4.8 s |
| What if this policy were switched off | 1.3 s to the answer |
| Count the accounts under one OU | 1.6 s |
| Count the accounts under a whole domain | 38 s |

Counting is the one expensive thing, and it is not policy work: a directory has
no count operation, so the only way to a total is to fetch every matching
object and add them up. Nothing waits on it. Every screen that shows a count
shows its answer first and the number when it arrives, which is why switching a
policy off went from eight seconds to one and a third. The counts are exact:
capping them made the wait shorter for a number nobody was waiting on, at the
price of telling someone with twenty-three thousand people "five thousand or
more", which is not an answer.

### Run the correctness suite on the small seed

`scripts/e2e-ledger.mjs` asserts on the eleven policies above and on named
people, and the enterprise tree has its own OUs called Finance and Sales and
its own twenty thousand users. Run it against `seed.ps1` + `seed-gpo.ps1`
alone; with the enterprise tree in place it picks up the wrong Finance and the
wrong first row. `seed-enterprise.ps1 -Remove` puts the directory back.

**Samba is the harsher environment.** Its ambiguous-name resolution is slow in
a way real Active Directory's is not, so the picker's three seconds is close to
a worst case rather than what a real domain controller would give.
