# Grows the Samba AD test directory to something closer to a real estate so
# the policy map, the on-demand counts and the ledger are proven at size:
# a Regions tree of 12 regions x 8 offices x 3 teams (roughly 300 OUs), a
# few thousand user accounts spread across them, and a handful of extra
# policies linked deep in the tree. Objects go in through ldbadd from one
# LDIF file, which is fast; the accounts are created disabled and have no
# password, which is all a count or a trace needs.
#
#   ./seed-scale.ps1              (not run by seed.ps1; opt in)
#   ./seed-scale.ps1 -Remove      (take it out again)
#
# Re-runnable: it removes the Regions tree first.
param([switch]$Remove, [int]$Regions = 12, [int]$Offices = 8, [int]$Teams = 3, [int]$UsersPerTeam = 8)

$ErrorActionPreference = "Continue"
$C = "adquery-samba"
$BASE = "DC=adquery,DC=test"
$U = @("-U", "administrator%AdminPass123!")
function St { (docker exec $C samba-tool @args @U 2>&1 | Out-String) -replace "WARNING: Using passwords on command line.*`n", "" }

Write-Output "== removing an earlier Regions tree =="
foreach ($n in 'Regional Baseline', 'EMEA Printers', 'Field Laptops') {
  foreach ($line in (St gpo listall) -split "`n") { if ($line -match '^GPO\s*:\s*(\{[0-9A-Fa-f-]+\})') { $g = $Matches[1] } elseif ($line -match "^display name\s*:\s*$([regex]::Escape($n))\s*$" -and $g) {
    foreach ($c in (St gpo listcontainers $g) -split "`n") { if ($c -match '^\s*DN\s*:\s*(.+)$') { St gpo dellink $Matches[1].Trim() $g | Out-Null } }
    St gpo del $g | Out-Null; Write-Output "  removed policy $n" } }
}
docker exec $C ldbdel -H ldap://localhost -U "administrator%AdminPass123!" -r "OU=Regions,$BASE" 2>&1 | Select-String -Pattern "Deleted|No such" | Out-String | Write-Output
if ($Remove) { Write-Output "Removed."; exit 0 }

Write-Output "== building the Regions tree ($Regions regions x $Offices offices x $Teams teams, $UsersPerTeam users per team) =="
$regionNames = 'EMEA', 'Americas', 'APAC', 'Nordics', 'Iberia', 'DACH', 'Benelux', 'ANZ', 'LATAM', 'MEA', 'UKI', 'Japan'
$teamNames = 'Sales', 'Support', 'Operations'
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("dn: OU=Regions,$BASE`nobjectClass: organizationalUnit`nou: Regions`n")
$ouCount = 1; $userCount = 0
$first = 'Ana', 'Ben', 'Chloe', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jia', 'Kai', 'Lea', 'Max', 'Nia', 'Omar', 'Pia'
$last = 'Adams', 'Bauer', 'Costa', 'Dubois', 'Evans', 'Fischer', 'Garcia', 'Haas', 'Ito', 'Jensen', 'Klein', 'Lopez', 'Mori', 'Novak', 'Olsen', 'Perez'
for ($r = 0; $r -lt $Regions; $r++) {
  $region = $regionNames[$r % $regionNames.Count]; if ($r -ge $regionNames.Count) { $region = "$region$r" }
  $rdn = "OU=$region,OU=Regions,$BASE"
  [void]$sb.AppendLine("dn: $rdn`nobjectClass: organizationalUnit`nou: $region`n"); $ouCount++
  for ($o = 1; $o -le $Offices; $o++) {
    $office = "Office $o"
    $odn = "OU=$office,$rdn"
    [void]$sb.AppendLine("dn: $odn`nobjectClass: organizationalUnit`nou: $office`n"); $ouCount++
    for ($t = 0; $t -lt $Teams; $t++) {
      $team = $teamNames[$t % $teamNames.Count]
      $tdn = "OU=$team,$odn"
      [void]$sb.AppendLine("dn: $tdn`nobjectClass: organizationalUnit`nou: $team`n"); $ouCount++
      for ($i = 0; $i -lt $UsersPerTeam; $i++) {
        $userCount++
        $sam = "u{0:d5}" -f $userCount
        $gn = $first[($userCount + $i) % $first.Count]; $sn = $last[($userCount * 7 + $t) % $last.Count]
        [void]$sb.AppendLine("dn: CN=$sam,$tdn`nobjectClass: user`nsAMAccountName: $sam`ngivenName: $gn`nsn: $sn`ndisplayName: $gn $sn`nuserPrincipalName: $sam@adquery.test`nmail: $sam@adquery.test`ndepartment: $team`nphysicalDeliveryOfficeName: $region $office`nuserAccountControl: 514`n")
      }
    }
  }
}
$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp.FullName, ($sb.ToString() -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
docker cp $tmp.FullName "${C}:/tmp/scale.ldif" | Out-Null
Remove-Item $tmp.FullName -Force
$r = docker exec $C ldbadd -H ldap://localhost -U "administrator%AdminPass123!" /tmp/scale.ldif 2>&1 | Out-String
if ($r -match 'Added (\d+) records') { Write-Output "  added $($Matches[1]) records ($ouCount OUs, $userCount users)" } else { Write-Output "  ldbadd: $($r.Trim())" }

Write-Output "== policies deep in the tree =="
foreach ($p in @(
  @{ n = 'Regional Baseline'; link = "OU=Regions,$BASE"; enforce = $true },
  @{ n = 'EMEA Printers';     link = "OU=EMEA,OU=Regions,$BASE" },
  @{ n = 'Field Laptops';     link = "OU=Sales,OU=Office 1,OU=Americas,OU=Regions,$BASE"; block = $true })) {
  $out = St gpo create $p.n
  if ($out -notmatch "created as (\{[0-9A-Fa-f-]+\})") { Write-Output "  FAILED $($p.n): $out"; continue }
  $guid = $Matches[1]
  $args = @('gpo', 'setlink', $p.link, $guid); if ($p.enforce) { $args += '--enforce' }
  St @args | Out-Null
  if ($p.block) { St gpo setinheritance $p.link block | Out-Null }
  Write-Output ("  {0,-20} {1}  linked at {2}{3}{4}" -f $p.n, $guid, (($p.link -split ',')[0]), ($(if ($p.enforce) { ', enforced' } else { '' })), ($(if ($p.block) { ', inheritance blocked there' } else { '' })))
}
Write-Output "Done."
