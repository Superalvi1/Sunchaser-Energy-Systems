import assert from "node:assert/strict";
import { test } from "node:test";

test("CRM boot retains customer linkage; customer document upload and retry persist a visible proposal", async () => {
  process.env.RAILWAY_POSTGREST_URL = "http://test-postgrest.railway.internal:3000";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.RAILWAY_S3_ENDPOINT = "https://storage.example.test";
  process.env.RAILWAY_S3_BUCKET = "test-bucket";
  process.env.RAILWAY_S3_ACCESS_KEY_ID = "test-access";
  process.env.RAILWAY_S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.RAILWAY_OBJECT_PROXY_SECRET = "test-proxy-secret";
  process.env.APP_PUBLIC_URL = "https://crm.example.test";
  const originalFetch = globalThis.fetch;
  const lead: any = { id: "lead-fixture", customer_id: "cust-fixture", name: "Client", phone: "923004415484", created_at: new Date().toISOString(), notes: "SMART_QUOTE_V1\nQuote: SES-20261005-1234", lead_source: "Smart Quote" };
  let storageFails = false, uploadBytes = 0;
  const documents: any[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.hostname.endsWith("storage.example.test")) {
      uploadBytes = (await request.arrayBuffer()).byteLength;
      return new Response(storageFails ? "storage unavailable" : "", { status: storageFails ? 503 : 200 });
    }
    let result: any = [];
    if (url.pathname === "/leads") {
      if (request.method === "PATCH") Object.assign(lead, await request.json());
      result = [lead];
    } else if (url.pathname === "/users") result = [{ id: "staff", username: "admin-fixture", role: "Admin" }];
    else if (url.pathname === "/customer_documents") {
      if (request.method === "POST") documents.push(await request.json());
      result = documents;
    }
    if (request.headers.get("accept")?.includes("vnd.pgrst.object")) result = result[0] || null;
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const { fetchAppStateFromSupabase } = await import("../../dbManager");
    const { uploadFileToCustomerStorage, assignCustomerDocument, listAdminCustomerDocuments, prepareLeadCustomerProfile } = await import("../../customerProfileDb");
    const state = await fetchAppStateFromSupabase();
    assert.equal(state.leads[0].customerId, "cust-fixture", "customer_id must survive the full CRM boot mapper");
    assert.equal(state.leads[0].leadSource, "Smart Quote");
    const linked = await prepareLeadCustomerProfile("staff", "admin-fixture", "Admin", lead.id);
    assert.equal(linked.customerId, "cust-fixture", "existing link must be reused");
    await assert.rejects(() => prepareLeadCustomerProfile("staff", "admin-fixture", "Customer", lead.id), /Admin access/);
    const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
    storageFails = true;
    await assert.rejects(() => uploadFileToCustomerStorage("cust-fixture", `data:application/octet-stream;base64,${pdf.toString("base64")}`, "quote.pdf", "application/pdf"));
    assert.equal(documents.length, 0, "failed upload must not claim a saved proposal");
    storageFails = false;
    const uploaded = await uploadFileToCustomerStorage("cust-fixture", `data:application/octet-stream;base64,${pdf.toString("base64")}`, "quote.pdf", "application/pdf");
    assert.equal(uploadBytes, pdf.length);
    const saved = await assignCustomerDocument("staff", "admin-fixture", "Admin", { customerId: "cust-fixture", documentType: "quotation_pdf", title: "Client quotation", fileUrl: uploaded.url, storagePath: uploaded.storagePath, fileName: "quote.pdf" });
    const visible = await listAdminCustomerDocuments("staff", "admin-fixture", "Admin", "cust-fixture");
    assert.equal(visible.length, 1); assert.equal(visible[0].id, saved.id);
    assert.equal(visible[0].documentType, "quotation_pdf"); assert.equal(visible[0].visibleToCustomer, true);
    assert.match(visible[0].fileUrl, /^https:\/\/crm.example.test\/api\/storage\/object\//);
    await assert.rejects(() => uploadFileToCustomerStorage("cust-fixture", Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64"), "quote.pdf", "application/pdf"), /25 MB/);
  } finally { globalThis.fetch = originalFetch; }
});
