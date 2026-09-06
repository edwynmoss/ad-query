// Times the real AD Query window against a directory the size of a real
// estate. It drives the same backend the app ships with (wails dev on
// localhost:34115) and measures what a person actually waits for: the click
// to the moment the answer is on screen, drawing included.
//
// Seed first with test/samba-ad/seed-enterprise.ps1, then:
//   node scripts/e2e-scale.mjs      (from app/frontend)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.SCALE_OUT ?? "node_modules/.cache/adquery-e2e/scale");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const marks = [];
let failed = false;

// time() is the whole point: everything between the click and the answer.
const time = async (name, fn) => {
  const t0 = Date.now();
  let note = "";
  try {
    note = (await fn()) ?? "";
    const ms = Date.now() - t0;
    marks.push({ name, ms, note });
    log(`${String(ms).padStart(6)}ms  ${name}${note ? "   " + note : ""}`);
  } catch (e) {
    failed = true;
    marks.push({ name, ms: Date.now() - t0, note: "FAILED: " + String(e.message ?? e).split("\n")[0] });
    log(`  FAIL  ${name}: ${String(e.message ?? e).split("\n")[0]}`);
    await shot(page, "fail-" + name.replace(/\W+/g, "-"));
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e.stack ?? e).slice(0, 300)));

await page.goto("http://localhost:34115/", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);

await time("connect", async () => {
  const different = page.getByRole("button", { name: /different directory/i });
  if (await different.count()) await different.first().click();
  await page.getByPlaceholder("dc01.contoso.com").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("dc01.contoso.com").fill("localhost:1389");
  const pw = page.getByRole("radio", { name: /Username & password/ });
  if (await pw.count()) await pw.first().click();
  await page.getByPlaceholder("you@contoso.com").fill("administrator@adquery.test");
  await page.locator('input[type="password"]').fill("AdminPass123!");
  await page.getByRole("button", { name: /open connection/i }).click();
  await page.getByPlaceholder("Who are you looking for?").waitFor({ timeout: 120000 });
});

await time("open the Policies register", async () => {
  await page.locator(".ledger-tabs").getByRole("tab", { name: "Policies" }).click();
  await page.getByPlaceholder("A person, a computer or a container").waitFor({ timeout: 120000 });
});
await shot(page, "s01-policies-home");

// One person, deep in the tree. The picker labels people by display name,
// so the account name goes in and whatever comes back is what gets clicked.
const picker = page.getByPlaceholder("A person, a computer or a container");

// Typed a letter at a time, at the speed a person types. Filling the box in
// one go hides the thing that hurts: a search fired per keystroke.
const typeInto = (loc, text) => loc.pressSequentially(text, { delay: 120 });

await time("type a name into the picker, letter by letter", async () => {
  await picker.click();
  await typeInto(picker, "e01234");
  await page.locator(".ledger-line:not(.is-register)").first().waitFor({ timeout: 120000 });
  return `${await page.locator(".ledger-line:not(.is-register)").count()} hits`;
});

await time("trace that person", async () => {
  await page.locator(".ledger-line:not(.is-register)").first().click();
  await page.locator(".ledger-flow-result").first().waitFor({ timeout: 180000 });
  const head = await page.locator(".ledger-qhead").innerText();
  const lines = await page.locator(".ledger-flow-pol").count();
  return `${head.replace(/\s+/g, " ").slice(0, 70)} | ${lines} links drawn`;
});
await shot(page, "s02-trace-person");

await time("try a hypothetical on that person", async () => {
  const btn = page.locator(".ledger-page-main button").filter({ hasText: /^(try:|leave |join )/ }).first();
  if (!(await btn.count())) return "nothing to try on this person, skipped";
  const label = (await btn.innerText()).trim();
  await btn.click({ force: true });
  await page.locator(".ledger-hypo").waitFor({ timeout: 15000 });
  await page.locator(".ledger-page.is-hypo").waitFor({ timeout: 180000 });
  return `${label} | ${(await page.locator(".ledger-qhead").innerText()).replace(/\s+/g, " ").slice(0, 70)}`;
});
await shot(page, "s03-hypothetical");
const back = page.getByRole("button", { name: "Back to what is real" });
if (await back.count()) await back.first().click();

// A container trace is the one that counts what sits underneath it, which is
// the most expensive question the register can ask.
await time("trace a whole region, counts included", async () => {
  await page.getByRole("button", { name: "Policies" }).first().click();
  await picker.click();
  await typeInto(picker, "EMEA");
  const ou = page.locator(".ledger-line:not(.is-register)").filter({ hasText: "organizational unit" }).first();
  await ou.waitFor({ timeout: 120000 });
  await ou.click();
  await page.locator(".ledger-flow-result").first().waitFor({ timeout: 180000 });
  return (await page.locator(".ledger-qhead").innerText()).replace(/\s+/g, " ").slice(0, 70);
});

await time("  ...and the count arrives", async () => {
  await page.getByText(/[\d,]+ users?( or more)?, [\d,]+ computers?/).first().waitFor({ timeout: 300000 });
  return (await page.getByText(/[\d,]+ users?( or more)?, [\d,]+ computers?/).first().innerText()).replace(/\s+/g, " ").trim();
});
await shot(page, "s03b-container-trace");

await time("show the container tree", async () => {
  await page.getByRole("button", { name: "Show on the tree" }).click();
  await page.locator(".ledger-map").waitFor({ timeout: 180000 });
  await page.locator(".ledger-map-node").first().waitFor({ timeout: 180000 });
  const drawn = await page.locator(".ledger-map-node").count();
  const meta = (await page.locator(".ledger-meta").innerText()).replace(/\s+/g, " ");
  return `${drawn} nodes drawn | ${meta.slice(0, 90)}`;
});
await shot(page, "s04-map");

await time("list every policy", async () => {
  await page.getByRole("button", { name: "Policies" }).first().click();
  await page.locator(".ledger-line", { hasText: "All policies" }).click();
  await page.locator(".ledger-table").waitFor({ timeout: 180000 });
  await page.locator(".ledger-table tbody tr").first().waitFor({ timeout: 180000 });
  return `${await page.locator(".ledger-table tbody tr").count()} rows`;
});
await shot(page, "s05-policy-list");

await time("open one policy from the list", async () => {
  await page.locator(".ledger-table tbody tr").first().locator("button").first().click();
  await page.locator("dt", { hasText: "SYSVOL path" }).waitFor({ timeout: 120000 });
  return (await page.locator(".ledger-qhead").innerText()).replace(/\s+/g, " ").slice(0, 90);
});

await time("switch that policy off (what if)", async () => {
  await page.getByRole("button", { name: "try: switch the policy off" }).click({ force: true });
  await page.locator(".ledger-hypo").waitFor({ timeout: 15000 });
  await page.locator(".ledger-impact .ledger-headline").waitFor({ timeout: 300000 });
  return (await page.locator(".ledger-impact .ledger-headline").first().innerText()).replace(/\s+/g, " ").slice(0, 90);
});
await shot(page, "s06-whatif");

// A computer, which carries a site lookup on top of the tree walk.
await time("trace a computer", async () => {
  await page.getByRole("button", { name: "Policies" }).first().click();
  await picker.click();
  await typeInto(picker, "WS-01234");
  await page.locator(".ledger-line:not(.is-register)").first().waitFor({ timeout: 120000 });
  await page.locator(".ledger-line:not(.is-register)").first().click();
  await page.locator(".ledger-flow-result").first().waitFor({ timeout: 180000 });
  return (await page.locator(".ledger-qhead").innerText()).replace(/\s+/g, " ").slice(0, 80);
});
await shot(page, "s07-trace-computer");

// The ledger itself: every user in the directory.
await time("search: every user in the domain", async () => {
  await page.locator(".ledger-tabs").getByRole("tab", { name: /Search|Directory/ }).first().click().catch(() => {});
  await page.getByPlaceholder("Who are you looking for?").waitFor({ timeout: 60000 });
  await page.locator(".ledger-hint").getByRole("button", { name: "type" }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForTimeout(300);
  await page.locator(".ledger-meta b").waitFor({ timeout: 300000 });
  return (await page.locator(".ledger-meta").innerText()).replace(/\s+/g, " ").slice(0, 80);
});
await shot(page, "s08-all-users");

log("");
log("what a person waits for, slowest first:");
for (const m of [...marks].sort((a, b) => b.ms - a.ms)) log(`  ${String(m.ms).padStart(6)}ms  ${m.name}${m.note ? "   " + m.note : ""}`);
writeFileSync(path.join(OUT, "timings.json"), JSON.stringify(marks, null, 2));
log("");
log("screenshots and timings in", OUT);
await browser.close();
process.exit(failed ? 1 : 0);
