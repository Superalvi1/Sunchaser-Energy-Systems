#!/usr/bin/env node
/**
 * Direct production cleanup via Supabase service role (no maintenance API).
 * Requires: VITE_SUPABASE_URL or SUPABASE_URL (production) + SUPABASE_SERVICE_ROLE_KEY (production)
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dir, "../.env.production") });
dotenv.config({ path: path.join(__dir, "../.env.local") });
dotenv.config({ path: path.join(__dir, "../.env") });

const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
const key = process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set production SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const TEST_INVOICE_IDS = [
  "inv-1780610594772", "inv-1780677584424", "inv-1780609122977", "inv-1780665613727",
  "inv-1780677562958", "inv-1780682080610", "inv-1780683626778", "inv-1780682452257",
];
const TEST_CUSTOMER_IDS = [
  "cust-inv-1780682959257", "cust-inv-1780682955310", "cust-inv-1780682962770",
  "cust-inv-1780683627836", "cust-inv-1780682452840", "cust-1780602651894",
  "cust-1780605337258", "cust-1780605406946", "cust-1780602657937", "cust-1780605409851", "cust-101",
];
const TEST_PORTAL_USER_IDS = [
  "u-portal-client", "u-1780602651894", "u-1780605337258",
  "u-1780605406946", "u-1780602657937", "u-1780605409851",
];
const TEST_DELIVERY_IDS = [
  "pd-1780591831517", "pd-1780593793245", "pd-1780594130933", "pd-1780690910581",
  "pd-1780593775488", "pd-1780594118970", "pd-1780594414012",
];
const SOFT_DELETE_LEAD_IDS = [
  "lead-42b45994-8a41-46ac-99b0-d07429bbc72c", "lead-5e1e73b7-671f-4fff-bed0-f75e80abfef1",
  "lead-7cdafe08-e631-4381-bc4e-1b4e5dec84d0", "lead-9249a28a-8384-4934-8995-924e3179e50b",
  "lead-f0571682-33d3-46cc-ae9d-df2805f417d3", "lead-8a996f63-d504-451c-9fac-031a738491b7",
  "lead-6d72d2f9-8836-4827-90a2-827d001f80c0", "lead-108", "lead-109",
  "lead-e01e6cf6-319c-4eaa-a032-9d7022e16154", "lead-4314aa36-80a4-40a7-89f6-4ef6e8e5a96b",
  "lead-4a867c6d-4ac5-400e-8286-10aa7ba95d39", "lead-ffea88b5-7eab-4d79-9d82-d96f212a3153",
  "lead-84b01c30-351e-469c-a3ba-11ac142f7874", "lead-101",
];

async function del(table, col, ids) {
  const { data, error } = await sb.from(table).delete().in(col, ids).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.length || 0;
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("Dry run — pass --apply to execute");
    return;
  }
  const deleted = {};
  deleted.invoice_payments = await del("invoice_payments", "invoice_id", TEST_INVOICE_IDS);
  deleted.invoice_items = await del("invoice_items", "invoice_id", TEST_INVOICE_IDS);
  deleted.invoices = await del("invoices", "id", TEST_INVOICE_IDS);
  try {
    deleted.project_completion_media = await del("project_completion_media", "delivery_id", TEST_DELIVERY_IDS);
  } catch (e) {
    deleted.project_completion_media = 0;
  }
  deleted.project_deliveries = await del("project_deliveries", "id", TEST_DELIVERY_IDS);
  deleted.customer_documents = await del("customer_documents", "id", ["doc-1780719697625"]);
  const { data: leads, error: leadErr } = await sb
    .from("leads")
    .update({ deleted_at: new Date().toISOString(), deleted_by: "cleanup-20260606" })
    .in("id", SOFT_DELETE_LEAD_IDS)
    .is("deleted_at", null)
    .select("id");
  if (leadErr) throw leadErr;
  deleted.leads_soft_deleted = leads?.length || 0;
  deleted.users = await del("users", "id", TEST_PORTAL_USER_IDS);
  deleted.customers = await del("customers", "id", TEST_CUSTOMER_IDS);
  console.log(JSON.stringify(deleted, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
