// Run after j1-smartquote.mjs, once the frontend has been rebuilt with a temporarily raised panel price
// (e.g. AIKO 645W pricePerWattPkr 43 → 48 in src/lib/solarEquipmentCatalog.ts). Revert the catalogue afterwards.
// Journey 2 (part B): catalogue price rises; a new quotation with the same configuration uses the new
// price while version 1 keeps its original lines and total.
// Link-token repair (P4-03): the new quotation only joins the client's lead when it carries a staff-issued link, so this
// journey has staff issue one for the j1 lead and opens the page with it (without it the quotation would be its own lead).
import fs from "node:fs";
import { STATE, BASE, SHOTS, sql, launch, check, save, canonical, apiLogin } from "./lib.mjs";
const phone = fs.readFileSync(`${STATE}/j1-phone.txt`, "utf8").trim();
const leadId = fs.readFileSync(`${STATE}/j1-lead.txt`, "utf8").trim();
const v1Before = sql(`select total_pkr||'|'||lines::text from smart_quote_versions where lead_id='${leadId}' and version_number=1`);
const admin = await apiLogin("t_admin");
const issued = await (await fetch(`${BASE}/api/leads/${leadId}/smart-quote-link`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: "{}" })).json();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE + "/quote" + new URL(issued.url).search, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "10 kW", exact: true }).click();
await page.locator("#smart-quote-client-name").fill("Synthetic Journey Client");
await page.locator("#smart-quote-client-phone").fill(phone);
await page.locator("#smart-quote-client-city").fill("Lahore");
await page.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
await browser.close();
const rows = sql(`select version_number||'|'||total_pkr from smart_quote_versions where lead_id='${leadId}' order by version_number`).split("\n");
const v1After = sql(`select total_pkr||'|'||lines::text from smart_quote_versions where lead_id='${leadId}' and version_number=1`);
const [, v1Total] = rows[0].split("|"); const [, v2Total] = rows[1]?.split("|") || [];
check("J2 new quotation after the price rise (carrying the staff link) is version 2 of the same lead", rows.length === 2, rows.join(" ; "));
check("J2 same configuration now prices higher (catalogue change applied to new quotes)", Number(v2Total) > Number(v1Total), `v1 ${v1Total} vs v2 ${v2Total}`);
check("J2 version 1 lines and total unchanged by the catalogue change", v1Before === v1After);
save(`${STATE}/j2-results.json`);
