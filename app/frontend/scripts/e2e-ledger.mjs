// Drives the REAL AD Query backend (wails dev, localhost:34115) against the
// Samba AD container with headless Chromium and photographs the ledger sheet:
// opening state, a query with a where line, column facts, a row, the saved
// register, dark theme.
//   node scripts/e2e-ledger.mjs     (from app/frontend)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.LEDGER_OUT ?? "node_modules/.cache/adquery-e2e/ledger");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e.stack ?? e).slice(0, 400)));
let failed = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); } catch (e) { failed = true; log("FAIL", name, String(e.message ?? e).split("\n")[0]); await shot(page, "fail-" + name.replace(/\W+/g, "-")); }
};

await page.goto("http://localhost:34115/", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);

await step("connect to Samba AD with a password", async () => {
  const different = page.getByRole("button", { name: /different directory/i });
  if (await different.count()) await different.first().click();
  await page.getByPlaceholder("dc01.contoso.com").waitFor({ timeout: 10000 });
  await shot(page, "l00-connect");
  await page.getByPlaceholder("dc01.contoso.com").fill("localhost:1389");
  const pw = page.getByRole("radio", { name: /Username & password/ });
  if (await pw.count()) await pw.first().click();
  await page.getByPlaceholder("you@contoso.com").fill("administrator@adquery.test");
  await page.locator('input[type="password"]').fill("AdminPass123!");
  await page.getByRole("button", { name: /open connection/i }).click();
  await page.getByPlaceholder("Who are you looking for?").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
});
await shot(page, "l01-opening");

await step("pick Users from the type picker on the opening sheet", async () => {
  await page.locator(".ledger-hint").getByRole("button", { name: "type" }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.locator(".ledger-where").waitFor({ timeout: 5000 });
});
await shot(page, "l02-heading");

await step("add a condition through the where line", async () => {
  await page.getByRole("button", { name: /add a condition|\+ condition/ }).click();
  await page.getByRole("tab", { name: "Conditions" }).waitFor({ timeout: 5000 });
  // FilterBuilder: add a row, pick the field from the combobox, type the value
  await page.getByRole("button", { name: /add condition/i }).click();
  await page.getByRole("button", { name: /Field…/ }).last().click();
  await page.getByPlaceholder("Search fields…").fill("department");
  await page.getByRole("button", { name: /^Department/ }).first().click();
  await page.getByPlaceholder("value").last().fill("Sales");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /department is Sales/ }).waitFor({ timeout: 5000 });
});
await shot(page, "l03-where");

await step("run and read the ledger", async () => {
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.locator(".ledger-meta b").waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  const n = await page.locator(".ledger-meta b").innerText();
  if (n === "0") throw new Error("no rows for department is Sales");
  log("     rows:", n);
});
await shot(page, "l04-ledger");

await step("column facts for department", async () => {
  await page.locator(".ledger-facts-title").selectOption({ label: "Department" });
  await page.locator(".ledger-leader").first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
});
await shot(page, "l05-facts");

await step("row inspector", async () => {
  await page.locator(".ledger-row").first().click();
  await page.locator(".ledger-record-dn").waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
});
await shot(page, "l06-row");

await step("row: login, risk and security sections", async () => {
  await page.getByRole("tab", { name: "Login" }).click();
  await page.getByRole("button", { name: "Ask them all" }).click();
  await page.getByText(/confidence/).waitFor({ timeout: 30000 });
  await shot(page, "l06b-row-login");
  await page.getByRole("tab", { name: "Risk" }).click();
  await page.getByText(/Overall/).waitFor({ timeout: 30000 });
  await shot(page, "l06c-row-risk");
  await page.getByRole("tab", { name: "Security" }).click();
  await page.getByRole("button", { name: "Read it" }).click();
  await page.getByText(/Access control/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, "l06d-row-security");
  await page.locator(".ledger-record-switch").getByRole("tab", { name: "Policies" }).click();
  await page.getByText(/How policy flows down/).waitFor({ timeout: 30000 });
  await page.locator(".ledger-flow-result").waitFor({ timeout: 30000 });
  const chain = await page.locator(".ledger-record-body").innerText();
  if (!/Corporate Baseline\s*enforced\s*applies\s*1/i.test(chain)) throw new Error("Corporate Baseline should apply first: " + chain.slice(0, 300));
  if (!/VPN Client Settings\s*denied to Sales Team/i.test(chain)) throw new Error("VPN Client Settings should be denied to Sales Team: " + chain.slice(0, 500));
  if (!/Sales Printers\s*link disabled/i.test(chain)) throw new Error("Sales Printers should be link disabled");
  if (!/Terry Wong\s*user/i.test(chain)) throw new Error("target station missing");
  await shot(page, "l06e-row-policies");
  await page.getByRole("tab", { name: "Attributes" }).click();
});

await step("sort by a column and save the query", async () => {
  await page.locator(".ledger-head-sort").nth(0).click();
  await page.getByText(/sorted by/).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByPlaceholder("name this query").fill("Sales people");
  await page.keyboard.press("Enter");
  await page.getByText(/Saved “Sales people”/).waitFor({ timeout: 5000 });
  await page.getByRole("tab", { name: /Saved/ }).click();
  await page.locator(".ledger-line-name", { hasText: "Sales people" }).waitFor({ timeout: 5000 });
});
await shot(page, "l07-saved");

await step("stale register, then preview in the ledger", async () => {
  await page.getByRole("tab", { name: "Stale accounts" }).click();
  await page.getByRole("heading", { name: "Stale accounts" }).waitFor({ timeout: 5000 });
  await shot(page, "l10-stale");
  await page.getByRole("button", { name: "Preview in the ledger" }).click();
  await page.locator(".ledger-meta b").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: /last logon is at most|last logon is empty|add a condition|\+ condition/ }).first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "l11-stale-preview");
});

await step("privileged register scans nested membership", async () => {
  await page.getByRole("tab", { name: "Privileged access" }).click();
  await page.locator(".ledger-table, .ledger-prose").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(400);
  const body = await page.locator(".ledger-register-body").innerText();
  if (!/privileged/i.test(await page.locator(".ledger-qhead").innerText())) throw new Error("no privileged heading");
  log("     privileged:", body.split("\n").slice(0, 2).join(" | ").slice(0, 100));
  await shot(page, "l12-privileged");
});

await step("licences register asks for 365", async () => {
  await page.getByRole("tab", { name: "Licences" }).click();
  await page.getByText(/needs Microsoft 365/).waitFor({ timeout: 5000 });
  await shot(page, "l13-licences");
});

await step("policies register lists every policy and its links", async () => {
  await page.locator(".ledger-tabs").getByRole("tab", { name: "Policies" }).click();
  await page.locator(".ledger-map").waitFor({ timeout: 60000 });
  await page.locator(".ledger-map-side .ledger-flow-result").waitFor({ timeout: 60000 });
  const svg = await page.locator(".ledger-map").evaluate((el) => el.textContent || "");
  for (const n of ["adquery.test", "People", "Sales", "Finance", "Workstations", "Corporate Baseline", "Finance Lockdown"]) if (!svg.includes(n)) throw new Error("map missing " + n);
  await page.waitForTimeout(300);
  await shot(page, "l15-policies-map");
  // Trace into Finance: the block shows and the enforced link passes it.
  await page.locator(".ledger-map-node", { hasText: "Finance" }).first().locator("circle").click();
  await page.getByText(/Finance blocks inheritance from above/).waitFor({ timeout: 30000 });
  const side = await page.locator(".ledger-map-side").innerText();
  if (!/Corporate Baseline[\s\S]*passes the block/.test(side)) throw new Error("enforced link should pass the block: " + side.slice(0, 400));
  await shot(page, "l16-policies-map-finance");
  // The list view still has the orphan and the filtering names.
  await page.getByRole("tab", { name: "List" }).click();
  await page.locator(".ledger-table").waitFor({ timeout: 60000 });
  const body = await page.locator(".ledger-register-body").innerText();
  if (!/Legacy Proxy[\s\S]*not linked/.test(body)) throw new Error("orphan not flagged");
  if (!/IT Admin Tools[\s\S]*IT Team/.test(body)) throw new Error("security filtering names missing");
  await shot(page, "l17-policies-list");
});

await step("bulk lookup from a CSV", async () => {
  await page.getByRole("tab", { name: "Bulk lookup" }).click();
  await page.getByRole("heading", { name: "Bulk lookup" }).waitFor({ timeout: 5000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from("name,email\nJane,jdoe@adquery.test\nBob,bsmith@adquery.test\nNobody,nobody@adquery.test\n") });
  await page.getByRole("button", { name: /Look up 3/ }).click();
  await page.getByText(/Needs attention/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(300);
  await shot(page, "l14-bulk");
});

await step("recent queries on the opening sheet after reload", async () => {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const different = page.getByRole("button", { name: /different directory/i });
  if (await different.count()) await different.first().click();
  await page.getByPlaceholder("dc01.contoso.com").fill("localhost:1389");
  const pw = page.getByRole("radio", { name: /Username & password/ });
  if (await pw.count()) await pw.first().click();
  await page.getByPlaceholder("you@contoso.com").fill("administrator@adquery.test");
  await page.locator('input[type="password"]').fill("AdminPass123!");
  await page.getByRole("button", { name: /open connection/i }).click();
  await page.getByText("Recent", { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
});
await shot(page, "l08-opening-recent");

await step("dark theme", async () => {
  await page.locator(".ledger-line").first().click();
  await page.locator(".ledger-meta b").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.waitForTimeout(400);
});
await shot(page, "l09-dark");

await browser.close();
log(failed ? "SOME STEPS FAILED" : "all steps passed", "→", OUT);
process.exit(failed ? 1 : 0);
