import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

let SUPABASE_URL = process.env.SUPABASE_URL || "";
if (SUPABASE_URL && SUPABASE_URL.endsWith("/rest/v1/")) {
  // Keep it with rest/v1 for spec fetch
} else {
  SUPABASE_URL = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/";
}

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function main() {
  console.log("Fetching OpenAPI spec from:", SUPABASE_URL);
  try {
    const res = await fetch(SUPABASE_URL, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!res.ok) {
      console.log("Failed to fetch spec. Status:", res.status);
      return;
    }
    const spec: any = await res.json();
    console.log("API Title:", spec.info?.title);
    const definitions = spec.definitions || {};
    const tables = Object.keys(definitions);
    console.log("Found tables in schema cache:", tables);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
