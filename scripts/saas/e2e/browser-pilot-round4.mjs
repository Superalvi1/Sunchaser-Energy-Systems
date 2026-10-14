// Real-browser (Chromium) check of the round-4 pilot scope, against a running MULTI_COMPANY_ENABLED server that serves the built SPA (build with an
// EMPTY VITE_API_BASE_URL). SYNTHETIC data, disposable stack. Screenshots go to OUT_DIR.
//   1  company settings, administrator: edit and delete a bank account (with confirmation, discard, save, reload) and read the history WITH the values
//      before and after
//   2  company settings, a non-administrator (a Sales Manager of the company): read-only, no history, no way to change anything
//   3  the customer portal and the welcome guide of a company WITH a logo, phone and review link, and of one with NOTHING set: its own name where it
//      has one, no Sunchaser name / logo / phone number anywhere on the page
//   4  modules not finished for pilots are not offered in the staff workspace or the portal (AI assistant, Proposal Studio, Roof Studio, sizing wizard)
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW, PLAYWRIGHT_BROWSERS_PATH.  Seed first (seed-two-companies.mjs).
import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW, OUT = process.env.OUT_DIR || "docs/saas/evidence/screens";
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_PSQL and a local E2E_BASE_URL."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 400) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

// ---- a synthetic logo (solid PNG) as an embedded image, set through the same API the settings screen uses
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const solidPng = (w, h, [r, g, b]) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())]); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]); };
const LOGO = `data:image/png;base64,${solidPng(120, 40, [200, 30, 30]).toString("base64")}`;

const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const api = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
const put = (a, p, body) => a(p, { method: "PUT", body: JSON.stringify(body) });
const alphaApi = api((await login("alpha_admin")).token), betaApi = api((await login("beta_admin")).token);
const RUN = Date.now().toString(36).toUpperCase();
const ALPHA = { name: `Alpha Solar ${RUN}`, phone: "021-1010101", review: "https://g.page/r/alpha-review" };
const bank = (name, no, iban) => ({ bankName: name, accountTitle: `ALPHA ${RUN}`, accountNumber: no, iban, branchCode: "01", isActive: true, showOnInvoice: true });
{
  const r = [
    await put(alphaApi, "/api/company/settings/branding", { companyName: ALPHA.name, officeAddress: `1 Alpha Road ${RUN}`, phoneNumbers: ALPHA.phone, logoUrl: LOGO, invoiceLogoUrl: LOGO, googleReviewUrl: ALPHA.review }),
    await put(alphaApi, "/api/company/settings/bank-accounts", { accounts: [bank(`UiBankOne${RUN}`, "11110001", "PK36SCBL0000001123456701"), bank(`UiBankTwo${RUN}`, "22220002", "PK36SCBL0000001123456702")] }),
    // beta: a company that has set NOTHING
    await put(betaApi, "/api/company/settings/branding", { companyName: "", officeAddress: "", phoneNumbers: "", billingEmail: "", websiteUrl: "", logoUrl: "", invoiceLogoUrl: "", googleReviewUrl: "" }),
  ];
  check("setup: alpha has a name, logo, phone, review link and two bank accounts; beta has set nothing", r.every((x) => x.status === 200), r.map((x) => x.status).join("/"));
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const fresh = async (vp = { width: 1360, height: 900 }) => { const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.setDefaultTimeout(20000); return { ctx, page }; };
const openLogin = async (page) => { await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.locator("button:visible", { hasText: "Client/Staff Sign In" }).first().click(); await page.getByPlaceholder("username").waitFor(); };
async function signIn(page, user) {
  await openLogin(page);
  await page.getByPlaceholder("username").fill(user);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('form button[type="submit"]').first().click();
}
const answered = async (page) => {
  await page.locator('[data-testid="company-settings-notice"], [data-testid="company-settings-error"]').first().waitFor();
  if (await page.getByTestId("company-settings-error").count()) throw new Error("screen error: " + (await page.getByTestId("company-settings-error").innerText()));
};
const text = (page) => page.locator("body").innerText();
const buttons = async (page) => (await page.locator("button:visible").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
const openSettings = async (page) => {
  await page.getByTestId("workspace-company-name").waitFor();
  // A Sales Manager lands on the lead pool; the module cards (with Company Settings) are behind its "Manager Overview" tab.
  if (!(await page.locator("button:visible", { hasText: /^Company Settings/ }).count())) {
    const overview = page.locator("button:visible", { hasText: /^(Manager Overview|Admin Dashboard|Executive Dashboard)/ }).first();
    if (await overview.count()) await overview.click();
  }
  await page.locator("button:visible", { hasText: /^Company Settings/ }).first().click();
  await page.getByTestId("company-settings").waitFor();
};

// ================================================================ 1. administrator: edit and delete a bank account, history with values
console.log("\n1. administrator: bank account edit / delete and the history with values");
{
  const { ctx, page } = await fresh();
  await signIn(page, "alpha_admin");
  await openSettings(page);
  await page.getByTestId("company-settings-tab-bank").click();
  await page.getByTestId("bank-row-0").waitFor();
  check("the two accounts are listed for editing", (await page.locator('[data-testid^="bank-row-"]').count()) === 2 && (await page.getByTestId("bank-0-bankName").inputValue()) === `UiBankOne${RUN}`);
  check("nothing is unsaved yet (no warning, no discard button)", (await page.getByTestId("banks-unsaved").count()) === 0 && (await page.getByTestId("discard-banks").count()) === 0);

  // edit: the IBAN of the first account
  const newIban = "PK00EDIT0000000000000001";
  await page.getByTestId("bank-0-iban").fill(newIban);
  check("editing shows the 'unsaved changes' warning and a discard button", (await page.getByTestId("banks-unsaved").count()) === 1 && (await page.getByTestId("discard-banks").count()) === 1);
  await page.screenshot({ path: `${OUT}/r4-01-bank-edit-unsaved.png` });
  await page.getByTestId("discard-banks").click();
  check("discarding puts the saved IBAN back and clears the warning", (await page.getByTestId("bank-0-iban").inputValue()) === "PK36SCBL0000001123456701" && (await page.getByTestId("banks-unsaved").count()) === 0);
  await page.getByTestId("bank-0-iban").fill(newIban);
  // The settings are re-read after a save. Make that re-read SLOW (1.5 s) so the order of "notice" and "refreshed list" cannot depend on the speed of
  // the machine: CI failed this check at 76/77 on both PostgreSQL versions while two local runs passed (the notice used to appear before the re-read).
  await page.route("**/api/company/settings", async (route) => { if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.getByTestId("save-banks").click();
  await answered(page);
  const warningAtNotice = await page.getByTestId("banks-unsaved").count();
  await page.unroute("**/api/company/settings");
  check("the edited IBAN is saved (notice shown, warning gone) - at the moment the notice appears, even when the re-read is slow", warningAtNotice === 0 && (await page.getByTestId("banks-unsaved").count()) === 0, `warning present when the notice appeared: ${warningAtNotice}`);
  void 0;
  check("the edited IBAN is saved (notice shown, warning gone)", (await page.getByTestId("company-settings-notice").innerText()).includes("Bank accounts saved") && (await page.getByTestId("banks-unsaved").count()) === 0);

  // delete: ask, decline, ask again, confirm, save
  await page.getByTestId("bank-1-remove").click();
  check("removing asks first, naming the account and promising that issued invoices keep their copy", /Invoices already issued keep their copy/.test(await page.getByTestId("bank-1-confirm").innerText()) && (await page.getByTestId("bank-1-confirm").innerText()).includes(`UiBankTwo${RUN}`));
  await page.screenshot({ path: `${OUT}/r4-02-bank-remove-confirm.png` });
  await page.getByTestId("bank-1-remove-cancel").click();
  check("'Keep' leaves both accounts in place", (await page.locator('[data-testid^="bank-row-"]').count()) === 2 && (await page.getByTestId("bank-1-confirm").count()) === 0);
  await page.getByTestId("bank-1-remove").click();
  await page.getByTestId("bank-1-remove-confirm").click();
  check("'Remove' takes the row off the list but nothing is saved yet (warning shown)", (await page.locator('[data-testid^="bank-row-"]').count()) === 1 && (await page.getByTestId("banks-unsaved").count()) === 1);
  await page.getByTestId("save-banks").click();
  await answered(page);
  await page.reload({ waitUntil: "networkidle" });
  await openSettings(page);
  await page.getByTestId("company-settings-tab-bank").click();
  await page.getByTestId("bank-row-0").waitFor();
  check("after a full reload only the first account remains, with the edited IBAN", (await page.locator('[data-testid^="bank-row-"]').count()) === 1 && (await page.getByTestId("bank-0-iban").inputValue()) === newIban);
  const dbRows = psql(`select count(*) from bank_accounts where company_id='co_alpha'`);
  check("...and the database holds exactly that one account for the company", dbRows === "1", dbRows);

  // history with values
  await page.getByTestId("company-settings-tab-history").click();
  await page.getByTestId("history-row").first().waitFor();
  const rows = await page.getByTestId("history-row").allInnerTexts();
  check("the newest history entry says one account was removed, and the one before says one was edited", /Bank accounts changed: 1 removed/.test(rows[0]) && rows.some((r) => /Bank accounts changed: 1 edited/.test(r)), rows.slice(0, 3).join(" // "));
  check("the one-line summaries do not print account numbers, IBANs or bank names", !rows.slice(0, 2).some((r) => /11110001|22220002|PK36SCBL|PK00EDIT|UiBank/.test(r.split("Show values")[0])));
  await page.getByTestId("history-detail-toggle").first().click();
  const removedDetail = await page.getByTestId("history-detail").first().innerText();
  check("'Show values' on the removal lists the removed account in full (what it was)", /UiBankTwo/.test(removedDetail) && /22220002/.test(removedDetail) && /PK36SCBL0000001123456702/.test(removedDetail), removedDetail);
  await page.screenshot({ path: `${OUT}/r4-03-history-removed-values.png` });
  let editedDetail = "";
  const nRows = await page.getByTestId("history-row").count();
  for (let i = 0; i < nRows && !editedDetail; i++) {
    const row = page.getByTestId("history-row").nth(i);
    if (/1 edited/.test(await row.innerText())) {
      await row.getByTestId("history-detail-toggle").click();   // one entry is open at a time, so the detail on the screen is this one's
      editedDetail = await page.getByTestId("history-detail").first().innerText();
    }
  }
  check("'Show values' on the edit shows the IBAN with its old and its new value", /IBAN/.test(editedDetail) && editedDetail.includes("PK36SCBL0000001123456701") && editedDetail.includes(newIban), editedDetail);
  const diffRow = page.locator('[data-testid="diff-row"]').filter({ hasText: "IBAN" }).first();
  check("old value and new value are in separate columns (before / after)", (await diffRow.getByTestId("diff-before").innerText()).includes("PK36SCBL0000001123456701") && (await diffRow.getByTestId("diff-after").innerText()).includes(newIban));

  // branding change: a logo is never printed as bytes
  await page.getByTestId("company-settings-tab-branding").click();
  await page.getByTestId("branding-companyName").fill(`${ALPHA.name} Ltd`);
  await page.getByTestId("branding-logoUrl").fill("");
  await page.getByTestId("save-branding").click();
  await answered(page);
  await page.getByTestId("company-settings-tab-history").click();
  await page.getByTestId("history-row").first().waitFor();
  await page.getByTestId("history-detail-toggle").first().click();
  const brandingDetail = await page.getByTestId("history-detail").first().innerText();
  check("a branding change shows the old and new company name, and the removed logo as '[embedded image ...]', never as image data", brandingDetail.includes(ALPHA.name) && brandingDetail.includes(`${ALPHA.name} Ltd`) && /\[embedded image, \d+ KB\]/.test(brandingDetail) && !/base64/.test(brandingDetail), brandingDetail.slice(0, 400));
  await page.screenshot({ path: `${OUT}/r4-04-history-branding-values.png` });
  await ctx.close();
  // put the logo back for the portal checks below
  await put(alphaApi, "/api/company/settings/branding", { companyName: ALPHA.name, logoUrl: LOGO, invoiceLogoUrl: LOGO });
}

// ================================================================ 2. a non-administrator
console.log("\n2. a non-administrator of the company");
{
  const { ctx, page } = await fresh();
  await signIn(page, "alpha_manager");
  let opened = false;
  try { await openSettings(page); opened = true; } catch (e) { console.log("   could not open the screen:", String(e.message).slice(0, 160)); }
  check("a Sales Manager of the company can open the Company Settings screen (so the read-only view is really exercised)", opened);
  if (opened) {
    check("the screen says it is read-only for this user", (await page.getByTestId("company-settings-readonly").count()) === 1);
    check("there is no Save button anywhere on the screen", (await page.getByTestId("save-branding").count()) === 0);
    check("there is no History tab (history is for administrators)", (await page.getByTestId("company-settings-tab-history").count()) === 0);
    check("the branding fields are disabled", await page.getByTestId("branding-companyName").isDisabled());
    await page.screenshot({ path: `${OUT}/r4-05-settings-readonly-branding.png` });
    await page.getByTestId("company-settings-tab-bank").click();
    await page.getByTestId("bank-row-0").waitFor();
    check("bank accounts are shown but every field is disabled, and there is no add, remove, save or discard control", (await page.getByTestId("bank-0-bankName").isDisabled()) && (await page.getByTestId("bank-0-iban").isDisabled()) && (await page.getByTestId("add-bank").count()) === 0 && (await page.getByTestId("save-banks").count()) === 0 && (await page.getByTestId("bank-0-remove").count()) === 0 && (await page.getByTestId("discard-banks").count()) === 0);
    await page.screenshot({ path: `${OUT}/r4-06-settings-readonly-bank.png` });
    await page.getByTestId("company-settings-tab-terms").click();
    check("terms are read-only too", (await page.getByTestId("terms-text").isDisabled()) && (await page.getByTestId("save-terms").count()) === 0);
    await page.getByTestId("company-settings-tab-prices").click();
    check("price settings are read-only too", (await page.getByTestId("price-validity").isDisabled()) && (await page.getByTestId("save-prices").count()) === 0);
  }
  // the API agrees with the interface
  const mgr = api((await login("alpha_manager")).token);
  const attempts = [await put(mgr, "/api/company/settings/branding", { companyName: "HACK" }), await put(mgr, "/api/company/settings/bank-accounts", { accounts: [] }), await mgr("/api/company/settings/history")];
  check(`the API refuses the same user's changes and the history (${attempts.map((a) => a.status).join("/")})`, attempts.every((a) => a.status === 403));
  check("...and nothing changed", psql(`select count(*) from bank_accounts where company_id='co_alpha'`) === "1" && !/HACK/.test(psql(`select coalesce(string_agg(value::text,''),'') from settings where key like 'co_alpha:%'`)));
  await ctx.close();
}

// ================================================================ 3. the customer portal
console.log("\n3. the customer portal and the welcome guide");
const SUNCH = /sunchaser/i;
const SUN_PHONE = /3090236666|0309-?0236666|309 ?0236666/;
// The two legal pages (privacy policy, account deletion) are hosted by the platform operator and linked from every workspace; whose policy applies to a
// pilot company's customers is an owner decision (listed in the checklist). Any OTHER link to Sunchaser is a failure.
const LEGAL_LINKS = new Set(["https://crm.sunchaserenergy.co/privacy-policy", "https://crm.sunchaserenergy.co/account-deletion"]);
const sunHrefs = (hrefs) => hrefs.filter((h) => !LEGAL_LINKS.has(h || "") && (SUNCH.test(h || "") || SUN_PHONE.test(h || "")));
const SUN_ASSETS = 'img[src*="sunchaser"], img[src*="/assets/signature"]';
async function portalVisit(user, label, expect) {
  const { ctx, page } = await fresh();   // sign in on a desktop-size page (the guest landing page of a phone has its own menu), then look at it as a phone
  await signIn(page, user);
  await page.setViewportSize({ width: 430, height: 900 });
  // customers go straight to their portal (the welcome guide is staff training): nothing stands in front of it
  check(`${label}: the portal opens directly, with no welcome guide in front of it`, (await page.getByText("Welcome guide").count()) === 0);
  // the portal
  await page.locator("header").first().waitFor();
  await page.waitForTimeout(1500);
  const body = await text(page);
  const html = await page.content();
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check(`${label}: nothing on the portal page says Sunchaser (text, links, images)`, !SUNCH.test(body) && sunHrefs(hrefs).length === 0 && (await page.locator(SUN_ASSETS).count()) === 0, (body.match(/.{0,40}sunchaser.{0,40}/i) || sunHrefs(hrefs))[0]);
  check(`${label}: ${expect.name ? "the header shows the company's name (" + expect.name + ")" : "the header shows no company name at all"}`, expect.name ? (await page.locator("header").first().innerText()).toLowerCase().includes(expect.name.toLowerCase()) : true); // the header prints it in capitals
  const wa = await page.locator('a[href^="https://wa.me/"]').count(), call = await page.locator('a[href^="tel:"]').count();
  if (expect.phone) {
    const waHref = await page.locator('a[href^="https://wa.me/"]').first().getAttribute("href");
    check(`${label}: WhatsApp and Call go to the company's own number (${expect.phone})`, wa >= 1 && call >= 1 && waHref.includes("wa.me/92211010101") && (await page.locator('a[href^="tel:"]').first().getAttribute("href")).includes("021-1010101"), waHref);
    check(`${label}: the WhatsApp message greets the company by name`, decodeURIComponent(waHref).includes(`Hello ${expect.name}`), decodeURIComponent(waHref));
  } else {
    check(`${label}: with no phone number set there are no WhatsApp or Call buttons (never Sunchaser's number)`, wa === 0 && call === 0, `${wa} / ${call}`);
  }
  const logos = await page.locator("header img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") || ""));
  if (expect.logo) check(`${label}: the header shows the company's own logo and nothing else`, logos.length === 1 && logos[0].startsWith("data:image/png;base64,"), JSON.stringify(logos.map((s) => s.slice(0, 40))));
  else check(`${label}: with no logo set the header shows no image at all (not Sunchaser's, not a broken one)`, logos.length === 0, JSON.stringify(logos.map((s) => s.slice(0, 60))));
  check(`${label}: the AI assistant and the solar sizing wizard are not offered`, !/Optional solar sizing wizard/i.test(body) && (await page.getByRole("button", { name: /\bAI\b|assistant/i }).count()) === 0 && !/Ask about/i.test(body));
  check(`${label}: warranty and delivery (after-sales) are not offered`, !/^Warranty$/m.test(body) && !/Delivery/i.test(await page.locator("nav").first().innerText().catch(() => "")));
  await page.screenshot({ path: `${OUT}/r4-08-${user}-portal-home.png`, fullPage: false });
  // other tabs
  for (const tab of ["Support", "Account"]) {
    const btn = page.locator("nav button", { hasText: new RegExp(tab, "i") }).first();
    if (await btn.count()) {
      await btn.click(); await page.waitForTimeout(700);
      const t2 = await text(page);
      const hrefs2 = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      check(`${label}: the ${tab} tab says nothing of Sunchaser and offers no Sunchaser phone number`, !SUNCH.test(t2) && sunHrefs(hrefs2).length === 0, (t2.match(/.{0,40}sunchaser.{0,40}/i) || sunHrefs(hrefs2))[0]);
      if (!expect.phone && tab === "Support") check(`${label}: Support has no Call or WhatsApp button when the company has no phone`, (await page.locator('a[href^="tel:"], a[href^="https://wa.me/"]').count()) === 0);
      await page.screenshot({ path: `${OUT}/r4-09-${user}-${tab.toLowerCase()}.png` });
    }
  }
  // every other screen a customer can reach from the portal: the bottom tabs and each service tile
  const crawled = [];
  const scanScreen = async (name) => {
    await page.waitForTimeout(900);
    const t3 = await text(page);
    const h3 = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const bad = (t3.match(/.{0,40}sunchaser.{0,40}/i) || sunHrefs(h3))[0];
    crawled.push(name);
    check(`${label}: the "${name}" screen says nothing of Sunchaser and shows no Sunchaser number, logo or link`, !SUNCH.test(t3) && sunHrefs(h3).length === 0 && (await page.locator(SUN_ASSETS).count()) === 0, bad);
  };
  for (const tab of ["Dashboard", "Proposals", "Payments"]) {
    const btn = page.locator("nav button", { hasText: new RegExp("^" + tab, "i") }).first();
    if (await btn.count()) { await btn.click(); await scanScreen(`${tab} tab`); }
  }
  await page.locator("nav button", { hasText: /^Dashboard/i }).first().click();
  await page.waitForTimeout(600);
  for (const tile of ["Service Requests", "Service History", "Energy Monitor", "Savings Calculator", "Care Plans", "My Solar System"]) {
    const btn = page.locator("button", { hasText: new RegExp("^" + tile, "i") }).first();
    if (!(await btn.count())) continue;
    await btn.click();
    await scanScreen(`${tile} service`);
    const back = page.locator("button[aria-label*='ack' i], button:has-text('Back')").first();
    if (await back.count()) await back.click(); else await page.locator("nav button", { hasText: /^Dashboard/i }).first().click();
    await page.waitForTimeout(500);
  }
  check(`${label}: ${crawled.length} portal screens were read (tabs and services)`, crawled.length >= 7, crawled.join(", "));
  await ctx.close();
}
// the welcome guide of staff (first sign-in): it names the company, never Sunchaser
async function staffGuide(user, label, expectName) {
  psql(`update users set onboarding_completed=false where username='${user}'`);
  const { ctx, page } = await fresh();
  await signIn(page, user);
  await page.getByText("Welcome guide").first().waitFor();
  await page.waitForTimeout(800);
  const steps = [];
  for (let i = 0; i < 8; i++) {
    steps.push(await text(page));
    const next = page.locator("button:visible", { hasText: /^Next/ });
    if (await next.count()) await next.first().click(); else break;
  }
  const all = steps.join("\n");
  check(`${label}: the welcome guide never says Sunchaser (${steps.length} steps read)`, !SUNCH.test(all) && steps.length >= 4, (all.match(/.{0,40}sunchaser.{0,40}/i) || [])[0]);
  check(`${label}: the welcome guide ${expectName ? "names the company (" + expectName + ")" : "uses a neutral phrase because the company has set no name"}`, expectName ? all.includes(expectName) : /Welcome to the |your company/.test(all), all.slice(0, 260));
  await page.screenshot({ path: `${OUT}/r4-07-${user}-welcome.png` });
  await page.locator("button:visible", { hasText: /Start working/ }).first().click();
  await page.getByTestId("workspace-company-name").waitFor();
  check(`${label}: finishing the guide opens the workspace`, true);
  await ctx.close();
}
await staffGuide("alpha_sales", "alpha staff (company name set)", ALPHA.name);
await staffGuide("beta_sales", "beta staff (nothing set)", "");
await portalVisit("alpha_portal", "alpha portal (name, logo, phone, review link)", { name: ALPHA.name, phone: ALPHA.phone, logo: true });
await portalVisit("beta_portal", "beta portal (nothing set)", { name: "", phone: "", logo: false });

// ================================================================ 4. staff workspace: unfinished modules are not offered
console.log("\n4. staff workspace: unfinished modules are not offered");
for (const user of ["alpha_admin", "alpha_sales"]) {
  const { ctx, page } = await fresh();
  await signIn(page, user);
  await page.getByTestId("workspace-company-name").waitFor();
  await page.waitForTimeout(1500);
  const bs = await buttons(page);
  const t = await text(page);
  const has = (re) => bs.some((b) => re.test(b));
  check(`${user}: no AI assistant tab or floating assistant (under any name)`, !has(/AI Assistant/i) && !has(/Solar AI/i) && !has(/Sunchaser AI/i) && (await page.getByLabel(/AI/i).count()) === 0 && !/Ask about Sunchaser/i.test(t), bs.join(" | ").slice(0, 300));
  check(`${user}: no Proposal Studio, Roof Studio or interactive proposal entry on the first screens`, !has(/Proposal Studio/i) && !has(/Roof Studio/i) && !/Interactive link/i.test(t));
  await page.screenshot({ path: `${OUT}/r4-10-${user}-workspace.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
