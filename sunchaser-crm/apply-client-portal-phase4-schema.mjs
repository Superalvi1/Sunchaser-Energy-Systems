/**
 * Apply Phase 4 schema to the Supabase project in SUPABASE_URL.
 * Requires direct Postgres access via SUPABASE_DB_URL (Dashboard → Settings → Database → Connection string).
 *
 * Example:
 *   SUPABASE_URL=https://xxtdfvgkurxabpbmjban.supabase.co \
 *   SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres" \
 *   node scripts/apply-client-portal-phase4-schema.mjs
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config();

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const sqlPath = path.join(__dirname, "client-portal-phase4-schema.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function main() {
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL (or DATABASE_URL).");
    console.error("Paste scripts/client-portal-phase4-schema.sql into Supabase SQL Editor instead.");
    process.exit(1);
  }

  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.error("Install pg: npm install pg --no-save");
    process.exit(1);
  }

  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      "select to_regclass('public.service_requests') as reg"
    );
    console.log("service_requests table:", rows[0]?.reg || "missing");
    process.exit(rows[0]?.reg ? 0 : 1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
