import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

let SUPABASE_URL = process.env.SUPABASE_URL || "";
if (SUPABASE_URL && SUPABASE_URL.endsWith("/rest/v1/")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - "/rest/v1/".length);
} else if (SUPABASE_URL && SUPABASE_URL.endsWith("/rest/v1")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - "/rest/v1".length);
}
if (SUPABASE_URL && SUPABASE_URL.endsWith("/")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - 1);
}

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase config missing.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("--- Fetching one row from quotations ---");
  const { data: qData, error: qErr } = await supabase
    .from("quotations")
    .select("*")
    .limit(1);

  if (qErr) {
    console.error("Error fetching quotations:", qErr.message);
  } else {
    console.log("Quotation Sample:", JSON.stringify(qData[0], null, 2));
  }

  console.log("\n--- Fetching one row from quote_template_pages ---");
  const { data: pData, error: pErr } = await supabase
    .from("quote_template_pages")
    .select("*")
    .eq("template_id", "tmpl-1")
    .eq("page_type", "cover")
    .limit(1);

  if (pErr) {
    console.error("Error fetching quote_template_pages:", pErr.message);
  } else {
    console.log("Template Cover Page Sample:", JSON.stringify(pData[0], null, 2));
  }

  console.log("\n--- Fetching another row from quote_template_pages with custom body structure ---");
  const { data: pData2, error: pData2Err } = await supabase
    .from("quote_template_pages")
    .select("*")
    .limit(10);
  
  if (pData2Err) {
    console.error("Error fetching quote_template_pages list:", pData2Err.message);
  } else {
    const customPage = pData2.find(p => p.body_text && p.body_text.startsWith("{"));
    if (customPage) {
      console.log("Custom Page Sample:", JSON.stringify(customPage, null, 2));
    } else {
      console.log("No page with serialized body_text JSON found. Printing first available page:", JSON.stringify(pData2[0], null, 2));
    }
  }
}

main();
