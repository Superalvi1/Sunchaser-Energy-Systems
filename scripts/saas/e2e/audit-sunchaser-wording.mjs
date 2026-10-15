// REPORT-ONLY audit (never fails): which screens a pilot company's staff can open still say "Sunchaser". It opens the main tabs and every module card of the
// workspace as a company administrator and as a sales user, reads the visible text of each screen and lists where the word appears. It is a crawl of what
// the script can reach by clicking, not a proof that nothing else exists: screens behind a record (a lead, an invoice, a dialog) are not opened.
//   Env: E2E_BASE_URL, TEST_PW, PLAYWRIGHT_BROWSERS_PATH.  Seed first (seed-two-companies.mjs).  Output: $OUT_DIR/sunchaser-wording-audit.md
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW, OUT = process.env.OUT_DIR || "docs/saas/evidence/round4";
if (!PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and a local E2E_BASE_URL."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const SUN = /sunchaser/i;
const LEGAL = /privacy policy|account deletion/i;
const findings = []; let screens = 0;

async function signIn(page, user) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Client/Staff Sign In" }).first().click();
  await page.getByPlaceholder("username").fill(user);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('form button[type="submit"]').first().click();
  await page.getByTestId("workspace-company-name").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}
const scan = async (page, where, who) => {
  screens++;
  const text = await page.locator("body").innerText().catch(() => "");
  const attrs = await page.evaluate(() => [...document.querySelectorAll("[placeholder],[title],[aria-label],img[alt]")].map((e) => e.getAttribute("placeholder") || e.getAttribute("title") || e.getAttribute("aria-label") || e.getAttribute("alt") || "").filter(Boolean)).catch(() => []);
  const hits = [...text.matchAll(/.{0,50}sunchaser.{0,50}/gi)].map((m) => m[0].replace(/\s+/g, " ").trim()).filter((s) => !LEGAL.test(s));
  for (const a of attrs) if (SUN.test(a)) hits.push(`[attribute] ${a.slice(0, 100)}`);
  const imgs = await page.locator('img[src*="sunchaser"]').count();
  if (imgs) hits.push(`[image] ${imgs} image(s) from a sunchaser file`);
  // "Powered by Sunchaser Sync" is the platform's own mark and is expected; the sign-in is not a screen of the workspace
  const real = [...new Set(hits)].filter((h) => !/powered by sunchaser sync/i.test(h) && !/^Sunchaser Sync$/i.test(h));
  if (real.length) findings.push({ who, where, hits: real.slice(0, 6) });
};

async function crawl(user, label) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  await signIn(page, user);
  await scan(page, "first screen", label);
  const tabs = (await page.locator("header button:visible, nav button:visible").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 40);
  const seen = new Set();
  for (const tab of [...new Set(tabs)]) {
    if (/sign out|logout|welcome guide|refresh|staff quote|^$/i.test(tab) || seen.has(tab)) continue;
    seen.add(tab);
    try { await page.locator("button:visible", { hasText: new RegExp("^" + tab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click({ timeout: 4000 }); await page.waitForTimeout(900); await scan(page, `tab "${tab}"`, label); } catch { /* not clickable now */ }
    // module cards on a dashboard
    const cards = (await page.locator("button:visible").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 12 && t.length < 90);
    void cards;
  }
  // every module card of the admin area: open each, scan, come back
  const dash = page.locator("button:visible", { hasText: /^(Admin Dashboard|Manager Overview|Executive Dashboard)/ }).first();
  if (await dash.count()) {
    await dash.click(); await page.waitForTimeout(1200);
    const names = (await page.locator("button:visible").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /^(Business Analytics|Sales Performance|Reports|Quotations|Invoices|Parties|Project Operations|Asset|Service Desk|Support Tickets|Energy Monitoring|Hardware Inventory|Products|Client Portal Tools|Support Desk|Savings Desk|Subscription Desk|Company Settings|Manual Control Panel|Settings|Users|Branding|Audit|Activity)/.test(t));
    for (const full of [...new Set(names)]) {
      const first = full.split(" ").slice(0, 2).join(" ");
      try {
        await dash.click({ timeout: 3000 }).catch(() => {});
        await page.locator("button:visible", { hasText: new RegExp("^" + first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click({ timeout: 4000 });
        await page.waitForTimeout(1300);
        await scan(page, `module "${full.slice(0, 40)}"`, label);
      } catch { /* the module needs a record or is not clickable from here */ }
    }
  }
  await ctx.close();
}

await crawl("alpha_admin", "administrator");
await crawl("alpha_sales", "sales user");
await browser.close();

const byWhere = new Map();
for (const f of findings) for (const h of f.hits) { const k = h; if (!byWhere.has(k)) byWhere.set(k, new Set()); byWhere.get(k).add(`${f.who}: ${f.where}`); }
const lines = [
  "# Sunchaser wording in a pilot company's staff screens (report-only crawl)", "",
  `Opened ${screens} screens (main tabs and admin module cards) as a company administrator and as a sales user of a pilot company. The crawl reaches only what a click from the workspace reaches; screens behind a record or a dialog were not opened. The platform mark "Powered by Sunchaser Sync" and the privacy-policy / account-deletion links are expected and left out.`, "",
  findings.length ? `**${byWhere.size} distinct places still say Sunchaser:**` : "**No screen reached by the crawl says Sunchaser.**", "",
  ...[...byWhere.entries()].map(([h, w]) => `* \`${h}\`  \n  seen on: ${[...w].slice(0, 4).join("; ")}${w.size > 4 ? ` (+${w.size - 4} more)` : ""}`),
];
fs.writeFileSync(`${OUT}/sunchaser-wording-audit.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
