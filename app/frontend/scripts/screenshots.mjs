// Regenerate the screenshot gallery in docs/screenshots/.
//
//   npm run shots        (builds, serves dist via vite preview, drives Playwright)
//
// Runs fully offline: a mock `window.go` (the Wails bindings) is injected before
// the app loads, so no directory/back-end is required. Captures the journey plus
// the Reports / Reclaim (unused licenses) / Stale / 365 surfaces, in light and dark.
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
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 768 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(`${MOCK}\ntry { localStorage.setItem('adquery.theme','${theme}'); } catch (e) {}\n${extraInit ?? ""}`);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await run(page);
    await ctx.close();
  }

  // Freeze animations to their end state for the capture only (so dialogs are
  // opaque/settled) — without globally disabling them, which breaks Radix's
  // open-state detection for menus/popovers at interaction time.
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, name + ".png"), animations: "disabled" });
    shots.push(name + ".png");
    console.log("  ✓", name);
  };
  const connectRun = async (page) => {
    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    // Object-type picker is a Radix ToggleGroup (items expose role="radio").
    await page.getByRole("radio", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByText("500 records").first().waitFor();
  };

  // --- Light: full journey + reports surfaces -------------------------------
  await session("light", "", async (page) => {
    await page.getByRole("heading", { name: "AD Query" }).waitFor();
    await shot(page, "01-connect");

    await connectRun(page);
    await shot(page, "02-ledger");

    await page.getByRole("button", { name: /Filters/ }).click();
    await page.getByRole("button", { name: "Add condition" }).click();
    await shot(page, "03-filters");
    await page.keyboard.press("Escape"); // close the Filters popover

    await page.getByText("user2@adquery.test").click();
    await page.getByRole("tab", { name: "Login" }).click();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await page.getByText(/responded/).waitFor();
    await shot(page, "12-login");
    await page.getByRole("tab", { name: "Risk" }).click();
    await page.getByText(/Overall/).waitFor();
    await shot(page, "13-risk");
    await page.getByRole("tab", { name: "Security" }).click();
    await page.getByRole("button", { name: /Load security descriptor/ }).click();
    await page.getByText("DACL").waitFor();
    await shot(page, "04-inspector");
    await page.getByRole("button", { name: "close" }).click();

    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Bulk lookup/ }).click();
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await page.getByRole("button", { name: /Look up/ }).click();
    await page.getByText(/found/).first().waitFor();
    await shot(page, "05-bulk");
    // Dialogs (shadcn) expose an auto close button labelled "Close"; take the first.
    await page.getByRole("button", { name: "Close" }).first().click();

    await page.getByRole("button", { name: /Export CSV/ }).click();
    await page.getByText("Export to CSV").waitFor();
    await shot(page, "06-export");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // Reports panel + license + stale.
    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Reports/ }).click();
    await page.getByText("Built-in", { exact: true }).waitFor();
    await shot(page, "08-reports");

    // Report rows render an "Open" Button each; DOM order = All users, Stale, Reclaim.
    const opens = page.getByRole("button", { name: "Open", exact: true });
    await opens.nth(2).click(); // Licenses & sign-in
    await page.getByText("Built-in", { exact: true }).waitFor({ state: "hidden" }); // Reports closes as the sub-report opens
    await page.getByText(/licensed in scope/).waitFor();           // ready phase
    await shot(page, "09-reclaim");
  });

  // --- Stale report (own session; avoids nested-dialog churn) --------------
  await session("light", "", async (page) => {
    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Reports/ }).click();
    await page.getByText("Built-in", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open", exact: true }).nth(1).click(); // Stale accounts
    await page.getByText("Not seen in the last").waitFor();
    await shot(page, "10-stale");
  });

  // --- Privileged access review (own session) ------------------------------
  await session("light", "", async (page) => {
    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Reports/ }).click();
    await page.getByText("Built-in", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open", exact: true }).nth(3).click(); // Privileged access
    await page.getByText(/privileged users/).waitFor();
    await shot(page, "14-privileged");
  });

  // --- 365 device-code sign-in (signed out) --------------------------------
  await session("light",
    `localStorage.setItem('adquery.m365.tenant','contoso.onmicrosoft.com');
     localStorage.setItem('adquery.m365.client','11111111-2222-3333-4444-555555555555');
     window.go.main.App.M365SignedIn = () => Promise.resolve(false);`,
    async (page) => {
      await page.getByRole("button", { name: /Connect to CORP/ }).click();
      await page.getByRole("button", { name: /Connect 365/ }).click(); // masthead 365 chip (signed out)
      // Primary sign-in opens the browser; for the gallery show the device-code
      // fallback (which renders the code) instead.
      await page.getByRole("button", { name: /Sign in with a code/ }).click();
      await page.getByText("F7K2-9QLM").waitFor();
      await shot(page, "11-m365-signin");
    });

  // --- Dark ledger ---------------------------------------------------------
  await session("dark", "", async (page) => {
    await connectRun(page);
    await shot(page, "07-ledger-dark");
  });

  await browser.close();
  await server.httpServer.close();
  await rm(TMP, { recursive: true, force: true });
  console.log(`\nWrote ${shots.length} screenshots to docs/screenshots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
