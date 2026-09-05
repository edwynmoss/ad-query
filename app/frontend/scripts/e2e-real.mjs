// Drives the REAL AD Query backend through the Wails dev server (localhost:34115)
// with headless Chromium: connect to the Docker directory, run a query, open
// Tools, check for updates against the local manifest, install.
//   node adq-real.mjs            (run from app/frontend so playwright resolves)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("C:/Users/edwyn/AppData/Local/Temp/claude/C--Projects-Intermet/65be5e4c-7d65-453c-ab85-15c3bebb5b32/scratchpad/adq-real-out");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });
let failed = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); } catch (e) { failed = true; log("FAIL", name, String(e.message ?? e).split("\n")[0]); }
};

await page.goto("http://localhost:34115/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot(page, "r00-start");

await step("manual connect form", async () => {
  const different = page.getByRole("button", { name: /different directory/i });
  if (await different.count()) await different.first().click();
  await page.getByPlaceholder("dc01.contoso.com").waitFor({ timeout: 10000 });
});
await shot(page, "r01-connect-form");

await step("connect with a password to OpenLDAP", async () => {
  await page.getByPlaceholder("dc01.contoso.com").fill("localhost:3389");
  const pw = page.getByRole("radio", { name: /Username & password/ });
  if (await pw.count()) await pw.first().click();
  await page.getByPlaceholder("you@contoso.com").fill("cn=admin,dc=adquery,dc=test");
  await page.locator('input[type="password"]').fill("AdminPass123!");
  await page.getByRole("button", { name: /open connection/i }).click();
  await page.getByRole("button", { name: /^Disconnect$/ }).waitFor({ timeout: 60000 });
});
await shot(page, "r02-connected");

await step("run the default query", async () => {
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.getByText(/\d+ records/).first().waitFor({ timeout: 60000 });
  const text = await page.locator("body").innerText();
  const m = text.match(/([\d,]+) records/);
  if (!m || m[1] === "0") throw new Error("no records: " + (m ? m[0] : "none"));
  if (!text.includes("v1.0.0")) throw new Error("footer version missing");
  log("     records:", m[1]);
});
await shot(page, "r03-results");

await step("inspect a row", async () => {
  await page.getByText(/Jane Doe|Clark Kent|Bob Smith/).first().click();
  await page.getByText(/Attributes|Risk|Details/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
});
await shot(page, "r04-inspector");

await step("tools menu shows Check for updates", async () => {
  await page.getByRole("button", { name: /Tools/ }).click();
  await page.getByRole("menuitem", { name: /Check for updates/ }).waitFor({ timeout: 5000 });
});
await shot(page, "r05-tools");

await step("update offered from the local manifest", async () => {
  await page.getByRole("menuitem", { name: /Check for updates/ }).click();
  await page.getByText(/Version 1\.0\.1 is available/).first().waitFor({ timeout: 20000 });
  const toasts = await page.getByText(/Version 1\.0\.1 is available/).count();
  if (toasts !== 1) throw new Error(`expected one update toast, saw ${toasts}`);
  await page.getByRole("button", { name: /Install and restart/ }).first().waitFor({ timeout: 5000 });
});
await shot(page, "r06-update-offered");

await step("download, verify and hand off to the installer", async () => {
  await page.getByRole("button", { name: /Install and restart/ }).first().click();
  await page.getByText(/Downloading the update|Restarting into the new version|could not be installed/).first().waitFor({ timeout: 20000 });
  await shot(page, "r07-update-downloading");
  await page.getByText(/Restarting into the new version|could not be installed/).first().waitFor({ timeout: 90000 });
  const text = await page.locator("body").innerText();
  if (!text.includes("Restarting into the new version")) throw new Error("install failed: " + text.match(/could not be installed[^\n]*\n?[^\n]*/)?.[0]);
});
await shot(page, "r08-update-restarting");

await browser.close();
log(failed ? "REAL-APP RUN: FAIL" : "REAL-APP RUN: PASS");
process.exit(failed ? 1 : 0);
