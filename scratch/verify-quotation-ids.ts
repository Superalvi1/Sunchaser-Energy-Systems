/**
 * Verifies quotation ID generation: 20 consecutive inserts must not collide.
 * Run: npx tsx scratch/verify-quotation-ids.ts
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

const COUNT = 20;

function minimalQuote(id: string) {
  return {
    id,
    systemSizekW: 5,
    panelCount: 10,
    panelType: "Test Panel",
    inverterType: "Test Inverter",
    batteryCapacity: "",
    totalCost: 100000,
    federalTaxCredit: 0,
    netCost: 100000,
    estimatedAnnualSavings: 50000,
    paybackPeriodYears: 2,
    status: "Pending",
    structureType: "Standard",
    accessories: "Test",
    installationCharges: 0,
    netMeteringCharges: 0,
    paymentTerms: "Test",
    warrantyTerms: "Test",
    termsAndConditions: "Test",
    boqRows: [{ type: "item", description: "Test item", qty: 1, rate: 100000, amount: 100000 }],
    quote_type: "manual_boq",
    source: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const ids = Array.from({ length: COUNT }, () => generateQuotationId());
  const unique = new Set(ids);
  if (unique.size !== COUNT) {
    console.error(`FAIL: generated ${COUNT} ids but only ${unique.size} are unique`);
    process.exit(1);
  }
  console.log(`PASS: ${COUNT} generated ids are locally unique`);
  console.log("Sample ids:", ids.slice(0, 3).join(", "));

  if (!isSupabaseActive()) {
    console.log("SKIP: Supabase not configured — local uniqueness check only");
    return;
  }

  const supabase = getSupabase()!;
  const { data: leads, error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .limit(1);

  if (leadErr || !leads?.length) {
    console.error("FAIL: could not find a lead for insert test:", leadErr?.message);
    process.exit(1);
  }

  const leadId = leads[0].id;
  const customerId = `cust-${leadId.replace("lead-", "")}`;
  const inserted: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < COUNT; i++) {
    const quote = minimalQuote(ids[i]);
    const result = await persistQuotationToSupabase(supabase, leadId, customerId, quote, "insert");
    if (result.ok) {
      inserted.push(ids[i]);
    } else {
      errors.push(`#${i + 1} ${ids[i]}: ${result.error}`);
    }
  }

  for (const id of inserted) {
    await supabase.from("quotations").delete().eq("id", id);
  }

  if (errors.length > 0) {
    console.error(`FAIL: ${errors.length}/${COUNT} Supabase inserts failed:`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }

  console.log(`PASS: ${COUNT} consecutive Supabase quotation inserts — no duplicate key errors`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
