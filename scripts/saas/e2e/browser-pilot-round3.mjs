// Real-browser (Chromium) check of the pilot scope in the interface, against a running MULTI_COMPANY_ENABLED server that serves the built SPA
// (build with an EMPTY VITE_API_BASE_URL). SYNTHETIC data, disposable stack. Screenshots go to OUT_DIR.
//   1  sign-in and company selection carry the PLATFORM name "Sunchaser Sync" and no Sunchaser company identity
//   2  inside the workspace: the COMPANY's name, no Sunchaser name, logo or footer
//   3  company settings screen: edit, save, history; a non-administrator sees it read-only
//   4  modules not finished for pilots are not offered (AutoSizer, after-sales, Learning Studio, WhatsApp, marketplace)
//   5  the founding company's screens are unchanged
//   Env: E2E_BASE_URL, TEST_PW, PLAYWRIGHT_BROWSERS_PATH.  Seed first (seed-two-companies.mjs, reset-founding-test-passwords.mjs).
import fs from "node:fs";
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW, OUT = process.env.OUT_DIR || "docs/saas/evidence/screens";
if (!PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and a local E2E_BASE_URL."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 300) : ""}`); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const fresh = async (vp = { width: 1360, height: 900 }) => { const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.setDefaultTimeout(20000); return { ctx, page }; };
const openLogin = async (page) => { await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.locator("button:visible", { hasText: "Client/Staff Sign In" }).first().click(); await page.getByPlaceholder("username").waitFor(); };
async function signIn(page, user) {
  await openLogin(page);
  await page.getByPlaceholder("username").fill(user);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('form button[type="submit"]').first().click();
}
// Waits for the screen's answer to a save; fails loudly with the screen's own error text instead of timing out.
const answered = async (page) => {
  await page.locator('[data-testid="company-settings-notice"], [data-testid="company-settings-error"]').first().waitFor();
  if (await page.getByTestId("company-settings-error").count()) throw new Error("screen error: " + (await page.getByTestId("company-settings-error").innerText()));
};
const text = (page) => page.locator("body").innerText();
const buttons = async (page) => (await page.locator("button:visible").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
const SUN_CO = /SUNCHASER\s+Energy Systems|Sunchaser Energy Systems|ENTERPRISE CLOUD GRID/i;
const sunLogo = (page) => page.locator('img[src*="sunchaser-logo"]').count();

// 1. platform branding on sign-in and company selection
{
  const { ctx, page } = await fresh();
  await openLogin(page);
  await page.getByTestId("platform-wordmark").waitFor();
  const t = await text(page);
  check("sign-in screen is the platform's: it says Sunchaser Sync", /Sunchaser Sync/.test(t) && (await page.getByTestId("platform-name").innerText()) === "Sunchaser Sync");
  check("...and shows no Sunchaser company name, tagline or logo image", !SUN_CO.test(t) && (await sunLogo(page)) === 0, t.slice(0, 200));
  await page.waitForTimeout(900); // let the entry animation finish
  await page.screenshot({ path: `${OUT}/r3-01-signin-platform.png` });
  await page.getByPlaceholder("username").fill("both_user");
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('form button[type="submit"]').first().click();
  await page.getByTestId("company-select").waitFor();
  const ct = await text(page);
  check("company selection says Sunchaser Sync and lists the companies by their own names", /Sunchaser Sync/.test(ct) && /Alpha Solar/.test(ct) && /Beta Energy/.test(ct) && !SUN_CO.test(ct) && (await sunLogo(page)) === 0, ct.slice(0, 200));
  await page.screenshot({ path: `${OUT}/r3-02-company-selection-platform.png` });
  await ctx.close();
}

// 2 + 3 + 4. a pilot company's administrator
let alphaName = "";
{
  const { ctx, page } = await fresh();
  await signIn(page, "alpha_admin");
  await page.getByTestId("workspace-company-name").waitFor();
  alphaName = (await page.getByTestId("workspace-company-name").innerText()).trim();
  const t = await text(page);
  // A company that has set no name yet shows the neutral words "Your company" - never Sunchaser's name; a company that has set one shows it.
  check(`workspace header carries the company's own name, or the neutral "Your company" before one is set ("${alphaName}")`, /^(Alpha Solar|Your company)/.test(alphaName));
  check("...with 'Powered by Sunchaser Sync' and no Sunchaser company name, logo or footer", /POWERED BY SUNCHASER SYNC/i.test(t) && !SUN_CO.test(t) && (await sunLogo(page)) === 0, t.slice(0, 300));
  const bs = await buttons(page);
  const has = (re) => bs.some((b) => re.test(b));
  check("the Sunchaser-only Learning Studio is not offered", !has(/Learning Studio/i), bs.join(" | ").slice(0, 400));
  check("WhatsApp connection, WhatsApp inbox and marketplace are not offered", !has(/WhatsApp Connection/i) && !has(/WhatsApp Inbox/i) && !has(/Marketplace/i));
  check("the AI assistant carries no Sunchaser name", has(/^AI Assistant/) && !has(/Sunchaser AI Assistant/));
  check("Company Settings is offered", has(/^Company Settings/));
  check("after-sales (Project Delivery) is not offered", !has(/^Project Delivery/));
  await page.screenshot({ path: `${OUT}/r3-03-alpha-workspace.png` });

  // company settings
  await page.locator("button:visible", { hasText: /^Company Settings/ }).first().click();
  await page.getByTestId("company-settings").waitFor();
  check("the settings screen opens, editable for the administrator", (await page.getByTestId("save-branding").count()) === 1 && (await page.getByTestId("company-settings-readonly").count()) === 0);
  const stamp = Date.now().toString(36).toUpperCase();
  const newName = `${alphaName.replace(/ ZZ.*$/, "")} ZZ${stamp}`;
  await page.getByTestId("branding-companyName").fill(newName);
  await page.getByTestId("branding-officeAddress").fill(`Address ${stamp}`);
  await page.getByTestId("save-branding").click();
  await answered(page);
  await page.waitForFunction((n) => document.querySelector('[data-testid="workspace-company-name"]')?.textContent?.trim() === n, newName, { timeout: 15000 });
  check("saving branding updates the header at once, without a reload", (await page.getByTestId("workspace-company-name").innerText()).trim() === newName);
  await page.screenshot({ path: `${OUT}/r3-04-company-settings-branding.png` });

  await page.getByTestId("company-settings-tab-bank").click();
  await page.getByTestId("add-bank").click();
  const last = (await page.locator('[data-testid^="bank-row-"]').count()) - 1; // earlier runs may have left accounts
  await page.getByTestId(`bank-${last}-bankName`).fill(`UiBank${stamp}`);
  await page.getByTestId(`bank-${last}-accountTitle`).fill("UI COMPANY");
  await page.getByTestId(`bank-${last}-accountNumber`).fill("12345678");
  await page.getByTestId(`bank-${last}-iban`).fill("PK36SCBL0000001123456702");
  await page.getByTestId("save-banks").click();
  await answered(page);
  check("a bank account is saved from the screen", (await page.getByTestId("company-settings-notice").innerText()).includes("Bank accounts saved"));

  await page.getByTestId("company-settings-tab-terms").click();
  await page.getByTestId("terms-text").fill(`First clause ${stamp}\nSecond clause ${stamp}`);
  await page.getByTestId("save-terms").click();
  await answered(page);
  await page.getByTestId("company-settings-tab-prices").click();
  await page.getByTestId("price-validity").fill("14");
  await page.getByTestId("save-prices").click();
  await answered(page);

  await page.getByTestId("company-settings-tab-history").click();
  await page.getByTestId("company-settings-history").waitFor();
  await page.getByTestId("history-row").first().waitFor();
  const rows = await page.getByTestId("history-row").allInnerTexts();
  check("the history lists the four changes just made, newest first, with who changed them", rows.length >= 4 && /price/i.test(rows[0]) && rows.slice(0, 4).every((r) => /alpha_admin/.test(r)) && rows.slice(0, 4).some((r) => /bank/i.test(r)) && rows.slice(0, 4).some((r) => /branding/i.test(r)), rows.slice(0, 4).join(" // "));
  await page.screenshot({ path: `${OUT}/r3-05-company-settings-history.png` });

  // the saved values are what an invoice would print: reload and read them back
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("workspace-company-name").waitFor();
  check("after a full reload the header still shows the saved company name", (await page.getByTestId("workspace-company-name").innerText()).trim() === newName);
  await ctx.close();
}

// 3b. a non-administrator sees the screen read-only and has no history
{
  const { ctx, page } = await fresh();
  await signIn(page, "alpha_sales");
  await page.getByTestId("workspace-company-name").waitFor();
  const bs = await buttons(page);
  const opened = bs.some((b) => /^Company Settings/.test(b));
  if (opened) {
    await page.locator("button:visible", { hasText: /^Company Settings/ }).first().click();
    await page.getByTestId("company-settings").waitFor();
    check("a sales user sees the settings read-only: notice shown, no save buttons, no history tab", (await page.getByTestId("company-settings-readonly").count()) === 1 && (await page.getByTestId("save-branding").count()) === 0 && (await page.getByTestId("company-settings-tab-history").count()) === 0);
    check("...and the fields are disabled", await page.getByTestId("branding-companyName").isDisabled());
    await page.screenshot({ path: `${OUT}/r3-06-company-settings-readonly.png` });
  } else {
    check("a sales user is not offered the settings screen at all (acceptable: nothing editable)", true);
  }
  // Sales tools: AutoSizer is not offered
  const tools = await text(page);
  check("a pilot company's sales user is not offered Auto Sizer or After Sales Admin", !/Auto Sizer/i.test(tools) && !/After Sales Admin/i.test(tools));
  await ctx.close();
}

// 5. the founding company is unchanged
{
  const { ctx, page } = await fresh();
  await signIn(page, "t_admin");
  await page.waitForFunction(() => !!localStorage.getItem("sunchaser_auth_token"), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const hd = await page.locator("header").first().innerText();
  const bs = await buttons(page);
  check("founding company: header keeps the Sunchaser name", /SUNCHASER\s+Energy Systems/i.test(hd) && !/POWERED BY SUNCHASER SYNC/i.test(hd), hd.slice(0, 200));
  check("founding company: Learning Studio, WhatsApp, Project Delivery and the Sunchaser AI Assistant are still offered", bs.some((b) => /Learning Studio/i.test(b)) && bs.some((b) => /WhatsApp Connection/i.test(b)) && bs.some((b) => /^Project Delivery/.test(b)) && bs.some((b) => /Sunchaser AI Assistant/.test(b)), bs.join(" | ").slice(0, 500));
  await page.screenshot({ path: `${OUT}/r3-07-founding-workspace.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
