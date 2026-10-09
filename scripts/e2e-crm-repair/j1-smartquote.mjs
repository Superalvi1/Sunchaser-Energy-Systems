// Journeys 1, 2 (part A) and 9: Smart Quote save, PDF download, revision, lost-response retry, mobile double tap.
import fs from "node:fs";
import { STATE, BASE, SHOTS, sql, launch, mobile, check, save, randomPhone, canonical } from "./lib.mjs";

const browser = await launch();
const phone = process.env.J1_PHONE || randomPhone();
fs.writeFileSync(`${STATE}/j1-phone.txt`, phone);

// --- Journey 1: new client edits equipment, generates, saves PDF.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(BASE + "/quote", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "10 kW", exact: true }).click(); // edit equipment: capacity 8 → 10 kW
await page.locator("#smart-quote-client-name").fill("Synthetic Journey Client");
await page.locator("#smart-quote-client-phone").fill(phone);
await page.locator("#smart-quote-client-city").fill("Lahore");
const totalText = await page.locator("aside .text-3xl").innerText();
await page.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/j1-01-quote-generated.png` });
const download = page.waitForEvent("download", { timeout: 30000 });
await page.getByRole("button", { name: "Save PDF" }).click();
const file = await (await download).path();
const pdfHead = fs.readFileSync(file).subarray(0, 5).toString();
await page.getByText("PDF saved to Sunchaser CRM and downloaded for you.").waitFor({ timeout: 30000 });
await page.locator("[role=status]").last().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/j1-02-pdf-saved.png` });
check("J1 downloaded file is a PDF", pdfHead === "%PDF-", pdfHead);
const v1 = sql(`select quote_number||'|'||total_pkr||'|'||coalesce(pdf_sha256,'')||'|'||lead_id from smart_quote_versions where client_phone='${canonical(phone)}' order by version_number`).split("\n");
check("J1 exactly one version saved for the new client", v1.length === 1, v1.join(","));
const [quote1, total1, pdfSha1, leadId] = v1[0].split("|");
check("J1 saved total equals the total shown to the client", `Rs. ${Number(total1).toLocaleString("en-PK")}`.replace(/\s/g, "") === totalText.replace(/\s/g, "").replace("Rs.", "Rs."), `${totalText} vs ${total1}`);
check("J1 PDF archived against the version", pdfSha1.length === 64);
check("J1 one lead and one customer for the phone", sql(`select count(*) from leads where phone='${canonical(phone)}'`) === "1" && sql(`select count(*) from customers where phone='${canonical(phone)}'`) === "1");
check("J1 client PDF appears in CRM proposal documents", sql(`select count(*) from customer_documents where id='doc-smart-${leadId}-${quote1}'`) === "1");

// --- Journey 2 (part A): revise the quotation (12 kW) for the same client.
await page.getByRole("button", { name: "12 kW", exact: true }).click();
await page.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
const versions = sql(`select version_number||'|'||quote_number||'|'||total_pkr from smart_quote_versions where lead_id='${leadId}' order by version_number`).split("\n");
check("J2 revision stored as version 2 on the same lead", versions.length === 2 && versions[1].startsWith("2|"), versions.join(" ; "));
check("J2 version 1 unchanged after revision", versions[0] === `1|${quote1}|${total1}`);
check("J2 still one lead for the phone", sql(`select count(*) from leads where phone='${canonical(phone)}'`) === "1");
await ctx.close();

// --- Journey 9: the save response is lost after the server committed; the client retries.
const phone9 = randomPhone("0304");
const ctx9 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p9 = await ctx9.newPage();
let dropped = 0;
await p9.route("**/api/public/smart-quotes", async (route) => {
  if (dropped++ === 0) { await route.fetch(); return route.abort("connectionreset"); }
  return route.continue();
});
await p9.goto(BASE + "/quote", { waitUntil: "networkidle" });
await p9.locator("#smart-quote-client-name").fill("Synthetic Retry Client");
await p9.locator("#smart-quote-client-phone").fill(phone9);
await p9.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await p9.locator("[role=alert]").first().waitFor({ timeout: 30000 });
const alertText = await p9.locator("[role=alert]").first().innerText();
await p9.locator("#smart-quote-lead-error").scrollIntoViewIfNeeded();
await p9.screenshot({ path: `${SHOTS}/j9-01-lost-response-error.png` });
check("J9 lost response shows an actionable error, not success", /could not confirm/i.test(alertText) && /will not create a duplicate/i.test(alertText), alertText);
await p9.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await p9.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
await p9.screenshot({ path: `${SHOTS}/j9-02-retry-success.png` });
check("J9 retry after lost response created one lead", sql(`select count(*) from leads where phone='${canonical(phone9)}'`) === "1");
check("J9 retry after lost response created one version", sql(`select count(*) from smart_quote_versions where client_phone='${canonical(phone9)}'`) === "1");
await ctx9.close();

// --- Journey 9b: mobile double tap on the sticky Generate button.
const phoneM = randomPhone("0305");
const ctxM = await browser.newContext({ ...mobile });
const pm = await ctxM.newPage();
await pm.route("**/api/public/smart-quotes", async (route) => { await new Promise((r) => setTimeout(r, 800)); return route.continue(); });
await pm.goto(BASE + "/quote", { waitUntil: "networkidle" });
await pm.locator("#smart-quote-client-name").fill("Synthetic Mobile Client");
await pm.locator("#smart-quote-client-phone").fill(phoneM);
const sticky = pm.locator(".fixed.inset-x-0.bottom-0 button");
// Two taps inside one browser task: the fastest a person can double tap.
await sticky.evaluate((button) => { button.click(); button.click(); });
await pm.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
await pm.screenshot({ path: `${SHOTS}/j9-03-mobile-after-double-tap.png` });
check("J9 mobile double tap created one lead", sql(`select count(*) from leads where phone='${canonical(phoneM)}'`) === "1");
check("J9 mobile double tap created one version", sql(`select count(*) from smart_quote_versions where client_phone='${canonical(phoneM)}'`) === "1");
await ctxM.close();
await browser.close();
fs.writeFileSync(`${STATE}/j1-lead.txt`, leadId);
save(`${STATE}/j1-results.json`);
