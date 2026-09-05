// Drives the REAL backend (wails dev, localhost:34115) against the plain
// OpenLDAP container to prove the app behaves as a generic directory tool:
// the head says LDAP, Search runs, and the two Active Directory registers
// explain themselves instead of pretending.
//   node scripts/e2e-ldap.mjs     (from app/frontend)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.LDAP_OUT ?? "node_modules/.cache/adquery-e2e/ldap");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
let failed = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); } catch (e) { failed = true; log("FAIL", name, String(e.message ?? e).split("\n")[0]); await shot(page, "fail-" + name.replace(/\W+/g, "-")); }
};

await page.goto("http://localhost:34115/", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: "networkidle" });

await step("connect to OpenLDAP with a password", async () => {
  const different = page.getByRole("button", { name: /different directory/i });
  if (await different.count()) await different.first().click();
  await page.getByPlaceholder("dc01.contoso.com").fill("localhost:3389");
  await page.getByPlaceholder("you@contoso.com").fill("cn=admin,dc=adquery,dc=test");
  await page.locator('input[type="password"]').fill("AdminPass123!");
  await page.getByRole("button", { name: /open connection/i }).click();
  await page.getByPlaceholder("Who are you looking for?").waitFor({ timeout: 60000 });
  const head = await page.locator(".ledger-head-conn").innerText();
  if (!/LDAP/.test(head) || /Active Directory/.test(head)) throw new Error("head says: " + head);
});
await shot(page, "p01-opening");

await step("opening sheet marks the AD registers", async () => {
  const lines = await page.locator(".ledger-lines").last().innerText();
  if ((lines.match(/needs Active Directory/g) ?? []).length !== 3) throw new Error("expected three AD notes, got: " + lines);
});

await step("users search runs on plain LDAP", async () => {
  await page.locator(".ledger-hint").getByRole("button", { name: "type" }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.locator(".ledger-meta b").waitFor({ timeout: 60000 });
  const n = await page.locator(".ledger-meta b").innerText();
  if (n === "0") throw new Error("no users on OpenLDAP");
  log("     users:", n);
});
await shot(page, "p02-ledger");

await step("stale register explains it needs AD", async () => {
  await page.getByRole("tab", { name: "Stale accounts" }).click();
  await page.getByText("This register needs Active Directory.").waitFor({ timeout: 5000 });
});
await shot(page, "p03-stale");

await step("privileged register explains it needs AD", async () => {
  await page.getByRole("tab", { name: "Privileged access" }).click();
  await page.getByText("This register needs Active Directory.").waitFor({ timeout: 5000 });
});
await shot(page, "p04-privileged");

await step("row pane login and risk sections step aside", async () => {
  await page.getByRole("tab", { name: "Search" }).click();
  await page.locator(".ledger-row").first().click();
  await page.getByRole("tab", { name: "Login" }).click();
  await page.getByText(/Active Directory feature/).waitFor({ timeout: 5000 });
  await page.getByRole("tab", { name: "Risk" }).click();
  await page.getByText(/does not expose those attributes/).waitFor({ timeout: 30000 });
});
await shot(page, "p05-row");

await browser.close();
log(failed ? "SOME STEPS FAILED" : "all steps passed", "→", OUT);
process.exit(failed ? 1 : 0);
