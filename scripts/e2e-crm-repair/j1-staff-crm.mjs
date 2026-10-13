// Journeys 1/2 (staff side): the client's lead and every saved version are visible and downloadable in CRM.
import fs from "node:fs";
import { STATE, BASE, SHOTS, sql, launch, staffLogin, check, save } from "./lib.mjs";
const leadId = fs.readFileSync(`${STATE}/j1-lead.txt`, "utf8").trim();
const versions = sql(`select version_number||'|'||quote_number||'|'||total_pkr from smart_quote_versions where lead_id='${leadId}' order by version_number`).split("\n").map((r) => r.split("|"));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await staffLogin(page, "t_admin");
await page.getByRole("button", { name: "CRM Database" }).first().click();
const badge = page.getByTestId(`crm-lead-latest-quote-${leadId}`);
await badge.waitFor({ timeout: 20000 });
const badgeText = await badge.innerText();
check("CRM list shows the lead with its latest quotation", badgeText.includes(versions.at(-1)[1]), badgeText);
const firstRowBadge = await page.locator("[data-testid^=crm-lead-latest-quote-]").first().getAttribute("data-testid");
const newest = sql(`select l.id from leads l join smart_quote_versions v on v.lead_id = l.id where l.deleted_at is null group by l.id, l.created_at order by greatest(l.created_at, max(v.generated_at)) desc limit 1`);
check("CRM list sorts Smart Quote clients by their newest quotation", firstRowBadge === `crm-lead-latest-quote-${newest}`, `${firstRowBadge} vs ${newest}`);
await badge.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/j1-03-crm-lead-list.png` });

const row = badge.locator("xpath=ancestor::*[.//button[normalize-space()='View saved proposals']][1]");
await row.getByRole("button", { name: "View saved proposals" }).first().click();
await page.getByTestId("smart-quote-version-1").waitFor({ timeout: 20000 });
for (const [n, quoteNumber, total] of versions) {
  const card = page.getByTestId(`smart-quote-version-${n}`);
  const text = await card.innerText();
  check(`CRM shows version ${n} (${quoteNumber}) with its saved total`, text.includes(quoteNumber) && text.includes(Number(total).toLocaleString("en-PK")), text.split("\n")[0]);
}
await page.getByTestId("smart-quote-version-1").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/j1-04-crm-saved-versions.png` });

const v1Pdf = await page.getByTestId("smart-quote-version-1").getByRole("link", { name: /download saved client PDF/ }).getAttribute("href");
const pdf = await page.request.get(new URL(v1Pdf, BASE).href);
const body = await pdf.body();
check("Staff can download version 1's archived client PDF", pdf.status() === 200 && body.subarray(0, 5).toString() === "%PDF-", `${pdf.status()} ${body.length} bytes`);
const tampered = await page.request.get(new URL(v1Pdf, BASE).href.replace(/sig=[a-f0-9]+/, "sig=" + "0".repeat(64)));
check("A PDF link with a forged signature is refused", tampered.status() === 403, String(tampered.status()));

await page.getByTestId("smart-quote-version-1").getByRole("button", { name: "View quotation" }).click();
const dialog = page.getByText(`Client quotation · ${versions[0][1]} · Version 1`);
await dialog.waitFor({ timeout: 10000 });
const modalText = await page.locator("body").innerText();
check("Version 1 preview shows its original total, not current prices", modalText.includes(`PKR ${Number(versions[0][2]).toLocaleString("en-PK")}`));
await page.screenshot({ path: `${SHOTS}/j1-05-crm-version1-preview.png` });
await browser.close();
save(`${STATE}/j1-staff-results.json`);
