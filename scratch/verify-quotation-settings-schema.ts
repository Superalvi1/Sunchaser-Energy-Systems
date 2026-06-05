/**
 * Verifies quotation settings tables exist in Supabase.
 * Run: npx tsx scratch/verify-quotation-settings-schema.ts
 */
import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

import dotenv from "dotenv";
import fs from "fs";
import { getSupabase, isSupabaseActive } from "../dbManager.ts";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

const TABLES = [
  "quote_templates",
  "quote_template_pages",
  "bank_accounts",
  "company_terms",
  "ceo_messages",
  "structure_descriptions",
  "quote_pdf_settings",
  "social_links",
];

async function main() {
  if (!isSupabaseActive()) {
    console.error("FAIL: Supabase not configured");
    process.exit(1);
  }

  const supabase = getSupabase()!;
  const missing: string[] = [];

  for (const table of TABLES) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.error(`MISSING: ${table} — ${error.message}`);
      missing.push(table);
    } else {
      console.log(`OK: ${table}`);
    }
  }

  if (missing.length > 0) {
    console.error(`\nFAIL: ${missing.length} table(s) missing. Run scripts/quotation-settings-schema.sql in Supabase SQL Editor.`);
    process.exit(1);
  }

  console.log(`\nPASS: all ${TABLES.length} quotation settings tables exist`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
