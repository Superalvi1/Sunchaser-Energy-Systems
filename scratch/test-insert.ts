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

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  console.log("Supabase URL:", SUPABASE_URL);
  
  console.log("\nTrying to insert into quote_templates...");
  const res = await supabase.from("quote_templates").insert({
    id: "test-template-id",
    name: "Test Template",
    is_active: true
  });
  console.log("Insert response error:", res.error);
  console.log("Insert response status:", res.status);
}

main();
