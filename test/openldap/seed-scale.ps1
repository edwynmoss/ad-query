# Grows the OpenLDAP test directory to the same size as the Samba one, so the
# plain-LDAP side of the app can be timed at the scale of a real estate:
# roughly 23,000 people and 25,000 devices under an 800-branch tree.
#
#   ./seed-scale.ps1              build it
#   ./seed-scale.ps1 -Remove      take it out again
#
# Group Policy is deliberately absent. There is no gPLink, no gPOptions and
# no groupPolicyContainer in a plain LDAP schema, and the app knows it: the
# Policies register steps aside on a directory that is not Active Directory.
# What this proves is the rest of it, the searching and the browsing, at size.
#
# The integration tests in app/backend/ldap count the seven people in the base
# seed, so take this back out before running them. Taking it out one entry at a
# time is slow; the quick way is to rebuild the container, which bootstraps
# from ./seed again:
#
#   docker compose down -v; docker compose up -d
param([switch]$Remove, [int]$Users = 23000, [int]$Devices = 25000, [int]$Regions = 8, [int]$SitesPerRegion = 12, [int]$DeptsPerSite = 3)

$ErrorActionPreference = "Continue"
$C = "adquery-openldap"
$BASE = "dc=adquery,dc=test"
$CORP = "ou=Corp,$BASE"
$BIND = @("-x", "-D", "cn=admin,$BASE", "-w", "AdminPass123!", "-H", "ldap://localhost")
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Output ("[{0,6:n0}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) }

# The bind arguments as one shell-safe string, for the places that need a
# shell (a pipeline) rather than a plain argument list.
$SH = "-x -D 'cn=admin,$BASE' -w 'AdminPass123!' -H ldap://localhost"

if ($Remove) {
  Say "removing the Corp tree"
  docker exec $C bash -lc "ldapsearch $SH -b '$CORP' -s sub dn 2>/dev/null | grep '^dn:' | sed 's/^dn: //' | tac > /tmp/kill.txt; echo `"`$(wc -l < /tmp/kill.txt) entries`"; while read d; do ldapdelete $SH `"`$d`" >/dev/null 2>&1; done < /tmp/kill.txt" 2>&1 | ForEach-Object { Say "  $_" }
  Say "Removed."
  exit 0
}

$regionNames = 'EMEA', 'Americas', 'APAC', 'Nordics', 'DACH', 'UKI', 'LATAM', 'MEA'
$deptNames = 'Sales', 'Engineering', 'Finance', 'Operations', 'Support', 'Marketing', 'Legal', 'HR', 'Procurement'
$first = 'Ana', 'Ben', 'Chloe', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jia', 'Kai', 'Lea', 'Max', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara'
$last = 'Adams', 'Bauer', 'Costa', 'Dubois', 'Evans', 'Fischer', 'Garcia', 'Haas', 'Ito', 'Jensen', 'Klein', 'Lopez', 'Mori', 'Novak', 'Olsen', 'Perez', 'Quinlan', 'Rossi', 'Silva', 'Tan'
$titles = 'Analyst', 'Manager', 'Engineer', 'Specialist', 'Coordinator', 'Lead', 'Director', 'Administrator'

Say "building the tree"
$sb = New-Object System.Text.StringBuilder
$deptOUs = New-Object System.Collections.ArrayList
$devOUs = New-Object System.Collections.ArrayList
$ouCount = 0
function OU($dn, $name) { [void]$sb.AppendLine("dn: $dn`nobjectClass: organizationalUnit`nou: $name`n"); $script:ouCount++ }

OU $CORP "Corp"
for ($r = 0; $r -lt $Regions; $r++) {
  $region = $regionNames[$r % $regionNames.Count]
  $rdn = "ou=$region,$CORP"
  OU $rdn $region
  for ($s = 1; $s -le $SitesPerRegion; $s++) {
    $site = "{0}-{1:d2}" -f $region, $s
    $sdn = "ou=$site,$rdn"
    OU $sdn $site
    OU "ou=People,$sdn" "People"
    OU "ou=Devices,$sdn" "Devices"
    [void]$devOUs.Add("ou=Devices,$sdn")
    for ($d = 0; $d -lt $DeptsPerSite; $d++) {
      $dept = $deptNames[(($r * 3) + $s + $d) % $deptNames.Count]
      $ddn = "ou=$dept,ou=People,$sdn"
      OU $ddn $dept
      [void]$deptOUs.Add($ddn)
    }
  }
}
Say "  $ouCount organizational units"

Say "writing $Users people"
for ($i = 1; $i -le $Users; $i++) {
  $dn = $deptOUs[$i % $deptOUs.Count]
  $uid = "e{0:d5}" -f $i
  $gn = $first[$i % $first.Count]; $sn = $last[($i * 7) % $last.Count]
  $dept = ($dn -split ',')[0].Substring(3)
  [void]$sb.AppendLine("dn: uid=$uid,$dn`nobjectClass: inetOrgPerson`nuid: $uid`ncn: $gn $sn`ngivenName: $gn`nsn: $sn`ndisplayName: $gn $sn`nmail: $uid@adquery.test`ntitle: $($titles[($i * 3) % $titles.Count])`ndepartmentNumber: $dept`nemployeeNumber: $i`n")
}

Say "writing $Devices devices"
for ($i = 1; $i -le $Devices; $i++) {
  $dn = $devOUs[$i % $devOUs.Count]
  $n = "WS-{0:d5}" -f $i
  [void]$sb.AppendLine("dn: cn=$n,$dn`nobjectClass: device`ncn: $n`ndescription: Workstation - Windows 11`nserialNumber: SN-{0:d6}`n" -f $i)
}

$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp.FullName, ($sb.ToString() -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
$mb = [math]::Round((Get-Item $tmp.FullName).Length / 1MB, 1)
docker cp $tmp.FullName "${C}:/tmp/scale.ldif" | Out-Null
Remove-Item $tmp.FullName -Force
Say "pushing $mb MB into the directory"
$r = docker exec $C ldapadd @BIND -c -f /tmp/scale.ldif 2>&1 | Out-String
$bad = ([regex]::Matches($r, 'ldap_add: ')).Count
Say "  done, $bad rejected"
$total = docker exec $C bash -lc "ldapsearch $SH -b '$BASE' -s sub dn 2>/dev/null | grep -c '^dn:'"
Say "Done. The directory holds $total entries."
