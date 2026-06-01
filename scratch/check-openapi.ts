import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

let SUPABASE_URL = process.env.SUPABASE_URL || "";
if (!SUPABASE_URL.endsWith("/rest/v1/")) {
  if (SUPABASE_URL.endsWith("/")) {
    SUPABASE_URL += "rest/v1/";
  } else {
    SUPABASE_URL += "/rest/v1/";
  }
}
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

async function main() {
  const url = SUPABASE_URL;
  console.log("Fetching OpenAPI spec from:", url);
  
  try {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    
    if (!res.ok) {
      console.error(`HTTP error! status: ${res.status}`);
      const txt = await res.text();
      console.error("Response body:", txt);
      return;
    }
    
    const spec: any = await res.json();
    console.log("--- Definitions/Tables found in schema cache ---");
    const definitions = Object.keys(spec.definitions || {});
    console.log(definitions.join(", "));
    
    if (spec.definitions?.quotations) {
      console.log("\n--- Properties of quotations ---");
      console.log(Object.keys(spec.definitions.quotations.properties || {}));
    } else {
      console.log("\nQuotations table definition not found in spec.");
    }
  } catch (e: any) {
    console.error("Fetch error:", e.message);
  }
}

main();
