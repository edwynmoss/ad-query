# Seeds Group Policy into the Samba AD test directory so the policy chain can
# be exercised: links at site, domain and OU level, an enforced link, a
# disabled link, blocked inheritance, security filtering (allow and deny),
# half-disabled policies, a WMI filter reference and an orphan policy.
#
#   ./seed-gpo.ps1        (seed.ps1 calls this at the end)
#
# Re-runnable: policies with these names are unlinked and deleted first.

$ErrorActionPreference = "Continue"
$C = "adquery-samba"
$BASE = "DC=adquery,DC=test"
$U = @("-U", "administrator%AdminPass123!")
$SITE = "CN=Default-First-Site-Name,CN=Sites,CN=Configuration,$BASE"
$APPLY = "edacfd8f-ffb3-11d1-b41d-00a0c968f939"   # Apply Group Policy extended right

function St { (docker exec $C samba-tool @args @U 2>&1 | Out-String) -replace "WARNING: Using passwords on command line.*`n", "" }
function LdbMod($ldif) {
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, ($ldif -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
  docker cp $tmp.FullName "${C}:/tmp/seed-gpo.ldif" | Out-Null
  Remove-Item $tmp.FullName -Force
  (docker exec $C ldbmodify -H ldap://localhost -U "administrator%AdminPass123!" /tmp/seed-gpo.ldif 2>&1 | Out-String) -match 'Modified 1'
}
function GroupSid($name) { ((St group show $name) -split "`n" | Where-Object { $_ -match '^objectSid: (\S+)' } | ForEach-Object { $Matches[1] }) | Select-Object -First 1 }

# name, where it links, options
$policies = @(
  @{ n = 'Corporate Baseline';     link = $BASE;                              enforce = $true },
  @{ n = 'VPN Client Settings';    link = $BASE;                              denyApply = 'Sales Team' },
  @{ n = 'Site Time Sync';         link = $SITE },
  @{ n = 'People Screensaver';     link = "OU=People,$BASE";                  flags = 2 },      # computer half disabled
  @{ n = 'Sales Drive Maps';       link = "OU=Sales,OU=People,$BASE" },
  @{ n = 'Sales Printers';         link = "OU=Sales,OU=People,$BASE";         disable = $true },
  @{ n = 'IT Admin Tools';         link = "OU=IT,OU=People,$BASE";            onlyApply = 'IT Team' },
  @{ n = 'Finance Lockdown';       link = "OU=Finance,OU=People,$BASE";       block = $true },
  @{ n = 'Workstation Hardening';  link = "OU=Workstations,$BASE";            wmi = '{6B3F7B5C-1111-4A2B-9C3D-000000000001}' },
  @{ n = 'Server Config';          link = "OU=Servers,$BASE";                 flags = 1 },      # user half disabled
  @{ n = 'Legacy Proxy';           link = $null }
)

# ---- Clean up earlier runs -------------------------------------------------
Write-Output "== removing earlier seed policies =="
$existing = @{}
$cur = $null
foreach ($line in (St gpo listall) -split "`n") {
  if ($line -match '^GPO\s*:\s*(\{[0-9A-Fa-f-]+\})') { $cur = $Matches[1] }
  elseif ($line -match '^display name\s*:\s*(.+)$' -and $cur) { $existing[$Matches[1].Trim()] = $cur }
}
foreach ($p in $policies) {
  if (-not $existing.ContainsKey($p.n)) { continue }
  $guid = $existing[$p.n]
  foreach ($line in (St gpo listcontainers $guid) -split "`n") {
    if ($line -match '^\s*DN\s*:\s*(.+)$') { St gpo dellink $Matches[1].Trim() $guid | Out-Null }
  }
  St gpo del $guid | Out-Null
  Write-Output "  removed $($p.n)"
}
St gpo setinheritance "OU=Finance,OU=People,$BASE" inherit | Out-Null

# ---- Create, link, decorate -------------------------------------------------
Write-Output "== policies =="
$made = 0
foreach ($p in $policies) {
  $out = St gpo create $p.n
  if ($out -notmatch "created as (\{[0-9A-Fa-f-]+\})") { Write-Output "  FAILED to create $($p.n): $out"; continue }
  $guid = $Matches[1]
  $dn = "CN=$guid,CN=Policies,CN=System,$BASE"
  $notes = @()

  if ($p.link) {
    $args = @('gpo', 'setlink', $p.link, $guid)
    if ($p.enforce) { $args += '--enforce'; $notes += 'enforced' }
    if ($p.disable) { $args += '--disable'; $notes += 'link disabled' }
    St @args | Out-Null
    $notes += "linked at $(($p.link -split ',')[0])"
  } else { $notes += 'not linked' }

  if ($p.block) { St gpo setinheritance $p.link block | Out-Null; $notes += 'inheritance blocked there' }

  if ($p.n -ne 'Legacy Proxy') {
    if (LdbMod "dn: $dn`nchangetype: modify`nreplace: versionNumber`nversionNumber: 65539`n") { $notes += 'edited' }
  }
  if ($p.flags) {
    if (LdbMod "dn: $dn`nchangetype: modify`nreplace: flags`nflags: $($p.flags)`n") { $notes += "flags=$($p.flags)" }
  }
  if ($p.wmi) {
    if (LdbMod "dn: $dn`nchangetype: modify`nreplace: gPCWQLFilter`ngPCWQLFilter: [adquery.test;$($p.wmi);0]`n") { $notes += 'wmi filter' }
  }
  if ($p.denyApply) {
    $sid = GroupSid $p.denyApply
    St dsacl set --objectdn=$dn "--sddl=(OD;;CR;$APPLY;;$sid)" | Out-Null
    $notes += "apply denied to $($p.denyApply)"
  }
  if ($p.onlyApply) {
    $sid = GroupSid $p.onlyApply
    St dsacl delete --objectdn=$dn "--sddl=(OA;CI;CR;$APPLY;;AU)" | Out-Null
    St dsacl set --objectdn=$dn "--sddl=(OA;CI;CR;$APPLY;;$sid)" | Out-Null
    $notes += "apply only to $($p.onlyApply)"
  }
  $made++
  Write-Output ("  {0,-24} {1}  {2}" -f $p.n, $guid, ($notes -join ', '))
}
Write-Output "  policies created: $made / $($policies.Count)"
