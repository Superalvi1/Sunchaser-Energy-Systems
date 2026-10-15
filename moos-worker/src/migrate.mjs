import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Isolated schema: never create wa_* tables in public, because staging has
// other CRM/WhatsApp services sharing the Postgres instance.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required for Moos worker migration.");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("CREATE SCHEMA IF NOT EXISTS moos_worker");
  await client.query("SET LOCAL search_path TO moos_worker, public");
  const sql = await readFile(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");
  await client.query(sql);
  const { rows } = await client.query("SELECT to_regclass('moos_worker.wa_inbound') AS inbox, to_regclass('moos_worker.wa_chat') AS chat");
  if (!rows[0]?.inbox || !rows[0]?.chat) throw new Error("Moos worker schema verification failed");
  await client.query("COMMIT");
  console.log("[moos] isolated staging worker schema verified");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
