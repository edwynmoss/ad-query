// Regenerate the screenshot gallery in docs/screenshots/.
//
//   npm run shots        (builds, serves dist via vite preview, drives Playwright)
//
// Runs fully offline: a mock `window.go` (the Wails bindings) is injected before
// the app loads, so no directory/back-end is required. Captures the journey in
// light and dark.
import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const PORT = 4999;
const OUT = path.resolve(process.cwd(), "../../docs/screenshots");
const TMP = path.resolve(process.cwd(), "node_modules/.cache/adquery-shots");

// ---- Mock backend (injected as window.go before the SPA boots) -------------
const MOCK = `
window.go = { main: { App: {
  DetectDomain: () => Promise.resolve({ joined:true, domain:'corp.example.com', server:'corp.example.com', user:'alice@corp.example.com' }),
  Connect: () => Promise.resolve({ defaultNamingContext:'DC=adquery,DC=test', namingContexts:['DC=adquery,DC=test'], supportedControls:[], supportedSASLMechanisms:[], vendorName:'', vendorVersion:'', isActiveDirectory:true }),
  Disconnect: () => Promise.resolve(),
  ServerInfo: () => Promise.resolve({}),
  SchemaAttributes: () => Promise.resolve(['displayName','sAMAccountName','mail','department','title','manager','userAccountControl','lastLogonTimestamp']),
  GetACL: () => Promise.resolve({ owner:'Domain Admins', group:'Domain Users', dacl:[
    {type:'Allow',allow:true,flags:0,mask:983551,rights:['Generic all'],sid:'S-1-5-32-544',trustee:'Administrators',objectType:''},
    {type:'Deny',allow:false,flags:0,mask:131072,rights:['Read control'],sid:'S-1-5-11',trustee:'Authenticated Users',objectType:''},
    {type:'Allow (object)',allow:true,flags:0,mask:256,rights:['Reset password'],sid:'S-1-5-21-x',trustee:'Help Desk',objectType:'00299570-246d-11d0-a768-00aa006e0529'}
  ]}),
  Search: (req) => {
    if (req && req.filter && req.filter.indexOf('organizationalUnit') >= 0) {
      const ous=[['People','OU=People'],['Sales','OU=Sales,OU=People'],['IT','OU=IT,OU=People'],['Engineering','OU=Engineering,OU=People'],['Finance','OU=Finance,OU=People'],['HR','OU=HR,OU=People']];
      return Promise.resolve({ count:ous.length, truncated:false, entries: ous.map(([ou,dn]) => ({ dn: dn+',DC=adquery,DC=test', attributes:{ ou:[ou] } })) });
    }
    const e=[]; const d=['Sales','IT','Engineering','Finance','HR']; const t=['Account Executive','Systems Administrator','Software Engineer','Accountant','HR Specialist','IT Director'];
    for (let i=0;i<500;i++) e.push({ dn:'CN=User'+i+',OU='+d[i%5]+',OU=People,DC=adquery,DC=test', attributes:{ displayName:['User '+i], sAMAccountName:['user'+i], mail:['user'+i+'@adquery.test'], department:[d[i%5]], title:[t[i%6]], userAccountControl:[i%9===0?'514':(i%6===0?'66048':'512')], lastLogonTimestamp:[i%4===0?'0':'133516992000000000'] } });
    return Promise.resolve({ count:e.length, truncated:false, entries:e });
  },
  StoreSecret: () => Promise.resolve(), GetSecret: () => Promise.resolve(''), HasSecret: () => Promise.resolve(false), DeleteSecret: () => Promise.resolve(),
}}};
`;

const url = `http://localhost:${PORT}`;

function initScript(theme) {
  return `${MOCK}\ntry { localStorage.setItem('adquery.theme','${theme}'); } catch (e) {}`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(TMP, { recursive: true });
  const csvPath = path.join(TMP, "leavers.csv");
  await writeFile(csvPath, "sAMAccountName,Department\nuser1,Sales\nuser3,IT\nuser7,Engineering\nuser42,Finance\nghost777,HR\nuser88,Sales\n");

  const server = await preview({ preview: { port: PORT, strictPort: true } });
  const browser = await chromium.launch();
  const shots = [];

  async function session(theme, run) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 768 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(initScript(theme));
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await run(page);
    await ctx.close();
  }

  const shot = async (page, name) => {
    const file = path.join(OUT, name + ".png");
    await page.screenshot({ path: file });
    shots.push(name + ".png");
    console.log("  ✓", name);
  };

  // --- Light journey --------------------------------------------------------
  await session("light", async (page) => {
    await page.getByRole("heading", { name: "AD Query" }).waitFor();
    await shot(page, "01-connect");                                   // auto-detect card

    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByText("500 records").first().waitFor();
    await shot(page, "02-ledger");

    await page.getByRole("button", { name: /Filters/ }).click();
    await page.getByRole("button", { name: "Add condition" }).click();
    await shot(page, "03-filters");
    await page.locator("div.fixed.inset-0.z-20").click();

    await page.getByText("user2@adquery.test").click();
    await page.locator("button.tab", { hasText: "Security" }).click();
    await page.getByRole("button", { name: /Load security descriptor/ }).click();
    await page.getByText("DACL").waitFor();
    await shot(page, "04-inspector");
    await page.getByRole("button", { name: "close" }).click();

    await page.locator('button[title*="Bulk lookup"]').click();
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await page.getByRole("button", { name: /Look up/ }).click();
    await page.getByText(/found/).first().waitFor();
    await shot(page, "05-bulk");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: /Export CSV/ }).click();
    await page.getByText("Export to CSV").waitFor();
    await shot(page, "06-export");
  });

  // --- Dark ledger ----------------------------------------------------------
  await session("dark", async (page) => {
    await page.getByRole("button", { name: /Connect to CORP/ }).click();
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByText("500 records").first().waitFor();
    await shot(page, "07-ledger-dark");
  });

  await browser.close();
  await server.httpServer.close();
  await rm(TMP, { recursive: true, force: true });
  console.log(`\nWrote ${shots.length} screenshots to docs/screenshots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
