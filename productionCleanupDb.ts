import fs from "fs";
import path from "path";
import { getSupabase } from "./dbManager.ts";

export const CLEANUP_CONFIRM_TOKEN = "cleanup-20260606";

export const TEST_INVOICE_IDS = [
  "inv-1780610594772",
  "inv-1780677584424",
  "inv-1780609122977",
  "inv-1780665613727",
  "inv-1780677562958",
  "inv-1780682080610",
  "inv-1780683626778",
  "inv-1780682452257",
] as const;

export const TEST_CUSTOMER_IDS = [
  "cust-inv-1780682959257",
  "cust-inv-1780682955310",
  "cust-inv-1780682962770",
  "cust-inv-1780683627836",
  "cust-inv-1780682452840",
  "cust-1780602651894",
  "cust-1780605337258",
  "cust-1780605406946",
  "cust-1780602657937",
  "cust-1780605409851",
  "cust-101",
] as const;

export const TEST_PORTAL_USER_IDS = [
  "u-portal-client",
  "u-1780602651894",
  "u-1780605337258",
  "u-1780605406946",
  "u-1780602657937",
  "u-1780605409851",
] as const;

export const TEST_DELIVERY_IDS = [
  "pd-1780591831517",
  "pd-1780593793245",
  "pd-1780594130933",
  "pd-1780690910581",
  "pd-1780593775488",
  "pd-1780594118970",
  "pd-1780594414012",
] as const;

export const SOFT_DELETE_LEAD_IDS = [
  "lead-42b45994-8a41-46ac-99b0-d07429bbc72c",
  "lead-5e1e73b7-671f-4fff-bed0-f75e80abfef1",
  "lead-7cdafe08-e631-4381-bc4e-1b4e5dec84d0",
  "lead-9249a28a-8384-4934-8995-924e3179e50b",
  "lead-f0571682-33d3-46cc-ae9d-df2805f417d3",
  "lead-8a996f63-d504-451c-9fac-031a738491b7",
  "lead-6d72d2f9-8836-4827-90a2-827d001f80c0",
  "lead-108",
  "lead-109",
  "lead-e01e6cf6-319c-4eaa-a032-9d7022e16154",
  "lead-4314aa36-80a4-40a7-89f6-4ef6e8e5a96b",
  "lead-4a867c6d-4ac5-400e-8286-10aa7ba95d39",
  "lead-ffea88b5-7eab-4d79-9d82-d96f212a3153",
  "lead-84b01c30-351e-469c-a3ba-11ac142f7874",
  "lead-101",
] as const;

export const TEST_DOCUMENT_IDS = ["doc-1780719697625"] as const;

export const BACKUP_SOURCE_PAIRS = [
  { source: "leads", backup: "leads_backup_20260606" },
  { source: "customers", backup: "customers_backup_20260606" },
  { source: "invoices", backup: "invoices_backup_20260606" },
  { source: "invoice_items", backup: "invoice_items_backup_20260606" },
  { source: "invoice_payments", backup: "invoice_payments_backup_20260606" },
  { source: "customer_documents", backup: "customer_documents_backup_20260606" },
  { source: "project_deliveries", backup: "project_deliveries_backup_20260606" },
  { source: "project_completion_media", backup: "project_completion_media_backup_20260606" },
  { source: "quotations", backup: "quotations_backup_20260606" },
  { source: "support_tickets", backup: "support_tickets_backup_20260606" },
  { source: "users", backup: "users_backup_20260606" },
] as const;

const BACKUP_TABLES = BACKUP_SOURCE_PAIRS.map((p) => p.backup);

async function getPgClient() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  let password = process.env.SUPABASE_DB_PASSWORD;
  let hostRef = "";

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  if (supabaseUrl) {
    try {
      hostRef = new URL(supabaseUrl).hostname.split(".")[0];
    } catch {
      hostRef = "";
    }
  }

  const { default: pg } = await import("pg");
  if (dbUrl) {
    return new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  }
  if (password && hostRef) {
    return new pg.Client({
      host: `db.${hostRef}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password,
      ssl: { rejectUnauthorized: false },
    });
  }
  return null;
}

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

async function requirePgClient(): Promise<PgClient> {
  const client = await getPgClient();
  if (!client) {
    throw new Error(
      "Direct Postgres unavailable. Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD on the server to run backup tables."
    );
  }
  await client.connect();
  return client;
}

async function countTable(client: PgClient, table: string) {
  const { rows } = await client.query(`select count(*)::text as count from public.${table}`);
  return Number(rows[0]?.count || 0);
}

async function countSourceTables(client: PgClient) {
  const sourceCounts: Record<string, number> = {};
  for (const { source } of BACKUP_SOURCE_PAIRS) {
    sourceCounts[source] = await countTable(client, source);
  }
  return sourceCounts;
}

async function countBackupTables(client: PgClient) {
  const counts: Record<string, number> = {};
  for (const { backup } of BACKUP_SOURCE_PAIRS) {
    counts[backup] = await countTable(client, backup);
  }
  return counts;
}

async function existingBackupTableCounts(client: PgClient) {
  const existing: Record<string, number | null> = {};
  for (const { backup } of BACKUP_SOURCE_PAIRS) {
    const { rows } = await client.query(`select to_regclass($1) as reg`, [`public.${backup}`]);
    existing[backup] = rows[0]?.reg ? await countTable(client, backup) : null;
  }
  return existing;
}

/** Read-only connectivity check — no DDL, no source mutations. */
export async function runProductionBackupDryRun20260606() {
  const client = await requirePgClient();
  try {
    await client.query("SELECT 1");
    const sourceCounts = await countSourceTables(client);
    const existingBackupCounts = await existingBackupTableCounts(client);
    return {
      dryRun: true,
      backupTables: [...BACKUP_TABLES],
      sourceCounts,
      existingBackupCounts,
    };
  } finally {
    await client.end();
  }
}

export async function runProductionBackup20260606() {
  const sqlPath = path.join(process.cwd(), "scripts", "production-backup-20260606.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = await requirePgClient();
  try {
    const sourceCountsBefore = await countSourceTables(client);
    const usersBackupBefore = await existingBackupTableCounts(client).then((m) => m.users_backup_20260606);
    await client.query(sql);
    const counts = await countBackupTables(client);
    const sourceCountsAfter = await countSourceTables(client);
    return {
      dryRun: false,
      backupTables: [...BACKUP_TABLES],
      counts,
      sourceCountsBefore,
      sourceCountsAfter,
      usersBackupBefore,
      usersBackupAfter: counts.users_backup_20260606,
    };
  } finally {
    await client.end();
  }
}

async function deleteByIds(table: string, column: string, ids: readonly string[]) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!ids.length) return 0;
  const { data, error } = await supabase.from(table).delete().in(column, [...ids]).select("id");
  if (error) throw new Error(`${table} delete failed: ${error.message}`);
  return data?.length || 0;
}

async function softDeleteLeads(ids: readonly string[]) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("leads")
    .update({ deleted_at: deletedAt, deleted_by: "cleanup-20260606" })
    .in("id", [...ids])
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(`leads soft delete failed: ${error.message}`);
  return data?.length || 0;
}

export async function runProductionCleanup20260606() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const deleted: Record<string, number> = {
    invoice_payments: 0,
    invoice_items: 0,
    invoices: 0,
    project_completion_media: 0,
    project_deliveries: 0,
    customer_documents: 0,
    leads_soft_deleted: 0,
    users: 0,
    customers: 0,
  };

  deleted.invoice_payments = await deleteByIds("invoice_payments", "invoice_id", TEST_INVOICE_IDS);
  deleted.invoice_items = await deleteByIds("invoice_items", "invoice_id", TEST_INVOICE_IDS);
  deleted.invoices = await deleteByIds("invoices", "id", TEST_INVOICE_IDS);

  const { data: mediaRows, error: mediaErr } = await supabase
    .from("project_completion_media")
    .delete()
    .in("delivery_id", [...TEST_DELIVERY_IDS])
    .select("id");
  if (mediaErr && !mediaErr.message.includes("Could not find the table")) {
    throw new Error(`project_completion_media delete failed: ${mediaErr.message}`);
  }
  deleted.project_completion_media = mediaRows?.length || 0;

  deleted.project_deliveries = await deleteByIds("project_deliveries", "id", TEST_DELIVERY_IDS);
  deleted.customer_documents = await deleteByIds("customer_documents", "id", TEST_DOCUMENT_IDS);
  deleted.leads_soft_deleted = await softDeleteLeads(SOFT_DELETE_LEAD_IDS);
  deleted.users = await deleteByIds("users", "id", TEST_PORTAL_USER_IDS);
  deleted.customers = await deleteByIds("customers", "id", TEST_CUSTOMER_IDS);

  return deleted;
}

export async function fetchProductionCleanupCounts() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const tables = [
    "leads",
    "customers",
    "invoices",
    "invoice_items",
    "invoice_payments",
    "customer_documents",
    "project_deliveries",
    "project_completion_media",
    "quotations",
    "support_tickets",
    "users",
  ] as const;
  const counts: Record<string, number | null> = {};
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    counts[table] = error ? null : count || 0;
  }
  const { count: activeLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);
  counts.active_leads = activeLeads || 0;
  return counts;
}
