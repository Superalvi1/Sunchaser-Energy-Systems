import fs from "fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = new URL("..", import.meta.url).pathname;
dotenv.config({ path: `${root}/.env.local` });

const APP_ROLE = { raza: "Technical CEO", sales: "Sales Advisor" };
function resolveAppUserRole(username, dbRole) {
  return APP_ROLE[String(username).toLowerCase()] || dbRole;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

const expected = [
  { username: "allauddin", role: "Super Admin" },
  { username: "raza", role: "Technical CEO" },
  { username: "sales", role: "Sales Advisor" },
];

let pass = 0;
for (const exp of expected) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", exp.username)
    .eq("password", "123");
  if (error) throw error;
  const row = data?.[0];
  const appRole = resolveAppUserRole(row?.username, row?.role);
  const ok = row && appRole === exp.role;
  console.log(`${ok ? "PASS" : "FAIL"}: ${exp.username} -> ${appRole} (expected ${exp.role})`);
  if (ok) pass++;
}
console.log(`\n${pass}/${expected.length} login role checks passed`);
process.exit(pass === expected.length ? 0 : 1);
