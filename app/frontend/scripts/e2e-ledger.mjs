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
// Headless Chromium blocks the clipboard unless the context grants it.
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
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
  await page.locator(".ledger-headline").waitFor({ timeout: 30000 });
  await page.locator(".ledger-flow-result").waitFor({ timeout: 30000 });
  const chain = await page.locator(".ledger-record-body").innerText();
  if (!/Terry Wong gets \d+ policies\. \d+ more are linked above them but never arrive\./.test(chain)) throw new Error("headline: " + chain.slice(0, 200));
  if (!/Corporate Baseline\s*enforced, applies\s*1/i.test(chain)) throw new Error("Corporate Baseline should apply first: " + chain.slice(0, 400));
  if (!/VPN Client Settings\s*would apply, but Sales Team is denied it/i.test(chain)) throw new Error("VPN Client Settings sentence: " + chain.slice(0, 600));
  if (!/Sales Printers\s*the link is switched off on Sales/i.test(chain)) throw new Error("Sales Printers sentence");
  if (!/How this is worked out/.test(chain)) throw new Error("explainer missing");
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
  await page.getByPlaceholder("A person, a computer or a container").waitFor({ timeout: 10000 });
  await shot(page, "l15-policies-home");
  // Ask about Finance: a container trace with the block.
  await page.getByPlaceholder("A person, a computer or a container").fill("Finance");
  await page.locator(".ledger-line", { hasText: "Finance" }).first().waitFor({ timeout: 30000 });
  await page.locator(".ledger-line", { hasText: "Finance" }).first().click();
  await page.getByText(/Finance blocks inheritance from above/).waitFor({ timeout: 60000 });
  const trace = await page.locator(".ledger-qhead, .ledger-page").allInnerTexts().then((t) => t.join("\n"));
  if (!/Users in Finance get 2 policies\./.test(trace)) throw new Error("finance headline: " + trace.slice(0, 300));
  // Hover controls sit inside the line (invisible until hover), so allow a few words between the name and the fate.
  if (!/Corporate Baseline[\s\S]{0,80}?enforced, so it passes the block and applies\s*1/.test(trace)) throw new Error("enforced sentence: " + trace.slice(0, 800));
  await page.getByText(/\d[\d,]* users?, \d+ computers?/).waitFor({ timeout: 60000 });
  await shot(page, "l16-policies-trace-finance");
  // Try it on the block line: Finance stops blocking, the flow redraws with what would start arriving.
  await page.getByRole("button", { name: "try: stop blocking" }).click({ force: true });
  await page.locator(".ledger-hypo").waitFor({ timeout: 5000 });
  await page.locator(".ledger-page.is-hypo").waitFor({ timeout: 60000 });
  await page.locator(".ledger-flow-pol.is-starts").first().waitFor({ timeout: 60000 });
  const flow = await page.locator(".ledger-page-main").innerText();
  if (!/People Screensaver[\s\S]*would start arriving/.test(flow)) throw new Error("the screensaver should start arriving: " + flow.slice(0, 400));
  if (!/would get \d+ policies instead of 2/.test(await page.locator(".ledger-qhead").innerText())) throw new Error("hypothetical headline missing");
  await page.locator(".ledger-impact .ledger-headline").waitFor({ timeout: 60000 });
  await shot(page, "l16f-whatif-unblock");
  await page.getByRole("button", { name: "Back to what is real" }).click();
  // Drill down: the policy's own page, then back.
  await page.locator(".ledger-page-main").getByRole("button", { name: "Finance Lockdown", exact: true }).click();
  await page.getByText(/Finance Lockdown is linked at Finance/).waitFor({ timeout: 30000 });
  await page.locator("dt", { hasText: "SYSVOL path" }).waitFor({ timeout: 5000 });
  await shot(page, "l16b-policy-page");
  // Try it: switching the policy off, from the facts.
  await page.getByRole("button", { name: "try: switch the policy off" }).click({ force: true });
  await page.locator(".ledger-hypo").waitFor({ timeout: 5000 });
  await page.locator(".ledger-impact .ledger-headline").waitFor({ timeout: 60000 });
  const wi = await page.locator(".ledger-impact").innerText();
  if (!/\d+ users under Finance would lose Finance Lockdown/.test(wi)) throw new Error("impact headline: " + wi.slice(0, 200));
  await shot(page, "l16e-whatif-policy");
  await page.getByRole("button", { name: "Back to what is real" }).click();
  await page.locator(".ledger-hypo").waitFor({ state: "hidden", timeout: 5000 });
  await page.locator(".ledger-line").getByRole("button", { name: "Finance" }).first().click();
  await page.getByText(/Finance blocks inheritance from above/).waitFor({ timeout: 60000 });
  // Show on the tree: Finance is revealed, quiet branches are folded.
  await page.getByRole("button", { name: "Show on the tree" }).click();
  await page.locator(".ledger-map").waitFor({ timeout: 60000 });
  const svg = await page.locator(".ledger-map").evaluate((el) => el.textContent || "");
  for (const n of ["adquery.test", "People", "Sales", "Finance", "Workstations", "Corporate Baseline", "Finance Lockdown"]) if (!svg.includes(n)) throw new Error("map missing " + n);
  const drawn = await page.locator(".ledger-map-node").count();
  const meta = await page.locator(".ledger-meta").innerText();
  log("     map nodes drawn:", drawn, "|", meta.replace(/\s+/g, " ").slice(0, 80));
  if (/of (\d+) containers/.test(meta) && Number(meta.match(/of (\d+) containers/)[1]) > 100 && drawn > 80) throw new Error("the map should fold quiet branches on a large tree: drawn " + drawn);
  if (!/more containers with nothing linked/.test(svg) && Number((meta.match(/of (\d+) containers/) || [0, 0])[1]) > 100) throw new Error("no fold shown on a large tree");
  await shot(page, "l17-policies-map");
  // A person from the tree page: back to the question, then the list.
  await page.getByRole("button", { name: "Policies" }).first().click();
  await page.locator(".ledger-line", { hasText: "All policies" }).click();
  await page.locator(".ledger-table").waitFor({ timeout: 60000 });
  await page.locator(".ledger-table").getByRole("button", { name: "IT Admin Tools" }).click();
  await page.getByText(/IT Admin Tools is linked at IT\. It applies to IT Team\./).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "people", exact: true }).first().click();
  await page.locator(".ledger-meta b").waitFor({ timeout: 60000 });
  const eyebrow = await page.locator(".ledger-eyebrow").first().innerText();
  if (!/Users\s+in\s+IT/i.test(eyebrow)) throw new Error("people-in should open Search in IT: " + eyebrow);
  await shot(page, "l16c-people-in-it");
  // Row → full page.
  await page.locator(".ledger-row").first().click();
  await page.locator(".ledger-record-switch").getByRole("tab", { name: "Policies" }).click();
  await page.getByRole("button", { name: "Open as a page" }).click();
  await page.getByText(/gets \d+ policies/).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Open the row" }).waitFor({ timeout: 5000 });
  await shot(page, "l16d-row-as-page");
  await page.getByRole("button", { name: "Policies" }).first().click();
  await page.locator(".ledger-line", { hasText: "All policies" }).click();
  await page.locator(".ledger-table").waitFor({ timeout: 60000 });
  const body = await page.locator(".ledger-register-body").innerText();
  if (!/Legacy Proxy[\s\S]*linked nowhere/.test(body)) throw new Error("orphan not flagged");
  if (!/IT Admin Tools[\s\S]*IT Team/.test(body)) throw new Error("security filtering names missing");
  if (!/never edited/.test(body)) throw new Error("empty policies should be flagged");
  await shot(page, "l18-policies-list");
});

// Terry Wong is in Sales Team, which is denied VPN Client Settings. Leaving
// the group should let it through; moving him should change his whole path.
await step("what if this person left a group, or moved", async () => {
  await page.getByRole("button", { name: "Policies" }).first().click();
  await page.getByPlaceholder("A person, a computer or a container").fill("Terry");
  await page.locator(".ledger-line", { hasText: "Terry Wong" }).first().click();
  await page.getByText(/Terry Wong gets \d+ policies/).waitFor({ timeout: 60000 });

  await page.locator(".ledger-flow-pol", { hasText: "VPN Client Settings" }).getByRole("button", { name: /^leave Sales Team$/ }).click({ force: true });
  await page.locator(".ledger-hypo").waitFor({ timeout: 5000 });
  await page.locator(".ledger-flow-pol.is-starts").first().waitFor({ timeout: 60000 });
  const t = await page.locator(".ledger-page-main").innerText();
  if (!/VPN Client Settings[\s\S]{0,120}?would start arriving/.test(t)) throw new Error("leaving Sales Team should let the VPN policy through: " + t.slice(0, 400));
  const head = await page.locator(".ledger-qhead").innerText();
  if (!/would get \d+ policies instead of \d+/.test(head)) throw new Error("headline should compare: " + head.slice(0, 200));
  const side = await page.locator(".ledger-page-side").innerText();
  if (!/only this account/i.test(side)) throw new Error("a membership change affects nobody else: " + side.slice(0, 200));
  await shot(page, "l19-whatif-leave-group");

  // Stack a move on top; the path itself changes.
  await page.getByRole("button", { name: "try: move to another container" }).click({ force: true });
  await page.getByPlaceholder("a container by name").fill("Finance");
  await page.locator(".ledger-move").getByRole("button", { name: "Finance", exact: true }).first().click();
  await page.getByText(/Finance blocks inheritance from above/).waitFor({ timeout: 60000 });
  const hypo = await page.locator(".ledger-hypo").innerText();
  if (!/leaves Sales Team[\s\S]*moves to Finance/.test(hypo)) throw new Error("both changes should be listed: " + hypo);
  await shot(page, "l20-whatif-move");

  // The trace copies as text for a ticket.
  await page.getByRole("button", { name: "Copy as text" }).click();
  await page.getByText(/Trace copied/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Back to what is real" }).click();
  await page.locator(".ledger-hypo").waitFor({ state: "hidden", timeout: 10000 });
});

// A session is the person's user settings plus the machine's computer settings.
await step("a person signed in on a machine", async () => {
  await page.getByRole("button", { name: "On a computer…" }).click();
  await page.getByPlaceholder("a computer by name").fill("WS-SALES");
  await page.locator(".ledger-move").getByRole("button", { name: /WS-SALES-01/ }).first().click();
  await page.locator(".ledger-pair").waitFor({ timeout: 60000 });
  await page.locator(".ledger-pair-col").nth(1).locator(".ledger-flow-result").waitFor({ timeout: 60000 });
  const lede = await page.locator(".ledger-qhead").innerText();
  if (!/Signed in on WS-SALES-01, Terry Wong gets \d+ polic\w+ and the machine gets \d+ polic\w+/.test(lede)) throw new Error("paired headline: " + lede.slice(0, 300));
  const machineCol = page.locator(".ledger-pair-col").nth(1);
  // The machine sits in Workstations, so it gets the policy linked there and
  // the person does not.
  await machineCol.getByText("Workstation Hardening").first().waitFor({ timeout: 30000 });
  await machineCol.getByText(/WS-SALES-01/).first().waitFor({ timeout: 10000 });
  await page.getByText(/loopback/i).waitFor({ timeout: 10000 });
  if (await page.locator(".ledger-pair-col").first().getByText("Workstation Hardening").count()) throw new Error("the person should not get the machine's policy");
  await shot(page, "l21-person-on-machine");
  await page.getByRole("button", { name: /^Just Terry Wong$/ }).click();
  await page.locator(".ledger-pair").waitFor({ state: "hidden", timeout: 10000 });
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
