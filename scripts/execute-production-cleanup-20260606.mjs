#!/usr/bin/env node
/**
 * Execute approved production cleanup (backup → delete → verify).
 * Usage:
 *   node scripts/execute-production-cleanup-20260606.mjs
 *   SUPABASE_DB_URL=postgresql://... node scripts/execute-production-cleanup-20260606.mjs --backup-only
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dir, "..");
dotenv.config({ path: path.join(root, ".env.production") });
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const API = (
  process.env.API_BASE ||
  process.env.VITE_API_BASE_URL ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");
const CONFIRM = "cleanup-20260606";
const STAFF_USER = process.env.VERIFY_STAFF_USER || "allauddin";
const STAFF_PASS = process.env.VERIFY_STAFF_PASS || "123";
const backupOnly = process.argv.includes("--backup-only");
const skipBackup = process.argv.includes("--skip-backup");

async function loginStaff() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: STAFF_USER, password: STAFF_PASS }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff login failed");
  return data.user;
}

function staffHeaders(staff) {
  return {
    "Content-Type": "application/json",
    "x-sunchaser-user-id": staff.id,
    "x-sunchaser-username": staff.username,
    "x-sunchaser-role": staff.role,
  };
}

async function runBackupViaPg() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const sqlPath = path.join(__dir, "production-backup-20260606.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  let password = process.env.SUPABASE_DB_PASSWORD;
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(
    /\/rest\/v1\/?$/,
    ""
  );
  const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : "";

  const { default: pg } = await import("pg");
  const client = dbUrl
    ? new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    : password && ref
      ? new pg.Client({
          host: `db.${ref}.supabase.co`,
          port: 5432,
          database: "postgres",
          user: "postgres",
          password,
          ssl: { rejectUnauthorized: false },
        })
      : null;

  if (!client) return null;

  await client.connect();
  try {
    await client.query(sql);
    const tables = [
      "leads_backup_20260606",
      "customers_backup_20260606",
      "invoices_backup_20260606",
      "invoice_items_backup_20260606",
      "invoice_payments_backup_20260606",
      "customer_documents_backup_20260606",
      "project_deliveries_backup_20260606",
      "project_completion_media_backup_20260606",
      "quotations_backup_20260606",
      "support_tickets_backup_20260606",
      "users_backup_20260606",
    ];
    const counts = {};
    for (const t of tables) {
      const { rows } = await client.query(`select count(*)::text as c from public.${t}`);
      counts[t] = Number(rows[0]?.c || 0);
    }
    return { method: "pg", counts };
  } finally {
    await client.end();
  }
}

async function postMaintenance(staff, pathSuffix, body = {}) {
  const res = await fetch(`${API}/api/admin/maintenance/${pathSuffix}`, {
    method: "POST",
    headers: staffHeaders(staff),
    body: JSON.stringify({ confirm: CONFIRM, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getCounts(staff) {
  const [state, inv, parties, deliveries, deleted, users] = await Promise.all([
    fetch(`${API}/api/state`, { headers: staffHeaders(staff) }).then((r) => r.json()),
    fetch(`${API}/api/admin/invoices`, { headers: staffHeaders(staff) }).then((r) => r.json()),
    fetch(`${API}/api/admin/parties`, { headers: staffHeaders(staff) }).then((r) => r.json()),
    fetch(`${API}/api/admin/project-deliveries`, { headers: staffHeaders(staff) }).then((r) => r.json()),
    fetch(`${API}/api/leads/deleted`, { headers: staffHeaders(staff) }).then((r) => r.json()),
    fetch(`${API}/api/admin/users`, { headers: staffHeaders(staff) }).then((r) => r.json()),
  ]);
  return {
    activeLeads: (state.leads || []).length,
    invoices: (inv.invoices || []).length,
    parties: (parties.parties || []).length,
    deliveries: (deliveries.deliveries || deliveries || []).length,
    deletedLeads: (deleted.leads || []).length,
    users: (users.users || users || []).length,
  };
}

async function verifyFlows(staff) {
  const headers = staffHeaders(staff);
  const checks = [];

  async function check(name, ok, detail) {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
  }

  const state = await fetch(`${API}/api/state`, { headers }).then((r) => r.json());
  await check("Leads page (/api/state)", Array.isArray(state.leads), `${state.leads?.length || 0} active leads`);

  const suffix = Date.now();
  const createLead = await fetch(`${API}/api/leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `PostCleanupVerify-${suffix}`,
      email: `post-cleanup-${suffix}@verify.local`,
      phone: `0300${String(suffix).slice(-7)}`,
      location: "Lahore",
      monthlyUnits: 500,
      leadSource: "Self-registration Web Portal",
    }),
  });
  const created = await createLead.json().catch(() => ({}));
  await check(
    "Add Solar Lead",
    createLead.status === 201 && created.lead?.id,
    createLead.status === 201 ? created.lead.id : JSON.stringify(created).slice(0, 120)
  );
  if (created.lead?.id) {
    await fetch(`${API}/api/leads/${created.lead.id}`, {
      method: "DELETE",
      headers,
    });
  }

  const inv = await fetch(`${API}/api/admin/invoices`, { headers }).then((r) => r.json());
  await check("Invoice page", Array.isArray(inv.invoices), `${inv.invoices?.length || 0} invoices`);

  const parties = await fetch(`${API}/api/admin/parties`, { headers }).then((r) => r.json());
  await check("Party Ledger", Array.isArray(parties.parties), `${parties.parties?.length || 0} parties`);

  const fin = await fetch(`${API}/api/admin/finance/dashboard`, { headers }).then((r) => r.json());
  await check("Finance Dashboard", fin.summary != null || fin.dashboard != null || fin.ok === true || !fin.error, fin.error || "loaded");

  const ops = await fetch(`${API}/api/admin/operations/dashboard`, { headers }).then((r) => r.json());
  await check(
    "Project Operations",
    ops.projects != null || ops.dashboard != null || !ops.error,
    ops.error || `projects=${ops.projects?.length ?? "ok"}`
  );

  const accounts = await fetch(`${API}/api/admin/customer-accounts`, { headers }).then((r) => r.json());
  await check("Customer Portal accounts", Array.isArray(accounts.accounts), `${accounts.accounts?.length || 0} accounts`);

  const docs = await fetch(`${API}/api/admin/customer-documents/cust-1780604494102`, { headers }).then((r) =>
    r.json()
  );
  await check(
    "Document upload (read path)",
    Array.isArray(docs.documents) || docs.documents == null,
    `shafiq docs=${docs.documents?.length ?? 0}`
  );

  return checks;
}

async function main() {
  console.log(`\n=== Production cleanup executor → ${API} ===\n`);
  const staff = await loginStaff();
  const report = { backup: null, cleanup: null, before: null, after: null, verify: null };

  report.before = await getCounts(staff);
  console.log("Before:", report.before);

  if (!skipBackup) {
    let backup = await runBackupViaPg();
    if (!backup) {
      console.log("Local pg unavailable — trying maintenance backup API...");
      const apiBackup = await postMaintenance(staff, "production-backup-20260606");
      if (apiBackup.status !== 200) {
        throw new Error(apiBackup.data?.error || `Backup API failed (${apiBackup.status})`);
      }
      backup = { method: "api", counts: apiBackup.data.counts, tables: apiBackup.data.backupTables };
    }
    report.backup = backup;
    console.log("Backup OK:", JSON.stringify(backup, null, 2));
  }

  if (backupOnly) {
    console.log("\n--backup-only: stopping before delete.\n");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const cleanup = await postMaintenance(staff, "production-cleanup-20260606");
  if (cleanup.status !== 200) {
    throw new Error(cleanup.data?.error || `Cleanup API failed (${cleanup.status})`);
  }
  report.cleanup = cleanup.data;
  console.log("Cleanup OK:", JSON.stringify(cleanup.data, null, 2));

  report.after = await getCounts(staff);
  console.log("After:", report.after);

  console.log("\n=== Post-cleanup verification ===\n");
  report.verify = await verifyFlows(staff);

  const failed = report.verify.filter((c) => !c.ok).length;
  console.log(`\n=== Done: verify ${report.verify.length - failed}/${report.verify.length} passed ===\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
