# Grows the Samba AD test directory to the size of a real enterprise so the
# Group Policy work can be timed rather than guessed at: roughly 23,000 user
# accounts, 25,000 computer accounts, 800-odd organizational units, 450
# policies linked across the tree, and security groups doing the filtering.
#
#   ./seed-enterprise.ps1              build it (takes 25-40 minutes)
#   ./seed-enterprise.ps1 -Remove      take it out again
#
# Everything goes in through ldbadd from generated LDIF, which is the fastest
# way in: the directory accepts about 34 records a second no matter how many
# writers push at it, because the database takes one write lock.
#
# The accounts are created disabled and without passwords. A policy trace
# reads the tree, the group memberships and the security descriptors, none of
# which care whether an account can sign in.
param(
  [switch]$Remove,
  [int]$Users = 23000,
  [int]$Computers = 25000,
  [int]$Policies = 450,
  [int]$Groups = 120,
  [int]$Regions = 8,
  [int]$SitesPerRegion = 12,
  [int]$DeptsPerSite = 3
)

$ErrorActionPreference = "Continue"
$C = "adquery-samba"
$BASE = "DC=adquery,DC=test"
$CORP = "OU=Corp,$BASE"
$PolDN = "CN=Policies,CN=System,$BASE"
$U = @("-U", "administrator%AdminPass123!")
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Output ("[{0,6:n0}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) }

# Push an LDIF file into the directory and report what it did.
function Add-Ldif($text, $label) {
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, ($text -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
  $mb = [math]::Round((Get-Item $tmp.FullName).Length / 1MB, 1)
  docker cp $tmp.FullName "${C}:/tmp/ent.ldif" | Out-Null
  Remove-Item $tmp.FullName -Force
  Say "$label ($mb MB) going in..."
  $r = docker exec $C ldbadd -H ldap://localhost @U /tmp/ent.ldif 2>&1 | Out-String
  if ($r -match 'Added (\d+) records') { Say "  $label added $($Matches[1]) records" }
  else { Say "  $label FAILED: $(($r -split "`n" | Select-Object -First 4) -join ' | ')" }
}

# ---------------------------------------------------------------- removal --
Say "removing any earlier enterprise tree"
docker exec $C ldbdel -H ldap://localhost @U -r $CORP 2>&1 | Select-String -Pattern "Deleted|No such" | ForEach-Object { Say "  $_" }
docker exec $C ldbdel -H ldap://localhost @U -r "OU=Groups,$BASE" 2>&1 | Select-String -Pattern "Deleted|No such" | ForEach-Object { Say "  $_" }
# The policies this script made are the ones whose display name ends in a number.
$doomed = @()
$dn = $null
foreach ($line in ((docker exec $C ldbsearch -H ldap://localhost @U -b $PolDN -s one "(objectClass=groupPolicyContainer)" dn displayName 2>$null) -split "`n")) {
  if ($line -match '^dn:\s*(.+)$') { $dn = $Matches[1].Trim() }
  elseif ($line -match '^displayName:\s*(.+)$' -and $dn) {
    if ($Matches[1] -match '\s\d{3}\s*$') { $doomed += $dn }
    $dn = $null
  }
}
if ($doomed.Count -gt 0) {
  Say "  deleting $($doomed.Count) generated policies"
  $del = ($doomed | ForEach-Object { "dn: $_`nchangetype: delete`n" }) -join "`n"
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, ($del -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
  docker cp $tmp.FullName "${C}:/tmp/del.ldif" | Out-Null
  Remove-Item $tmp.FullName -Force
  docker exec $C ldbmodify -H ldap://localhost @U /tmp/del.ldif 2>&1 | Select-String -Pattern "Modified|ERR" | ForEach-Object { Say "  $_" }
}
if ($Remove) { Say "Removed."; exit 0 }

# ------------------------------------------------------------ the shape ----
# Names are picked from short lists and repeated with a number, which is what
# a real estate looks like: a few hundred near-identical branches.
$regionNames = 'EMEA', 'Americas', 'APAC', 'Nordics', 'DACH', 'UKI', 'LATAM', 'MEA'
$deptNames = 'Sales', 'Engineering', 'Finance', 'Operations', 'Support', 'Marketing', 'Legal', 'HR', 'Procurement'
$serverRoles = 'File', 'Database', 'Application', 'Web', 'Print', 'Terminal', 'Backup', 'Mail', 'Monitoring', 'Directory'
$serverTiers = 'Production', 'Test', 'Development'
$wsTypes = 'Desktops', 'Laptops'
$first = 'Ana', 'Ben', 'Chloe', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jia', 'Kai', 'Lea', 'Max', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara'
$last = 'Adams', 'Bauer', 'Costa', 'Dubois', 'Evans', 'Fischer', 'Garcia', 'Haas', 'Ito', 'Jensen', 'Klein', 'Lopez', 'Mori', 'Novak', 'Olsen', 'Perez', 'Quinlan', 'Rossi', 'Silva', 'Tan'
$titles = 'Analyst', 'Manager', 'Engineer', 'Specialist', 'Coordinator', 'Lead', 'Director', 'Administrator'
$polPrefix = 'Workstation Baseline', 'Server Hardening', 'Drive Mapping', 'Printer Deployment', 'Software Restriction', 'Power Management', 'Certificate Autoenrolment', 'Proxy Settings', 'Firewall Profile', 'Audit Policy', 'Screen Lock', 'Update Ring', 'Application Control', 'Folder Redirection', 'Remote Access'
$groupPrefix = 'Role', 'App', 'Access', 'Deploy', 'Filter'

# Policy GUIDs are made up front so an OU can carry a gPLink to a policy that
# has not been written yet: the directory stores gPLink as text and never
# checks it, exactly as it does in production.
Say "planning $Policies policies"
$pol = @()
for ($i = 0; $i -lt $Policies; $i++) {
  $pol += [pscustomobject]@{
    GUID     = "{$(([guid]::NewGuid()).ToString().ToUpper())}"
    Name     = "{0} {1:d3}" -f $polPrefix[$i % $polPrefix.Count], ($i + 1)
    Filtered = ($i % 7 -eq 3)   # applies only to one group
    Denied   = ($i % 29 -eq 5)  # denied to one group
    UserOff  = ($i % 13 -eq 2)  # user half switched off
    CompOff  = ($i % 17 -eq 4)  # computer half switched off
    Wmi      = ($i % 23 -eq 7)
  }
}
$script:link = 0
function NextPolicy { $script:link++; return $pol[($script:link * 7) % $pol.Count] }
# gPLink is one string of [LDAP://<dn>;<options>] entries, last listed wins.
function GpLink($policies, $enforced, $disabled) {
  $s = ""
  for ($k = 0; $k -lt $policies.Count; $k++) {
    $o = 0
    if ($disabled -contains $k) { $o = $o -bor 1 }
    if ($enforced -contains $k) { $o = $o -bor 2 }
    $s = "[LDAP://CN=$($policies[$k].GUID),$PolDN;$o]" + $s
  }
  return $s
}

# ------------------------------------------------------- OUs and groups ----
Say "building the organizational unit tree"
$ou = New-Object System.Text.StringBuilder
$deptOUs = New-Object System.Collections.ArrayList
$wsOUs = New-Object System.Collections.ArrayList
$srvOUs = New-Object System.Collections.ArrayList
$script:ouCount = 0
function OU($dn, $name, $gplink, $block) {
  $s = "dn: $dn`nobjectClass: organizationalUnit`nou: $name`n"
  if ($gplink) { $s += "gPLink: $gplink`n" }
  if ($block) { $s += "gPOptions: 1`n" }
  [void]$ou.AppendLine($s)
  $script:ouCount++
}

OU $CORP "Corp" (GpLink @((NextPolicy), (NextPolicy), (NextPolicy)) @(0) @()) $false
OU "OU=Groups,$BASE" "Groups" $null $false
OU "OU=Service Accounts,$CORP" "Service Accounts" (GpLink @((NextPolicy)) @() @()) $false

for ($r = 0; $r -lt $Regions; $r++) {
  $region = $regionNames[$r % $regionNames.Count]
  $rdn = "OU=$region,$CORP"
  OU $rdn $region (GpLink @((NextPolicy), (NextPolicy)) @() @(1)) ($r -eq 3)
  for ($s = 1; $s -le $SitesPerRegion; $s++) {
    $site = "{0}-{1:d2}" -f $region, $s
    $sdn = "OU=$site,$rdn"
    $disabledHere = @(); if ($s -eq 1) { $disabledHere = @(0) }
    OU $sdn $site (GpLink @((NextPolicy), (NextPolicy)) $disabledHere @()) ($s -eq 7)
    OU "OU=Users,$sdn" "Users" $null $false
    OU "OU=Workstations,$sdn" "Workstations" (GpLink @((NextPolicy)) @() @()) $false
    for ($d = 0; $d -lt $DeptsPerSite; $d++) {
      $dept = $deptNames[(($r * 3) + $s + $d) % $deptNames.Count]
      $ddn = "OU=$dept,OU=Users,$sdn"
      $l = $null; if ((($s + $d) % 2) -eq 0) { $l = GpLink @((NextPolicy)) @() @() }
      OU $ddn $dept $l $false
      [void]$deptOUs.Add($ddn)
    }
    foreach ($t in $wsTypes) {
      $tdn = "OU=$t,OU=Workstations,$sdn"
      OU $tdn $t (GpLink @((NextPolicy)) @() @()) $false
      [void]$wsOUs.Add($tdn)
    }
  }
}
$svdn = "OU=Servers,$CORP"
OU $svdn "Servers" (GpLink @((NextPolicy), (NextPolicy)) @(0) @()) $false
$ri = 0
foreach ($role in $serverRoles) {
  $rdn2 = "OU=$role,$svdn"
  OU $rdn2 $role (GpLink @((NextPolicy)) @() @()) $false
  foreach ($tier in $serverTiers) {
    $tdn2 = "OU=$tier,$rdn2"
    $l = $null; if ($ri % 2 -eq 0) { $l = GpLink @((NextPolicy)) @() @() }
    OU $tdn2 $tier $l ($tier -eq 'Production' -and $ri -eq 1)
    [void]$srvOUs.Add($tdn2)
    $ri++
  }
}
for ($g = 1; $g -le $Groups; $g++) {
  $gn = "{0}-{1:d3}" -f $groupPrefix[$g % $groupPrefix.Count], $g
  [void]$ou.AppendLine("dn: CN=$gn,OU=Groups,$BASE`nobjectClass: group`nsAMAccountName: $gn`ngroupType: -2147483646`ndescription: seeded for scale testing`n")
}
Say "  $script:ouCount organizational units, $Groups groups, $script:link links planned"
Add-Ldif $ou.ToString() "tree"

# ------------------------------------------------- group SIDs for filters --
Say "reading back the group SIDs"
$gsid = New-Object System.Collections.ArrayList
$out = docker exec $C ldbsearch -H ldap://localhost @U -b "OU=Groups,$BASE" -s one "(objectClass=group)" objectSid 2>$null
foreach ($line in ($out -split "`n")) { if ($line -match '^objectSid:\s*(S-1-[0-9-]+)\s*$') { [void]$gsid.Add($Matches[1]) } }
Say "  $($gsid.Count) group SIDs"

# ------------------------------------------------------------- policies ----
# The descriptor is the stock one a new policy gets. Filtering swaps the
# Apply Group Policy grant from Authenticated Users to one group, or adds a
# deny for one group, which is how filtering is done in practice.
$sdBase = 'D:P(A;CI;CCDCLCSWRPWPDTLOSDRCWDWO;;;DA)(A;CI;CCDCLCSWRPWPDTLOSDRCWDWO;;;EA)(A;CIIO;CCDCLCSWRPWPDTLOSDRCWDWO;;;CO)(A;;CCDCLCSWRPWPDTLOSDRCWDWO;;;DA)(A;CI;CCDCLCSWRPWPDTLOSDRCWDWO;;;SY)(A;CI;LCRPLORC;;;AU)'
$apply = 'edacfd8f-ffb3-11d1-b41d-00a0c968f939'
Say "writing $Policies policy objects"
$pb = New-Object System.Text.StringBuilder
for ($i = 0; $i -lt $pol.Count; $i++) {
  $p = $pol[$i]
  $sd = $sdBase
  if ($p.Filtered -and $gsid.Count -gt 0) { $sd += "(OA;CI;CR;$apply;;$($gsid[$i % $gsid.Count]))" }
  else { $sd += "(OA;CI;CR;$apply;;AU)" }
  if ($p.Denied -and $gsid.Count -gt 0) { $sd += "(OD;CI;CR;$apply;;$($gsid[($i * 3) % $gsid.Count]))" }
  $flags = 0
  if ($p.UserOff) { $flags = $flags -bor 1 }
  if ($p.CompOff) { $flags = $flags -bor 2 }
  $s = "dn: CN=$($p.GUID),$PolDN`nobjectClass: groupPolicyContainer`ndisplayName: $($p.Name)`ngPCFileSysPath: \\adquery.test\SysVol\adquery.test\Policies\$($p.GUID)`ngPCFunctionalityVersion: 2`nflags: $flags`nversionNumber: $((($i * 131) % 400) + 1)`nnTSecurityDescriptor: $sd`n"
  if ($p.Wmi) { $s += "gPCWQLFilter: [adquery.test;{$(([guid]::NewGuid()).ToString().ToUpper())};0]`n" }
  [void]$pb.AppendLine($s)
}
Add-Ldif $pb.ToString() "policies"

# ---------------------------------------------------------------- people ---
Say "writing $Users user accounts across $($deptOUs.Count) departments"
$ub = New-Object System.Text.StringBuilder
for ($i = 1; $i -le $Users; $i++) {
  $dn = $deptOUs[$i % $deptOUs.Count]
  $sam = "e{0:d5}" -f $i
  $gn = $first[$i % $first.Count]; $sn = $last[($i * 7) % $last.Count]
  $ti = $titles[($i * 3) % $titles.Count]
  $dept = ($dn -split ',')[0].Substring(3)
  $site = ($dn -split ',')[2].Substring(3)
  [void]$ub.AppendLine("dn: CN=$sam,$dn`nobjectClass: user`nsAMAccountName: $sam`ngivenName: $gn`nsn: $sn`ndisplayName: $gn $sn`nuserPrincipalName: $sam@adquery.test`nmail: $sam@adquery.test`ndepartment: $dept`ntitle: $ti`nphysicalDeliveryOfficeName: $site`nuserAccountControl: 514`n")
}
Add-Ldif $ub.ToString() "users"

# ------------------------------------------------------------- machines ----
$servers = [int]($Computers * 0.12)
$workstations = $Computers - $servers
Say "writing $workstations workstations and $servers servers"
$cb = New-Object System.Text.StringBuilder
for ($i = 1; $i -le $workstations; $i++) {
  $dn = $wsOUs[$i % $wsOUs.Count]
  $type = ($dn -split ',')[0].Substring(3)
  $tag = 'WS'; if ($type -eq 'Laptops') { $tag = 'LT' }
  $n = "{0}-{1:d5}" -f $tag, $i
  [void]$cb.AppendLine("dn: CN=$n,$dn`nobjectClass: computer`nsAMAccountName: $n`$`ndNSHostName: $($n.ToLower()).adquery.test`noperatingSystem: Windows 11 Enterprise`noperatingSystemVersion: 10.0 (26100)`nuserAccountControl: 4098`n")
}
for ($i = 1; $i -le $servers; $i++) {
  $dn = $srvOUs[$i % $srvOUs.Count]
  $n = "SRV-{0:d5}" -f $i
  [void]$cb.AppendLine("dn: CN=$n,$dn`nobjectClass: computer`nsAMAccountName: $n`$`ndNSHostName: $($n.ToLower()).adquery.test`noperatingSystem: Windows Server 2025 Standard`noperatingSystemVersion: 10.0 (26100)`nuserAccountControl: 4098`n")
}
Add-Ldif $cb.ToString() "computers"

# ---------------------------------------------------------- memberships ----
# Filtering only means something if the accounts are in the groups the
# policies name, so every group gets a slice of the population.
Say "putting people into groups"
$mb = New-Object System.Text.StringBuilder
$per = [math]::Max(20, [int]($Users / [math]::Max(1, $Groups) / 2))
for ($g = 1; $g -le $Groups; $g++) {
  $gn = "{0}-{1:d3}" -f $groupPrefix[$g % $groupPrefix.Count], $g
  [void]$mb.AppendLine("dn: CN=$gn,OU=Groups,$BASE")
  [void]$mb.AppendLine("changetype: modify")
  [void]$mb.AppendLine("add: member")
  for ($k = 0; $k -lt $per; $k++) {
    $i = ((($g - 1) * $per + $k * 3) % $Users) + 1
    $sam = "e{0:d5}" -f $i
    [void]$mb.AppendLine("member: CN=$sam,$($deptOUs[$i % $deptOUs.Count])")
  }
  [void]$mb.AppendLine("-")
  [void]$mb.AppendLine("")
}
$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp.FullName, ($mb.ToString() -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
docker cp $tmp.FullName "${C}:/tmp/members.ldif" | Out-Null
Remove-Item $tmp.FullName -Force
Say "  $Groups groups x $per members"
$r = docker exec $C ldbmodify -H ldap://localhost @U /tmp/members.ldif 2>&1 | Out-String
if ($r -match 'Modified (\d+) records') { Say "  $($Matches[1]) groups filled" } else { Say "  ldbmodify: $(($r -split "`n" | Select-Object -First 3) -join ' | ')" }

# ------------------------------------------------------------------ done ---
$total = (docker exec $C ldbsearch -H ldap://localhost @U -b $BASE -s sub "(objectClass=*)" dn 2>$null | Select-String "^dn:").Count
Say "Done. The directory holds $total objects."
