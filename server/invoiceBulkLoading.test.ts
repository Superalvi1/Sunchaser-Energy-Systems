import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const calls: string[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);

  if (url.includes("/invoice_items")) {
    return new Response(
      JSON.stringify([
        {
          id: "item-1",
          invoice_id: "inv-1",
          sort_order: 0,
          description: "Panel",
          qty: 2,
          unit: "pcs",
          rate: 100,
          tax_percent: 0,
          discount_amount: 0,
          line_total: 200,
        },
        {
          id: "item-2",
          invoice_id: "inv-2",
          sort_order: 0,
          description: "Inverter",
          qty: 1,
          unit: "pcs",
          rate: 300,
          tax_percent: 0,
          discount_amount: 0,
          line_total: 300,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (url.includes("/invoice_payments")) {
    return new Response(
      JSON.stringify([
        {
          id: "pay-1",
          invoice_id: "inv-1",
          amount: 50,
          payment_method: "Cash",
          payment_date: "2026-09-01",
          created_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "pay-2",
          invoice_id: "inv-2",
          amount: 125,
          payment_method: "Bank transfer",
          payment_date: "2026-09-02",
          created_at: "2026-09-02T00:00:00Z",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const { hydrateInvoiceRows } = await import("../invoiceDb.ts");
  const invoices = await hydrateInvoiceRows([
    {
      id: "inv-1",
      invoice_number: "1",
      invoice_date: "2026-09-01",
      customer_name: "Customer One",
      grand_total: 200,
      paid_amount: 50,
      balance_due: 150,
    },
    {
      id: "inv-2",
      invoice_number: "2",
      invoice_date: "2026-09-02",
      customer_name: "Customer Two",
      grand_total: 300,
      paid_amount: 125,
      balance_due: 175,
    },
  ]);

  assert.equal(calls.length, 2, "bulk hydration must use exactly two related-row queries");
  assert.equal(calls.filter((url) => url.includes("/invoice_items")).length, 1);
  assert.equal(calls.filter((url) => url.includes("/invoice_payments")).length, 1);
  assert.ok(calls.every((url) => url.includes("invoice_id=in.")));
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].items.length, 1);
  assert.equal(invoices[0].items[0].description, "Panel");
  assert.equal(invoices[0].payments.length, 1);
  assert.equal(invoices[0].payments[0].amount, 50);
  assert.equal(invoices[1].items[0].description, "Inverter");
  assert.equal(invoices[1].payments[0].amount, 125);
  console.log("invoice bulk-loading tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
