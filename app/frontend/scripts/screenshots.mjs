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
      if (/OU=(Workstations|Servers)/i.test(dn)) { // a computer sits in its own OU
        const ou = dn.match(/OU=(Workstations|Servers)/i)[1];
        const pol = (name, extra) => Object.assign({ dn:'CN={'+name+'},CN=Policies,CN=System,DC=adquery,DC=test', guid:'{'+name+'}', name, version:3, path:'', userDisabled:false, computerDisabled:false, wmiFilter:'', applyAllow:['S-1-5-11'], applyDeny:[], aclKnown:true }, extra||{});
        const path = [
          { dn:'CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=adquery,DC=test', kind:'site', name:'Default-First-Site-Name', links:[], blockInheritance:false },
          { dn:'DC=adquery,DC=test', kind:'domain', name:'adquery.test', links:[], blockInheritance:false },
          { dn:'OU='+ou+',DC=adquery,DC=test', kind:'ou', name:ou, links:[], blockInheritance:false },
        ];
        const entries = [
          { precedence:1, policy:pol('Corporate Baseline'), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:true, verdict:'applies', reason:'', wmiUnknown:false },
          { precedence:2, policy:pol(ou === 'Servers' ? 'Server Config' : 'Workstation Hardening', ou === 'Servers' ? {} : { wmiFilter:'[adquery.test;{1};0]' }), somDN:path[2].dn, somKind:'ou', somName:ou, enforced:false, verdict:'applies', reason: ou === 'Servers' ? '' : 'Has a WMI filter, which only the client can evaluate.', wmiUnknown: ou !== 'Servers' },
          { precedence:3, policy:pol('VPN Client Settings'), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
          { precedence:4, policy:pol('Default Domain Policy'), somDN:path[1].dn, somKind:'domain', somName:'adquery.test', enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
          { precedence:5, policy:pol('Site Time Sync'), somDN:path[0].dn, somKind:'site', somName:'Default-First-Site-Name', enforced:false, verdict:'applies', reason:'', wmiUnknown:false },
        ];
        return Promise.resolve({ targetDN:dn, targetKind:'computer', path, entries, notes:[], names:{}, tokenSIDs:[] });
      }
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
    PolicyChainWith: (dn, changes) => window.go.main.App.PolicyChain(dn).then((c) => { if (changes && changes.length) { const off = new Set(changes.filter((x) => x.kind === 'policy-off' || x.kind === 'unlink' || x.kind === 'delete').map((x) => x.policyDN.toLowerCase())); c.entries = c.entries.map((e) => off.has(e.policy.dn.toLowerCase()) ? Object.assign({}, e, { precedence: 0, verdict: 'half-disabled', reason: '' }) : e); let n = 0; c.entries.filter((e) => e.precedence > 0).sort((a, b) => a.precedence - b.precedence).forEach((e) => { e.precedence = ++n; }); } return c; }),
    ContainerChainWith: (dn, kind, changes) => window.go.main.App.ContainerChain(dn, kind).then((c) => { if (changes && changes.some((x) => x.kind === 'unblock')) { c.path = c.path.map((s) => Object.assign({}, s, { blockInheritance: false })); c.entries = c.entries.map((e) => e.verdict === 'blocked' ? Object.assign({}, e, { verdict: 'applies', reason: '' }) : e); let n = 0; c.entries.filter((e) => e.verdict === 'applies' || e.verdict === 'depends').forEach((e) => { e.precedence = ++n; }); } return c; }),
    WhatIf: (cs) => { const c = cs[0] || {}; return Promise.resolve({ changes: cs, description: 'hypothetical',
      users: c.kind === 'unblock' ? [{ containerDN:'OU=Finance,OU=People,DC=adquery,DC=test', name:'Finance', kind:'ou', loses:[], gains:['People Screensaver','VPN Client Settings','Default Domain Policy','Site Time Sync'], reordered:[], users:80, computers:0, root:true }]
        : [{ containerDN:'OU=Sales,OU=People,DC=adquery,DC=test', name:'Sales', kind:'ou', loses:['Sales Drive Maps'], gains:[], reordered:[], users:150, computers:0, root:true }],
      computers: [], notes: ['Worked out for containers, so links filtered by group membership count as arriving on both sides. Nothing was changed in the directory.'] }); },
    CountUnder: (dn) => Promise.resolve({ dn, users: /Sales/.test(dn) ? 150 : /People/.test(dn) ? 500 : 503, computers: /People|Sales/.test(dn) ? 0 : 7, truncated: false }),
    ContainerChain: (dn, kind) => window.go.main.App.PolicyChain('CN=x,' + dn).then((c) => { c.targetDN = dn; c.targetKind = kind || 'user'; c.path = c.path.filter((s) => dn.toLowerCase().endsWith(s.dn.toLowerCase()) || s.kind === 'site' || s.kind === 'domain'); c.entries = c.entries.filter((e) => c.path.some((s) => s.dn === e.somDN)); c.notes = ['A container trace cannot know group membership, so links with security filtering are marked as depending on it. Open a row for the exact answer.']; return c; }),
    PolicyMap: () => {
      const pol = (name) => ({ dn:'CN={'+name+'},CN=Policies,CN=System,DC=adquery,DC=test', guid:'{'+name+'}', name, version:3, path:'', userDisabled:false, computerDisabled:false, wmiFilter:'', applyAllow:['S-1-5-11'], applyDeny:[], aclKnown:true });
      const names = ['Corporate Baseline','VPN Client Settings','Default Domain Policy','People Screensaver','Sales Drive Maps','Sales Printers','IT Admin Tools','Finance Lockdown','Workstation Hardening','Server Config','Site Time Sync','Legacy Proxy'];
      const policies = {}; for (const n of names) policies[pol(n).dn.toLowerCase()] = pol(n);
      const L = (name, o) => ({ policyDN: pol(name).dn, enforced: !!(o&2), disabled: !!(o&1) });
      const site = 'CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=adquery,DC=test', dom = 'DC=adquery,DC=test', people = 'OU=People,DC=adquery,DC=test';
      const nodes = [
        { dn: site, parentDN:'', kind:'site', name:'Default-First-Site-Name', links:[L('Site Time Sync',0)], blockInheritance:false, users:0, computers:0 },
        { dn: dom, parentDN: site, kind:'domain', name:'adquery.test', links:[L('VPN Client Settings',0), L('Corporate Baseline',2), L('Default Domain Policy',0)], blockInheritance:false, users:3, computers:1 },
        { dn: people, parentDN: dom, kind:'ou', name:'People', links:[L('People Screensaver',0)], blockInheritance:false, users:0, computers:0 },
        { dn: 'OU=Servers,'+dom, parentDN: dom, kind:'ou', name:'Servers', links:[L('Server Config',0)], blockInheritance:false, users:0, computers:2 },
        { dn: 'OU=Workstations,'+dom, parentDN: dom, kind:'ou', name:'Workstations', links:[L('Workstation Hardening',0)], blockInheritance:false, users:0, computers:4 },
        { dn: 'OU=Engineering,'+people, parentDN: people, kind:'ou', name:'Engineering', links:[], blockInheritance:false, users:120, computers:0 },
        { dn: 'OU=Finance,'+people, parentDN: people, kind:'ou', name:'Finance', links:[L('Finance Lockdown',0)], blockInheritance:true, users:80, computers:0 },
        { dn: 'OU=HR,'+people, parentDN: people, kind:'ou', name:'HR', links:[], blockInheritance:false, users:60, computers:0 },
        { dn: 'OU=IT,'+people, parentDN: people, kind:'ou', name:'IT', links:[L('IT Admin Tools',0)], blockInheritance:false, users:90, computers:0 },
        { dn: 'OU=Sales,'+people, parentDN: people, kind:'ou', name:'Sales', links:[L('Sales Printers',1), L('Sales Drive Maps',0)], blockInheritance:false, users:150, computers:0 },
      ];
      for (const n of nodes) n.relevant = n.links.length > 0 || n.blockInheritance || n.kind !== 'ou' || n.name === 'People';
      for (let i = 1; i <= 14; i++) nodes.push({ dn: 'OU=Branch '+i+',OU=Engineering,'+people, parentDN: 'OU=Engineering,'+people, kind:'ou', name:'Branch '+i, links:[], blockInheritance:false, relevant:false });
      nodes.find((n) => n.name === 'Engineering').relevant = false;
      return Promise.resolve({ nodes, policies, names:{ 'S-1-5-21-1-1-1-1204':'Sales Team', 'S-1-5-21-1-1-1-1205':'IT Team' }, notes:[] });
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
      if (req && req.filter && req.filter.indexOf('anr=') >= 0) { // the Policies question box
        return Promise.resolve({ count: 3, truncated: false, entries: [
          { dn: 'CN=User2,OU=Sales,OU=People,DC=adquery,DC=test', attributes: { displayName: ['User 2'], sAMAccountName: ['user2'], objectClass: ['top','person','organizationalPerson','user'] } },
          { dn: 'CN=WS-SALES-01,OU=Workstations,DC=adquery,DC=test', attributes: { name: ['WS-SALES-01'], dNSHostName: ['ws-sales-01.adquery.test'], objectClass: ['top','computer'] } },
          { dn: 'OU=Sales,OU=People,DC=adquery,DC=test', attributes: { ou: ['Sales'], objectClass: ['top','organizationalUnit'] } },
        ] });
      }
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
    await page.getByRole("heading", { name: "AD Query" }).waitFor();
    await page.getByRole("button", { name: /Connect to CORP/ }).waitFor();
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
    await page.locator(".ledger-flow-result").waitFor();
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
    await page.getByPlaceholder("A person, a computer or a container").fill("sales");
    await page.locator(".ledger-line", { hasText: "Sales" }).first().waitFor();
    await shot(page, "18-policies");
    await page.locator(".ledger-line", { hasText: "organizational unit" }).first().click();
    await page.getByText(/Users in Sales get/).waitFor();
    await page.getByText(/150 users/).waitFor();
    await shot(page, "19-policies-trace");
    // A person signed in on a machine: the two halves side by side.
    await page.getByRole("button", { name: "Policies" }).first().click();
    await page.getByPlaceholder("A person, a computer or a container").fill("user");
    await page.locator(".ledger-line", { hasText: "User 2" }).first().click();
    await page.getByText(/User 2 gets/).waitFor();
    await page.getByRole("button", { name: "On a computer…" }).click();
    await page.getByPlaceholder("a computer by name").fill("WS");
    await page.locator(".ledger-move").getByRole("button", { name: /WS-SALES-01/ }).first().click();
    await page.locator(".ledger-pair-col").nth(1).locator(".ledger-flow-result").waitFor();
    await shot(page, "23-person-on-machine");
    await page.getByRole("button", { name: /^Just / }).click();

    await page.locator(".ledger-page-main").getByRole("button", { name: "Sales Drive Maps", exact: true }).click();
    await page.getByText(/Sales Drive Maps is linked at/).waitFor();
    await page.getByRole("button", { name: "try: switch the policy off" }).click({ force: true });
    await page.locator(".ledger-impact .ledger-headline").waitFor();
    await shot(page, "22-policy-page");
    await page.getByRole("button", { name: "Back to what is real" }).click();
    await page.locator(".ledger-page-side").getByRole("button", { name: "trace" }).first().click();
    await page.getByText(/Users in Sales get/).waitFor();
    await page.getByRole("button", { name: "Show on the tree" }).click();
    await page.locator(".ledger-map").waitFor();
    await shot(page, "20-policies-tree");
    await page.getByRole("button", { name: "Policies" }).first().click();
    await page.locator(".ledger-line", { hasText: "All policies" }).click();
    await page.locator(".ledger-table").waitFor();
    await shot(page, "21-policies-list");

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
