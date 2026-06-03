/**
 * Apply Phase 4 schema to the Supabase project in SUPABASE_URL.
 * Uses direct Postgres (same pattern as scripts/sync-users-supabase.mjs).
 *
 * Production example:
 *   SUPABASE_URL=https://xxtdfvgkurxabpbmjban.supabase.co \
 *   SUPABASE_DB_PASSWORD='your-db-password' \
 *   node scripts/apply-client-portal-phase4-schema.mjs
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, ".env.production") });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const sqlPath = path.join(__dirname, "client-portal-phase4-schema.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function main() {
  if (!url) {
    console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL).");
    process.exit(1);
  }
  if (!dbPassword) {
    console.error("Missing SUPABASE_DB_PASSWORD.");
    console.error("Run scripts/client-portal-phase4-schema.sql in Supabase SQL Editor instead.");
    process.exit(1);
  }

  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.error("Install pg: npm install pg --no-save");
    process.exit(1);
  }

  const ref = new URL(url.replace(/\/rest\/v1\/?$/, "")).hostname.split(".")[0];
  const client = new pg.default.Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      "select to_regclass('public.service_requests') as reg"
    );
    const ok = Boolean(rows[0]?.reg);
    console.log(ok ? "OK: public.service_requests exists" : "FAIL: table still missing");
    process.exit(ok ? 0 : 1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
