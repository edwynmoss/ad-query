// Regenerate the screenshot gallery in docs/screenshots/.
//
//   npm run shots        (builds, serves dist via vite preview, drives Playwright)
//
// Runs fully offline: a mock `window.go` (the Wails bindings) is injected before
// the app loads, so no directory/back-end is required. Captures the first page,
// the opening sheet, a query with its where line, column facts, a row in full,
// export, the four registers and 365 sign-in, in light and dark.
import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const PORT = 4999;
const OUT = path.resolve(process.cwd(), "../../docs/screenshots");
const TMP = path.resolve(process.cwd(), "node_modules/.cache/adquery-shots");

// ---- Mock backend (injected as window.go before the SPA boots) -------------
const MOCK = `
(() => {
  const recentFt = String((BigInt(Date.now() - 5*86400000) + 11644473600000n) * 10000n);
  const oldFt = '133516992000000000';
  const D = ['Sales','IT','Engineering','Finance','HR'];
  const T = ['Account Executive','Systems Administrator','Software Engineer','Accountant','HR Specialist','IT Director'];
  window.go = { main: { App: {
    DetectDomain: () => Promise.resolve({ joined:true, domain:'corp.example.com', server:'corp.example.com', user:'alice@corp.example.com' }),
    Connect: () => Promise.resolve({ defaultNamingContext:'DC=adquery,DC=test', namingContexts:['DC=adquery,DC=test'], supportedControls:[], supportedSASLMechanisms:[], vendorName:'', vendorVersion:'', isActiveDirectory:true }),
    Disconnect: () => Promise.resolve(), ServerInfo: () => Promise.resolve({}),
    SchemaAttributes: () => Promise.resolve(['displayName','sAMAccountName','mail','department','title','manager','userPrincipalName','userAccountControl','lastLogonTimestamp']),
    GetACL: () => Promise.resolve({ owner:'Domain Admins', group:'Domain Users', dacl:[
      {type:'Allow',allow:true,flags:0,mask:983551,rights:['Generic all'],sid:'S-1-5-32-544',trustee:'Administrators',objectType:''},
      {type:'Deny',allow:false,flags:0,mask:131072,rights:['Read control'],sid:'S-1-5-11',trustee:'Authenticated Users',objectType:''},
      {type:'Allow (object)',allow:true,flags:0,mask:256,rights:['Reset password'],sid:'S-1-5-21-x',trustee:'Help Desk',objectType:'00299570-246d-11d0-a768-00aa006e0529'}
    ]}),
    AccurateLastLogon: () => Promise.resolve({ dn:'CN=User2,OU=Engineering,OU=People,DC=adquery,DC=test', accurateLastLogon:recentFt, sourceDC:'DC02.corp.example.com', lastLogonTimestamp:oldFt, queriedDCs:4, reachedDCs:4, confidence:'High', note:'Queried all 4 domain controllers.', perDC:[{dc:'DC01',reachable:true,lastLogon:oldFt},{dc:'DC02',reachable:true,lastLogon:recentFt},{dc:'DC03',reachable:true,lastLogon:'0'},{dc:'DC04',reachable:true,lastLogon:oldFt}] }),
    M365SignedIn: () => Promise.resolve(true),
    M365Account: () => Promise.resolve('alice@corp.example.com'),
    M365SignInInteractive: () => new Promise(() => {}), // never resolves (simulates browser wait)
    M365StartSignIn: () => Promise.resolve({ device_code:'DC', user_code:'F7K2-9QLM', verification_uri:'https://microsoft.com/devicelogin', expires_in:900, interval:5, message:'' }),
    M365PollSignIn: () => Promise.resolve(false),
    M365SignOut: () => Promise.resolve(),
    M365LicenseReport: () => Promise.resolve([
      {product:'Microsoft 365 E3', skuPartNumber:'SPE_E3', purchased:250, assigned:231, available:19},
      {product:'Microsoft 365 E5', skuPartNumber:'SPE_E5', purchased:50, assigned:44, available:6},
      {product:'Power BI Pro', skuPartNumber:'POWER_BI_PRO', purchased:40, assigned:40, available:0},
      {product:'Exchange Online (Plan 1)', skuPartNumber:'EXCHANGESTANDARD', purchased:30, assigned:35, available:-5},
    ]),
    M365Check: (ids) => Promise.resolve((ids||[]).map((id,i) => ({ identity:id, exists:true, enabled:true, displayName:id, upn:id, licenses: i%3===0?['Microsoft 365 E5']:(i%2===0?['Microsoft 365 E3']:[]), lastSignIn: i%4===0?'2026-06-01T09:00:00Z':'', error:'' }))),
    StoreSecret: () => Promise.resolve(), GetSecret: () => Promise.resolve(''), HasSecret: () => Promise.resolve(false), DeleteSecret: () => Promise.resolve(),
    // Newer App methods the shell calls; the mock answers like a fresh, current install.
    SearchCached: (req) => window.go.main.App.Search(req).then((result) => ({ result, fetchedAt: Math.floor(Date.now()/1000), fromCache: false })),
    ClearCache: () => Promise.resolve(),
    PolicyChain: (dn) => {
      const pol = (name, extra) => Object.assign({ dn:'CN={'+name+'},CN=Policies,CN=System,DC=adquery,DC=test', guid:'{'+name.replace(/\s+/g,'-').toUpperCase()+'}', name, version:3, path:'', userDisabled:false, computerDisabled:false, wmiFilter:'', applyAllow:['S-1-5-11'], applyDeny:[], aclKnown:true }, extra||{});
      const ou = (dn.match(/OU=([^,]+)/)||[])[1] || 'People';
      const path = [
        { dn:'CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=adquery,DC=test', kind:'site', name:'Default-First-Site-Name', links:[], blockInheritance:false },
        { dn:'DC=adquery,DC=test', kind:'domain', name:'adquery.test', links:[], blockInheritance:false },
        { dn:'OU=People,DC=adquery,DC=test', kind:'ou', name:'People', links:[], blockInheritance:false },
        { dn:'OU='+ou+',OU=People,DC=adquery,DC=test', kind:'ou', name:ou, links:[], blockInheritance:false },
      ];
      const entries = [
        { precedence:1, policy:pol('Corporate Baseline'), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:true, verdict:'applies', reason:'', wmiUnknown:false },
        { precedence:2, policy:pol(ou+' Drive Maps'), somDN:path[3].dn, somKind:'ou', somName:ou, enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
        { precedence:3, policy:pol('People Screensaver', { computerDisabled:true }), somDN:path[2].dn, somKind:'ou', somName:'People', enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
        { precedence:4, policy:pol('Default Domain Policy'), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
        { precedence:5, policy:pol('Site Time Sync', { wmiFilter:'[adquery.test;{1};0]' }), somDN:path[0].dn, somKind:'site', somName:'Default-First-Site-Name', enforced:false, verdict:'applies', reason:'Has a WMI filter, which only the client can evaluate.', wmiUnknown:true },
        { precedence:0, policy:pol('VPN Client Settings', { applyDeny:['S-1-5-21-1-1-1-1204'] }), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:false, verdict:'denied', reason:'Apply Group Policy is denied to S-1-5-21-1-1-1-1204.', wmiUnknown:false },
        { precedence:0, policy:pol(ou+' Printers'), somDN:path[3].dn, somKind:'ou', somName:ou, enforced:false, verdict:'link-disabled', reason:'The link is disabled on '+ou+'.', wmiUnknown:false },
      ];
      return Promise.resolve({ targetDN:dn, targetKind:'user', path, entries, notes:['Read from the directory only: WMI filters are not evaluated, loopback and slow-link processing happen on the client, and the settings inside each policy live in SYSVOL.'], names:{ 'S-1-5-21-1-1-1-1204':'Sales Team' } });
    },
    PolicyInventory: () => {
      const pol = (name, extra) => Object.assign({ dn:'CN={'+name+'},CN=Policies,CN=System,DC=adquery,DC=test', guid:'{'+name.replace(/\s+/g,'-').toUpperCase().slice(0,12)+'-0000-0000-0000-000000000000}', name, version:3, path:'', userDisabled:false, computerDisabled:false, wmiFilter:'', applyAllow:['S-1-5-11'], applyDeny:[], aclKnown:true }, extra||{});
      const at = (name, kind, extra) => Object.assign({ somDN:name, somKind:kind, somName:name, enforced:false, disabled:false, order:1 }, extra||{});
      return Promise.resolve({ names:{ 'S-1-5-21-1-1-1-1204':'Sales Team', 'S-1-5-21-1-1-1-1205':'IT Team' }, notes:[], policies:[
        { policy:pol('Corporate Baseline'), links:[at('adquery.test','domain',{enforced:true})] },
        { policy:pol('Default Domain Controllers Policy'), links:[at('Domain Controllers','ou')] },
        { policy:pol('Default Domain Policy'), links:[at('adquery.test','domain')] },
        { policy:pol('Finance Lockdown'), links:[at('Finance','ou')] },
        { policy:pol('IT Admin Tools', { applyAllow:['S-1-5-21-1-1-1-1205'] }), links:[at('IT','ou')] },
        { policy:pol('People Screensaver', { computerDisabled:true }), links:[at('People','ou')] },
        { policy:pol('Sales Drive Maps'), links:[at('Sales','ou')] },
        { policy:pol('Sales Printers'), links:[at('Sales','ou',{disabled:true, order:2})] },
        { policy:pol('Server Config', { userDisabled:true }), links:[at('Servers','ou')] },
        { policy:pol('Site Time Sync'), links:[at('Default-First-Site-Name','site')] },
        { policy:pol('VPN Client Settings', { applyDeny:['S-1-5-21-1-1-1-1204'] }), links:[at('adquery.test','domain')] },
        { policy:pol('Workstation Hardening', { wmiFilter:'[adquery.test;{1};0]' }), links:[at('Workstations','ou')] },
        { policy:pol('Legacy Proxy'), links:[] },
      ] });
    },
    AppVersion: () => Promise.resolve('1.0.0'),
    CheckForUpdate: () => Promise.resolve(null),
    Search: (req) => {
      if (req && req.scope === 0) { // base-scope = the Risk tab fetching one user's posture
        return Promise.resolve({ count:1, truncated:false, entries:[{ dn: req.baseDN, attributes:{ userAccountControl:['66048'], memberOf:['CN=Domain Admins,CN=Users,DC=adquery,DC=test'], lastLogonTimestamp:[oldFt], servicePrincipalName:[], manager:[], department:[] } }] });
      }
      if (req && req.filter && req.filter.indexOf('objectClass=group') >= 0) { // privileged-group lookup
        const g = ['Domain Admins','Backup Operators'].find((n) => req.filter.indexOf(n) >= 0);
        if (!g) return Promise.resolve({ count:0, truncated:false, entries:[] });
        return Promise.resolve({ count:1, truncated:false, entries:[{ dn:'CN=' + g + ',CN=Users,DC=adquery,DC=test', attributes:{ member:['CN=jsmith,OU=IT,DC=adquery,DC=test'] } }] });
      }
      if (req && req.filter && req.filter.indexOf('1.2.840.113556.1.4.1941') >= 0) { // nested members of a group
        if (req.filter.indexOf('CN=Domain Admins') >= 0) return Promise.resolve({ count:1, truncated:false, entries:[{ dn:'CN=jsmith,OU=IT,DC=adquery,DC=test', attributes:{ displayName:['Jane Smith'], sAMAccountName:['jsmith'], userAccountControl:['66048'], lastLogonTimestamp:[recentFt], memberOf:['CN=Domain Admins,CN=Users,DC=adquery,DC=test'] } }] });
        if (req.filter.indexOf('CN=Backup Operators') >= 0) return Promise.resolve({ count:1, truncated:false, entries:[{ dn:'CN=oldadmin,OU=IT,DC=adquery,DC=test', attributes:{ displayName:['Old Admin'], sAMAccountName:['oldadmin'], userAccountControl:['514'], lastLogonTimestamp:[oldFt], memberOf:['CN=Backup Operators,CN=Users,DC=adquery,DC=test'] } }] });
        return Promise.resolve({ count:0, truncated:false, entries:[] });
      }
      if (req && req.filter && req.filter.indexOf('organizationalUnit') >= 0) {
        const ous=[['People','OU=People'],['Sales','OU=Sales,OU=People'],['IT','OU=IT,OU=People'],['Engineering','OU=Engineering,OU=People'],['Finance','OU=Finance,OU=People'],['HR','OU=HR,OU=People']];
        return Promise.resolve({ count:ous.length, truncated:false, entries: ous.map(([ou,dn]) => ({ dn: dn+',DC=adquery,DC=test', attributes:{ ou:[ou] } })) });
      }
      const e=[];
      for (let i=0;i<500;i++) e.push({ dn:'CN=User'+i+',OU='+D[i%5]+',OU=People,DC=adquery,DC=test', attributes:{ displayName:['User '+i], sAMAccountName:['user'+i], mail:['user'+i+'@adquery.test'], userPrincipalName:['user'+i+'@adquery.test'], department:[D[i%5]], title:[T[i%6]], userAccountControl:[i%9===0?'514':(i%6===0?'66048':'512')], lastLogonTimestamp:[i%3===0?recentFt:(i%4===0?'0':oldFt)] } });
      return Promise.resolve({ count:e.length, truncated:false, entries:e });
    }
  }}};
})();
`;

const url = `http://localhost:${PORT}`;

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(TMP, { recursive: true });
  const csvPath = path.join(TMP, "leavers.csv");
  await writeFile(csvPath, "sAMAccountName,Department\nuser1,Sales\nuser3,IT\nuser7,Engineering\nuser42,Finance\nghost777,HR\nuser88,Sales\n");

  const server = await preview({ preview: { port: PORT, strictPort: true } });
  const browser = await chromium.launch();
  const shots = [];

  async function session(theme, extraInit, run) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 800 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(`${MOCK}\ntry { localStorage.clear(); localStorage.setItem('adquery.theme','${theme}'); } catch (e) {}\n${extraInit ?? ""}`);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await run(page);
    await ctx.close();
  }

  const shot = async (page, name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, name + ".png"), animations: "disabled" });
    shots.push(name + ".png");
    console.log("  ✓", name);
  };
  const connect = async (page) => {
    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    await page.getByPlaceholder("Who are you looking for?").waitFor();
  };
  // Users, where department is Sales, run.
  const compose = async (page) => {
    await page.locator(".ledger-hint").getByRole("button", { name: "type" }).click();
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: /add a condition/ }).click();
    await page.getByRole("button", { name: /add condition/i }).click();
    await page.getByRole("button", { name: /Field…/ }).last().click();
    await page.getByPlaceholder("Search fields…").fill("department");
    await page.getByRole("button", { name: /^Department/ }).first().click();
    await page.getByPlaceholder("value").last().fill("Sales");
    await page.keyboard.press("Escape");
    await page.locator(".ledger-foot").click();
    await page.getByRole("button", { name: /department is Sales/ }).waitFor();
    await page.getByRole("tab", { name: "Conditions" }).waitFor({ state: "hidden" });
  };
  const run = async (page) => {
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator(".ledger-meta b").waitFor();
  };

  // --- Light: the journey -----------------------------------------------------
  await session("light", "", async (page) => {
    await page.getByRole("heading", { name: "Open a directory" }).waitFor();
    await shot(page, "01-connect");

    await connect(page);
    await shot(page, "02-opening");

    await compose(page);
    await shot(page, "03-heading");

    await run(page);
    await shot(page, "04-ledger");

    await page.locator(".ledger-facts-title").selectOption({ label: "Department" });
    await page.locator(".ledger-leader").first().waitFor();
    await shot(page, "05-facts");

    await page.getByText("User 2", { exact: true }).click();
    await page.locator(".ledger-record-dn").waitFor();
    await shot(page, "06-row");
    await page.getByRole("tab", { name: "Login" }).click();
    await page.getByRole("button", { name: "Ask them all" }).click();
    await page.getByText(/confidence/).waitFor();
    await shot(page, "07-login");
    await page.getByRole("tab", { name: "Risk" }).click();
    await page.getByText(/Overall/).waitFor();
    await shot(page, "08-risk");
    await page.locator(".ledger-record-switch").getByRole("tab", { name: "Policies" }).click();
    await page.getByText("Applies, in order of precedence").waitFor();
    await shot(page, "17-row-policies");
    await page.getByRole("tab", { name: "Security" }).click();
    await page.getByRole("button", { name: "Read it" }).click();
    await page.getByText(/Access control/).waitFor();
    await shot(page, "09-security");

    await page.getByRole("button", { name: "Export CSV" }).click();
    await page.getByText("Export to CSV").waitFor();
    await shot(page, "10-export");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("tab", { name: "Stale accounts" }).click();
    await page.getByRole("heading", { name: "Stale accounts" }).waitFor();
    await shot(page, "11-stale");

    await page.getByRole("tab", { name: "Privileged access" }).click();
    await page.locator(".ledger-table").waitFor();
    await shot(page, "12-privileged");

    await page.getByRole("tab", { name: "Licences" }).click();
    await page.locator(".ledger-table").waitFor();
    await shot(page, "13-licences");

    await page.locator(".ledger-tabs").getByRole("tab", { name: "Policies" }).click();
    await page.locator(".ledger-table").waitFor();
    await shot(page, "18-policies");

    await page.getByRole("tab", { name: "Bulk lookup" }).click();
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await page.getByRole("button", { name: /Look up 6/ }).click();
    await page.getByText(/Needs attention/).waitFor();
    await shot(page, "14-bulk");
  });

  // --- 365 device-code sign-in (signed out) -----------------------------------
  await session("light",
    `localStorage.setItem('adquery.m365.tenant','contoso.onmicrosoft.com');
     localStorage.setItem('adquery.m365.client','11111111-2222-3333-4444-555555555555');
     window.go.main.App.M365SignedIn = () => Promise.resolve(false);`,
    async (page) => {
      await connect(page);
      await page.getByRole("button", { name: "Connect 365" }).click();
      await page.getByRole("button", { name: /Sign in with a code/ }).click();
      await page.getByText("F7K2-9QLM").waitFor();
      await shot(page, "15-m365-signin");
    });

  // --- Dark ledger -------------------------------------------------------------
  await session("dark", "", async (page) => {
    await connect(page);
    await compose(page);
    await run(page);
    await page.getByText("User 2", { exact: true }).click();
    await page.locator(".ledger-record-dn").waitFor();
    await shot(page, "16-ledger-dark");
  });

  await browser.close();
  await server.httpServer.close();
  await rm(TMP, { recursive: true, force: true });
  console.log(`\nWrote ${shots.length} screenshots to docs/screenshots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
