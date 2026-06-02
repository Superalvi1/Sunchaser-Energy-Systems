import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = new URL("..", import.meta.url).pathname;
dotenv.config({ path: `${root}/.env.local` });

const APP_ROLE = { raza: "Technical CEO", sales: "Sales Advisor" };
function resolveAppUserRole(username, dbRole) {
  return APP_ROLE[String(username).toLowerCase()] || dbRole;
}

const API =
  process.env.VITE_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "https://sunchaser-energy-systems.onrender.com";

async function login(username, password = "123") {
  const res = await fetch(`${API.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function portalMe(userId, username) {
  const res = await fetch(`${API.replace(/\/$/, "")}/api/customer-portal/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sunchaser-User-Id": userId,
      "X-Sunchaser-Username": username,
    },
    body: JSON.stringify({ userId, username }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const staff = [
  { username: "allauddin", role: "Super Admin" },
  { username: "raza", role: "Technical CEO" },
  { username: "sales", role: "Sales Advisor" },
];

let pass = 0;
let total = 0;

for (const exp of staff) {
  total++;
  const { ok, body } = await login(exp.username);
  const role = resolveAppUserRole(body.user?.username, body.user?.role);
  const good = ok && role === exp.role && role !== "Customer";
  console.log(`${good ? "PASS" : "FAIL"}: staff ${exp.username} -> ${role}`);
  if (good) pass++;

  total++;
  const denied = await portalMe(body.user?.id, body.user?.username);
  const blocked = denied.status === 403;
  console.log(`${blocked ? "PASS" : "FAIL"}: staff ${exp.username} blocked from portal API`);
  if (blocked) pass++;
}

total++;
const customerTry = await portalMe("u-allauddin", "allauddin");
const idorBlocked = customerTry.status === 403;
console.log(`${idorBlocked ? "PASS" : "FAIL"}: non-customer cannot use portal API as staff id`);
if (idorBlocked) pass++;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  const supabase = createClient(url, key);
  const { data: portalUsers } = await supabase
    .from("users")
    .select("*")
    .eq("role", "Customer")
    .limit(5);

  if (portalUsers?.length) {
    const u = portalUsers[0];
    total++;
    const loginRes = await login(u.username, u.password);
    const role = resolveAppUserRole(loginRes.body.user?.username, loginRes.body.user?.role);
    const loginOk = loginRes.ok && role === "Customer";
    console.log(`${loginOk ? "PASS" : "FAIL"}: customer ${u.username} login -> ${role}`);
    if (loginOk) pass++;

    if (loginRes.body.user?.id) {
      total++;
      const portalRes = await portalMe(loginRes.body.user.id, loginRes.body.user.username);
      const portalOk =
        portalRes.ok &&
        portalRes.body.tracker?.stages?.length === 11 &&
        typeof portalRes.body.tracker?.progressPercent === "number";
      console.log(
        `${portalOk ? "PASS" : "FAIL"}: customer portal payload (${portalRes.status})`
      );
      if (portalOk) pass++;
    }
  } else {
    console.log("SKIP: no Customer role users in Supabase (run client-portal-customer-user.sql)");
  }
} else {
  console.log("SKIP: Supabase credentials missing for customer DB checks");
}

console.log(`\n${pass}/${total} client portal checks passed`);
process.exit(pass === total ? 0 : 1);
