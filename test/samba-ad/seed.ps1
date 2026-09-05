# Seeds the Samba AD test directory with a realistic dataset to query against.
# Run AFTER `docker compose up -d` has finished provisioning (container healthy).
#
#   ./seed.ps1
#
# Re-runnable: it deletes the sample objects first, then recreates them.
# AD can't be bootstrapped from LDIF the way OpenLDAP can, so we drive
# samba-tool (and ldbmodify over LDAP for attributes samba-tool can't set).

$ErrorActionPreference = "Continue"
$C = "adquery-samba"
$BASE = "DC=adquery,DC=test"
$PW = "Passw0rd!"

function St { docker exec $C samba-tool @args 2>&1 | Out-String }

# ---- Users: username, given, surname, title, dept, phone, office, OU --------
$users = @(
  @{u='jdoe';    gn='Jane';   sn='Doe';      title='Account Executive';     dept='Sales';       ph='+1-202-555-0101'; off='HQ-2'; ou='OU=Sales,OU=People'},
  @{u='bsmith';  gn='Bob';    sn='Smith';    title='Sales Manager';         dept='Sales';       ph='+1-202-555-0102'; off='HQ-2'; ou='OU=Sales,OU=People'},
  @{u='agarcia'; gn='Ana';    sn='Garcia';   title='Account Executive';     dept='Sales';       ph='+1-202-555-0103'; off='HQ-2'; ou='OU=Sales,OU=People'},
  @{u='twong';   gn='Terry';  sn='Wong';     title='Sales Representative';  dept='Sales';       ph='+1-202-555-0104'; off='HQ-2'; ou='OU=Sales,OU=People'},
  @{u='ckent';   gn='Clark';  sn='Kent';     title='Systems Administrator'; dept='IT';          ph='+1-202-555-0111'; off='HQ-3'; ou='OU=IT,OU=People'},
  @{u='pparker'; gn='Peter';  sn='Parker';   title='Junior Sysadmin';       dept='IT';          ph='+1-202-555-0112'; off='HQ-3'; ou='OU=IT,OU=People'},
  @{u='bwayne';  gn='Bruce';  sn='Wayne';    title='IT Director';           dept='IT';          ph='+1-202-555-0110'; off='HQ-3'; ou='OU=IT,OU=People'},
  @{u='lsong';   gn='Li';     sn='Song';     title='Software Engineer';     dept='Engineering'; ph='+1-202-555-0121'; off='HQ-4'; ou='OU=Engineering,OU=People'},
  @{u='mpatel';  gn='Maya';   sn='Patel';    title='Senior Engineer';       dept='Engineering'; ph='+1-202-555-0122'; off='HQ-4'; ou='OU=Engineering,OU=People'},
  @{u='rkhan';   gn='Rao';    sn='Khan';     title='Software Engineer';     dept='Engineering'; ph='+1-202-555-0123'; off='HQ-4'; ou='OU=Engineering,OU=People'},
  @{u='jlee';    gn='Jin';    sn='Lee';      title='Engineering Manager';   dept='Engineering'; ph='+1-202-555-0120'; off='HQ-4'; ou='OU=Engineering,OU=People'},
  @{u='dscott';  gn='Dana';   sn='Scott';    title='Accountant';            dept='Finance';     ph='+1-202-555-0131'; off='HQ-5'; ou='OU=Finance,OU=People'},
  @{u='mfox';    gn='Max';    sn='Fox';      title='Finance Manager';       dept='Finance';     ph='+1-202-555-0130'; off='HQ-5'; ou='OU=Finance,OU=People'},
  @{u='ngreen';  gn='Nina';   sn='Green';    title='HR Specialist';         dept='HR';          ph='+1-202-555-0141'; off='HQ-1'; ou='OU=HR,OU=People'},
  @{u='oroyer';  gn='Omar';   sn='Royer';    title='HR Manager';            dept='HR';          ph='+1-202-555-0140'; off='HQ-1'; ou='OU=HR,OU=People'},
  @{u='oldemp';  gn='Olivia'; sn='Past';     title='Former Employee';       dept='Sales';       ph='';                off='';     ou='OU=Disabled,OU=People'},
  @{u='contractor'; gn='Cody'; sn='Temp';    title='Contractor';            dept='Engineering'; ph='';                off='';     ou='OU=Disabled,OU=People'},
  @{u='svc-backup';  gn='';   sn='Service';  title='Service Account';       dept='IT';          ph='';                off='';     ou='OU=Service Accounts,OU=People'},
  @{u='svc-sql';     gn='';   sn='Service';  title='Service Account';       dept='IT';          ph='';                off='';     ou='OU=Service Accounts,OU=People'},
  @{u='svc-monitor'; gn='';   sn='Service';  title='Service Account';       dept='IT';          ph='';                off='';     ou='OU=Service Accounts,OU=People'}
)

Write-Output "== Removing prior sample objects =="
foreach ($x in $users) { St user delete $x.u | Out-Null }
foreach ($g in 'Sales Team','IT Team','Engineering Team','Finance Team','HR Team','All Staff','VPN Users') { St group delete $g | Out-Null }

Write-Output "== Organizational units =="
foreach ($ou in 'OU=People','OU=Sales,OU=People','OU=IT,OU=People','OU=Engineering,OU=People','OU=Finance,OU=People','OU=HR,OU=People','OU=Disabled,OU=People','OU=Service Accounts,OU=People','OU=Workstations','OU=Servers') {
  St ou create "$ou,$BASE" | Out-Null
}

Write-Output "== Users =="
foreach ($x in $users) {
  $a = @('user','create',$x.u,$PW,'--use-username-as-cn',"--surname=$($x.sn)","--department=$($x.dept)",
         "--job-title=$($x.title)","--company=AD Query Inc","--mail-address=$($x.u)@adquery.test","--userou=$($x.ou)")
  if ($x.gn)  { $a += "--given-name=$($x.gn)" }
  if ($x.ph)  { $a += "--telephone-number=$($x.ph)" }
  if ($x.off) { $a += "--physical-delivery-office=$($x.off)" }
  $r = (docker exec $C samba-tool @a 2>&1 | Out-String).Trim()
  Write-Output ("  {0,-12} {1}" -f $x.u, $r)
}

Write-Output "== Disable accounts (-> userAccountControl 514) =="
foreach ($u in 'oldemp','contractor') { St user disable $u | Out-Null; Write-Output "  disabled $u" }

Write-Output "== Groups & membership =="
St group add 'Sales Team'       | Out-Null
St group add 'IT Team'          | Out-Null
St group add 'Engineering Team' | Out-Null
St group add 'Finance Team'     | Out-Null
St group add 'HR Team'          | Out-Null
St group add 'All Staff'        | Out-Null
St group add 'VPN Users'        | Out-Null
St group addmembers 'Sales Team' 'jdoe,bsmith,agarcia,twong'      | Out-Null
St group addmembers 'IT Team' 'ckent,pparker,bwayne'             | Out-Null
St group addmembers 'Engineering Team' 'lsong,mpatel,rkhan,jlee' | Out-Null
St group addmembers 'Finance Team' 'dscott,mfox'                 | Out-Null
St group addmembers 'HR Team' 'ngreen,oroyer'                    | Out-Null
St group addmembers 'VPN Users' 'bwayne,ckent,jlee,mfox'         | Out-Null
# Nested group: All Staff contains every team group.
St group addmembers 'All Staff' 'Sales Team,IT Team,Engineering Team,Finance Team,HR Team' | Out-Null
St group addmembers 'Domain Admins' 'bwayne' | Out-Null
Write-Output "  groups created and populated"

Write-Output "== Computers =="
# ($comp, not $c: PowerShell variables are case-insensitive and $C is the container.)
foreach ($comp in 'WS-SALES-01','WS-IT-01','WS-ENG-01','SRV-FILE-01','SRV-DB-01') {
  St computer create $comp | Out-Null; Write-Output "  $comp"
}

# ---- Attributes samba-tool can't set on create: manager + pwd-never-expires --
# Done via ldbmodify over LDAP (goes through the server, so it's safe). Give the
# directory a moment to settle the freshly-created objects, then verify counts.
Write-Output "== manager links + password-never-expires (via ldbmodify) =="
Start-Sleep -Seconds 2
function Dn($u) { $x = $users | Where-Object { $_.u -eq $u }; "CN=$u,$($x.ou),$BASE" }
# Pipe-to-stdin is unreliable from PowerShell into docker exec, so the LDIF goes
# in as a file and ldbmodify reads it from there.
function LdbMod($ldif) {
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, ($ldif -replace "`r", ""), (New-Object System.Text.UTF8Encoding $false))
  docker cp $tmp.FullName "${C}:/tmp/seed.ldif" | Out-Null
  Remove-Item $tmp.FullName -Force
  (docker exec $C ldbmodify -H ldap://localhost -U "administrator%AdminPass123!" /tmp/seed.ldif 2>&1 | Out-String) -match 'Modified 1'
}

$mgr = @{ jdoe='bsmith'; agarcia='bsmith'; twong='bsmith'; pparker='ckent'; ckent='bwayne';
         lsong='jlee'; mpatel='jlee'; rkhan='jlee'; dscott='mfox'; ngreen='oroyer' }
$ok = 0
foreach ($u in $mgr.Keys) {
  if (LdbMod "dn: $(Dn $u)`nchangetype: modify`nreplace: manager`nmanager: $(Dn $mgr[$u])`n") { $ok++ }
}
Write-Output "  manager links: $ok / $($mgr.Count)"

# Service accounts: password never expires (DONT_EXPIRE_PASSWORD) via samba-tool.
$uac = 0
foreach ($u in 'svc-backup','svc-sql','svc-monitor') {
  $r = St user setexpiry $u --noexpiry
  if ($r -match 'Expiry for user' -or $r -match 'never') { $uac++ }
}
Write-Output "  password-never-expires service accounts: $uac / 3"

Write-Output "`n== Done. Counts: =="
$nu = @((docker exec $C samba-tool user list 2>&1 | Out-String) -split "`n" | Where-Object { $_.Trim() }).Count
$ng = @((docker exec $C samba-tool computer list 2>&1 | Out-String) -split "`n" | Where-Object { $_.Trim() }).Count
Write-Output "  users (incl. built-ins): $nu ; computers: $ng"
