/**
 * Replace demo users in Supabase with production accounts from database.json.
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

const KEEP_USERNAMES = new Set(["allauddin", "raza", "sales"]);

/** Legacy Supabase check constraint roles until migrate-user-roles.sql is applied. */
function toStorageRole(role) {
  if (role === "Technical CEO") return "Sales Manager";
  if (role === "Sales Advisor") return "Sales Executive";
  return role;
}

async function migrateRoleConstraint(supabase, url) {
  const sql = `
    alter table public.users drop constraint if exists users_role_check;
    alter table public.users add constraint users_role_check check (role in (
      'Super Admin', 'Technical CEO', 'Sales Advisor',
      'Admin', 'Sales Manager', 'Sales Executive',
      'Inventory Manager', 'Support Agent', 'Technician',
      'Survey Engineer', 'Installation Team', 'Customer'
    ));
  `;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    console.warn("SUPABASE_DB_PASSWORD not set — skipping DDL. Run scripts/migrate-user-roles.sql in Supabase SQL editor if role upsert fails.");
    return false;
  }
  const ref = new URL(url).hostname.split(".")[0];
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("Updated users_role_check constraint.");
  return true;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const users = raw.users || [];
  if (users.length !== 3) {
    console.warn(`Expected 3 users in database.json, found ${users.length}`);
  }

  const supabase = createClient(url, key);

  await migrateRoleConstraint(supabase, url);

  const { data: existing, error: listErr } = await supabase.from("users").select("id, username");
  if (listErr) throw listErr;

  for (const row of existing || []) {
    const un = String(row.username || "").toLowerCase();
    if (!KEEP_USERNAMES.has(un)) {
      const { error } = await supabase.from("users").delete().eq("id", row.id);
      if (error) throw error;
      console.log(`Removed demo user: ${row.username} (${row.id})`);
    }
  }

  for (const u of users) {
    const username = String(u.username).toLowerCase();
    const payload = {
      id: u.id,
      username,
      password: u.password,
      name: u.name,
      email: u.email,
      role: toStorageRole(u.role),
    };

    const { data: sameName } = await supabase.from("users").select("id").eq("username", username);
    for (const row of sameName || []) {
      if (row.id !== u.id) {
        const { error: delErr } = await supabase.from("users").delete().eq("id", row.id);
        if (delErr) throw delErr;
        console.log(`Removed duplicate username row: ${username} (${row.id})`);
      }
    }

    const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
    if (error) throw error;
    console.log(`Upserted: ${payload.username} (${payload.role})`);
  }

  console.log("Supabase users sync complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
