// Journeys 3 and 5: document upload (valid, rejected, interrupted, lost response) persists across refresh
// and re-login; renaming the client keeps documents, invoices and portal access linked.
import fs from "node:fs";
import { STATE, BASE, SHOTS, sql, launch, staffLogin, apiLogin, check, save } from "./lib.mjs";

const ids = JSON.parse(fs.readFileSync(`${STATE}/j6-ids.json`, "utf8"));
const dir = `${STATE}/files`; fs.mkdirSync(dir, { recursive: true });
const pdfPath = `${dir}/electricity-bill.pdf`;
fs.writeFileSync(pdfPath, "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const fakePath = `${dir}/disguised.pdf`;
fs.writeFileSync(fakePath, Buffer.concat([Buffer.from("MZ\x90\x00", "binary"), Buffer.alloc(200, 1)]));
const exePath = `${dir}/tool.exe`; fs.writeFileSync(exePath, "MZ");
const docCount = () => Number(sql(`select count(*) from customer_documents where customer_id='${ids.customerId}' and document_type='electricity_bill'`)) - baseline;
let baseline = 0; baseline = docCount();

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
async function openDocuments() {
  await page.getByRole("button", { name: "CRM Database" }).first().click();
  await page.getByTestId(`crm-lead-primary-metric-${ids.leadId}`).click();
  await page.getByRole("button", { name: "Open Client Portal / Manage Client" }).first().click();
  await page.getByRole("button", { name: "Documents", exact: true }).first().click();
  await page.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 20000 });
}
await staffLogin(page, "t_admin");
await openDocuments();
await page.locator("select").first().selectOption("electricity_bill");

// Rejected types: an .exe is refused in the browser; a disguised executable is refused by the server.
await page.locator("input[type=file]").first().setInputFiles(exePath);
check("J3 unsupported file type is refused with a clear message", /Only PDF, JPG, PNG, and DOCX/.test(await page.locator("[role=alert]").first().innerText()));
await page.locator("input[type=file]").first().setInputFiles(fakePath);
const fakeErr = await page.getByText(/does not match its type/).first().innerText({ timeout: 20000 });
check("J3 executable renamed to .pdf is refused by the server", Boolean(fakeErr), fakeErr);
check("J3 rejected files created no document rows", docCount() === 0);

// Interrupted upload: the connection drops before the server receives the file; the user retries.
let attempt = 0;
await page.route("**/api/admin/customer-documents/upload", async (route) => {
  attempt++;
  if (attempt === 1) return route.abort("connectionreset");
  if (attempt === 2) { await route.fetch(); return route.abort("connectionreset"); } // saved, response lost
  return route.continue();
});
await page.locator("input[type=file]").first().setInputFiles(pdfPath);
await page.getByRole("button", { name: "Retry upload" }).waitFor({ timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/j3-01-interrupted-upload-retry.png` });
check("J3 interrupted upload shows an actionable error with Retry", /network error/i.test(await page.locator("[role=alert]").first().innerText()));
await page.getByRole("button", { name: "Retry upload" }).click(); // reaches the server, response lost
await page.getByRole("button", { name: "Retry upload" }).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Retry upload" }).click(); // succeeds
await page.getByText(/uploaded successfully/).waitFor({ timeout: 20000 });
check("J3 retries after a lost response saved the document once", docCount() === 1, `rows=${docCount()} attempts=${attempt}`);
await page.unroute("**/api/admin/customer-documents/upload");

// Refresh, then log out and back in: the document is still listed and downloadable.
await page.reload({ waitUntil: "networkidle" });
await openDocuments();
await page.getByText("electricity-bill.pdf").first().waitFor({ timeout: 20000 });
check("J3 document visible after refresh", true);
await page.getByRole("button", { name: /log ?out|sign out/i }).first().click().catch(async () => { await page.evaluate(() => localStorage.clear()); });
await page.waitForTimeout(800);
await staffLogin(page, "t_admin");
await openDocuments();
const docLink = page.getByText("electricity-bill.pdf").first();
await docLink.waitFor({ timeout: 20000 });
await docLink.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/j3-02-document-after-relogin.png` });
const fileUrl = sql(`select file_url from customer_documents where customer_id='${ids.customerId}' and document_type='electricity_bill' order by uploaded_at desc limit 1`);
const dl = await page.request.get(new URL(fileUrl, BASE).href);
check("J3 document downloads after re-login", dl.status() === 200 && (await dl.body()).subarray(0, 5).toString() === "%PDF-", String(dl.status()));

// Cross-customer and permission checks.
const sales = await apiLogin("t_sales"), portalA = await apiLogin("t_portal_a"), portalB = await apiLogin("t_portal_b");
const get = (token, path) => fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } });
check("J8 sales user cannot list another client's documents", [403].includes((await get(sales, `/api/admin/customer-documents/${ids.customerId}`)).status));
check("J8 portal customer cannot call the staff document list", (await get(portalB, `/api/admin/customer-documents/${ids.customerId}`)).status === 403);
const docsA = await (await get(portalA, "/api/customer-portal/documents/me")).json();
const docsB = await (await get(portalB, "/api/customer-portal/documents/me")).json();
const listA = JSON.stringify(docsA), listB = JSON.stringify(docsB);
check("J8 portal customer A sees their own document", listA.includes("electricity-bill.pdf"));
check("J8 portal customer B cannot see customer A's document", !listB.includes("electricity-bill.pdf"));
check("J8 unauthenticated request to a staff API is refused", (await fetch(`${BASE}/api/admin/customer-documents/${ids.customerId}`)).status === 401);
check("J8 unauthenticated request for quotation versions is refused", (await fetch(`${BASE}/api/leads/${ids.leadId}/smart-quote-versions`)).status === 401);
check("J8 portal customer cannot read staff quotation versions", (await get(portalA, `/api/leads/${ids.leadId}/smart-quote-versions`)).status === 403);

await browser.close();
save(`${STATE}/j3-results.json`);
