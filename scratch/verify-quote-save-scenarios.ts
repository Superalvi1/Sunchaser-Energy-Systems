/**
 * Verifies quote-save scenarios: 3-item quote, second quote, two leads.
 * Run: npx tsx scratch/verify-quote-save-scenarios.ts
 */
import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

import dotenv from "dotenv";
import fs from "fs";
import {
  generateQuotationId,
  getSupabase,
  isSupabaseActive,
  persistQuotationToSupabase,
} from "../dbManager.ts";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

function threeItemQuote(id: string) {
  return {
    id,
    systemSizekW: 7.2,
    panelCount: 12,
    panelType: "Test Panel",
    inverterType: "Test Inverter",
    batteryCapacity: "",
    totalCost: 250000,
    federalTaxCredit: 0,
    netCost: 250000,
    estimatedAnnualSavings: 50000,
    paybackPeriodYears: 5,
    status: "Pending",
    structureType: "Standard",
    accessories: "Test",
    installationCharges: 75000,
    netMeteringCharges: 90000,
    paymentTerms: "Test",
    warrantyTerms: "Test",
    termsAndConditions: "Test",
    boqRows: [
      { type: "item", description: "Panels", qty: 12, rate: 10000, amount: 120000 },
      { type: "item", description: "Inverter", qty: 1, rate: 80000, amount: 80000 },
      { type: "item", description: "Installation", qty: 1, rate: 50000, amount: 50000 },
    ],
    quote_type: "manual_boq",
    source: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!isSupabaseActive()) {
    console.error("FAIL: Supabase not configured");
    process.exit(1);
  }

  const supabase = getSupabase()!;
  const { data: leads, error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .limit(2);

  if (leadErr || !leads || leads.length < 2) {
    console.error("FAIL: need at least 2 leads:", leadErr?.message);
    process.exit(1);
  }

  const [leadA, leadB] = leads;
  const inserted: string[] = [];

  const quote1Id = generateQuotationId();
  const quote1 = threeItemQuote(quote1Id);
  const r1 = await persistQuotationToSupabase(
    supabase,
    leadA.id,
    `cust-${leadA.id.replace("lead-", "")}`,
    quote1,
    "insert"
  );
  if (!r1.ok) {
    console.error("FAIL: 3-item quote insert:", r1.error);
    process.exit(1);
  }
  inserted.push(r1.quoteId!);
  console.log(`PASS: 3-item manual quote saved → ${r1.quoteId}`);

  const quote2Id = generateQuotationId();
  const quote2 = threeItemQuote(quote2Id);
  const r2 = await persistQuotationToSupabase(
    supabase,
    leadA.id,
    `cust-${leadA.id.replace("lead-", "")}`,
    quote2,
    "insert"
  );
  if (!r2.ok) {
    console.error("FAIL: second quote insert:", r2.error);
    process.exit(1);
  }
  if (r2.quoteId === r1.quoteId) {
    console.error("FAIL: second quote reused id", r2.quoteId);
    process.exit(1);
  }
  inserted.push(r2.quoteId!);
  console.log(`PASS: second quote on same lead → ${r2.quoteId} (distinct from ${r1.quoteId})`);

  const quote3Id = generateQuotationId();
  const quote3 = threeItemQuote(quote3Id);
  const r3 = await persistQuotationToSupabase(
    supabase,
    leadB.id,
    `cust-${leadB.id.replace("lead-", "")}`,
    quote3,
    "insert"
  );
  if (!r3.ok) {
    console.error("FAIL: quote on second lead:", r3.error);
    process.exit(1);
  }
  const allIds = [r1.quoteId, r2.quoteId, r3.quoteId];
  if (new Set(allIds).size !== 3) {
    console.error("FAIL: id clash across leads:", allIds.join(", "));
    process.exit(1);
  }
  inserted.push(r3.quoteId!);
  console.log(`PASS: quote on different lead (${leadB.id}) → ${r3.quoteId}`);

  const occupiedId = "q-2";
  const collisionQuote = threeItemQuote(occupiedId);
  const r4 = await persistQuotationToSupabase(
    supabase,
    leadA.id,
    `cust-${leadA.id.replace("lead-", "")}`,
    collisionQuote,
    "insert"
  );
  if (!r4.ok) {
    console.error("FAIL: pre-check/retry for occupied q-2:", r4.error);
    process.exit(1);
  }
  if (r4.quoteId === occupiedId) {
    console.error("FAIL: insert used occupied id q-2 without regenerating");
    process.exit(1);
  }
  inserted.push(r4.quoteId!);
  console.log(`PASS: occupied legacy id q-2 avoided → ${r4.quoteId}`);

  for (const id of inserted) {
    await supabase.from("quotations").delete().eq("id", id);
  }

  console.log("ALL SCENARIOS PASSED");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
