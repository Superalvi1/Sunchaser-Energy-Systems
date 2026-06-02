/**
 * Remove development/demo/test leads from database.json and Supabase.
 * Preserves users, templates, settings, products, quotation structures.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dbPath = path.join(root, "database.json");

dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const DEMO_PATTERNS = [
  /arthur\s*dent/i,
  /alvidon/i,
  /new1\s*test/i,
  /new1test/i,
  /^test1$/i,
  /sunchaser-test/i,
  /^lead-test-/i,
  /\bdemo\b/i,
  /\bsample\b/i,
  /\bmock\b/i,
  /galaxy\.com/i,
  /hitchhiker/i,
  /milliways/i,
  /validation\s*lead/i,
  /quote\s*validation/i,
  /@test\.local$/i,
  /pdf@test/i,
  /quote-val@test/i,
];

function isDemoLead(lead) {
  const hay = [lead?.id, lead?.name, lead?.email, lead?.phone, lead?.notes]
    .filter(Boolean)
    .join(" ");
  return DEMO_PATTERNS.some((p) => p.test(hay));
}

function isDemoLogEntry(entry) {
  const hay = [
    entry?.userName,
    entry?.customerName,
    entry?.details,
    entry?.messageText,
    entry?.leadId,
  ]
    .filter(Boolean)
    .join(" ");
  return DEMO_PATTERNS.some((p) => p.test(hay)) || /lead-(1|104|105)\b/.test(hay) || /lead-test-/.test(hay);
}

function getSupabase() {
  let url = process.env.SUPABASE_URL || "";
  if (url.endsWith("/rest/v1/")) url = url.slice(0, -9);
  else if (url.endsWith("/rest/v1")) url = url.slice(0, -8);
  if (url.endsWith("/")) url = url.slice(0, -1);
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteLeadFromSupabase(supabase, id) {
  const childTables = [
    "quotations",
    "projects",
    "site_surveys",
    "installation_tasks",
    "net_metering_trackers",
    "payments",
  ];
  for (const table of childTables) {
    const { error } = await supabase.from(table).delete().eq("lead_id", id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error, count } = await supabase
    .from("leads")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw new Error(`leads: ${error.message}`);
  return count ?? 0;
}

function cleanLocalDatabase() {
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const removedLeads = (db.leads || []).filter(isDemoLead);
  const removedIds = new Set(removedLeads.map((l) => l.id));

  db.leads = (db.leads || []).filter((l) => !isDemoLead(l));
  db.projects = (db.projects || []).filter((p) => !removedIds.has(p.leadId));

  for (const id of removedIds) {
    if (db.netMeteringTrackers?.[id]) delete db.netMeteringTrackers[id];
    if (db.paymentTracks?.[id]) delete db.paymentTracks[id];
  }

  if (Array.isArray(db.activityLogs)) {
    db.activityLogs = db.activityLogs.filter((e) => !isDemoLogEntry(e));
  }
  if (Array.isArray(db.whatsAppLogs)) {
    db.whatsAppLogs = db.whatsAppLogs.filter((e) => !isDemoLogEntry(e));
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n");
  return { removedLeads, leadCount: db.leads.length };
}

async function cleanSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase.from("leads").select("id,name,email");
  if (error) throw error;

  const toRemove = (data || []).filter(isDemoLead);
  const results = [];
  for (const lead of toRemove) {
    const count = await deleteLeadFromSupabase(supabase, lead.id);
    results.push({ id: lead.id, name: lead.name, deletedRows: count });
  }
  return results;
}

const local = cleanLocalDatabase();
console.log("Local database.json:");
console.log("  Removed leads:", local.removedLeads.map((l) => `${l.id} (${l.name})`));
console.log("  Remaining leads:", local.leadCount);

const supabaseResults = await cleanSupabase();
console.log("\nSupabase:");
for (const r of supabaseResults) {
  console.log(`  Deleted ${r.id} (${r.name}) rows=${r.deletedRows}`);
}
console.log(`  Total removed: ${supabaseResults.length}`);
