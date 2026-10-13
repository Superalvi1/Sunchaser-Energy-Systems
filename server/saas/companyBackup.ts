import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  deleteRailwayObject,
  getRailwayObject,
  listRailwayObjects,
  putRailwayObject,
  type RailwayObjectNamespace,
} from "../storage/railwayObjectStorage.ts";
import { FOUNDING_COMPANY_ID, isValidCompanyId } from "./multiCompany.ts";

/**
 * Company export and restore (operator tool, not an API route).
 *
 * EXPORT writes one directory for ONE company: every row of every company-owned table (data/<table>.jsonl), the company's stored documents
 * (files/<namespace>/<key>), its memberships (no password hashes), and manifest.json with row counts, per-table digests and the sha256 of
 * every file. All rows are read in ONE repeatable-read transaction, so the export is a consistent snapshot.
 *
 * RESTORE replaces that company's rows with the exported ones, in one transaction. Every statement that deletes or inserts carries the
 * company id; every row is checked to belong to that company before it is inserted; the archive's checksums are verified first and the
 * restored rows are compared with the manifest's digests before COMMIT (a mismatch rolls everything back). Objects are uploaded BEFORE the
 * database transaction (a failed upload changes nothing in the database) and objects the export does not contain are only removed
 * when asked. Dry run is the default.
 *
 * A restore never touches another company: nothing here reads or writes a row whose company_id differs from the company being restored.
 */

export const BACKUP_FORMAT = "sunchaser-company-backup";
export const BACKUP_VERSION = 1;
const NAMESPACES: RailwayObjectNamespace[] = ["customer-documents", "quote-assets"];
const EXPORT_CLASSES = new Set(["tenant", "tenant_config", "tenant_existing_company_id", "tenant_system"]);

export type TableEntry = { name: string; columns: string[]; rows: number; digest: string; sha256: string; file: string };
export type ObjectEntry = { namespace: RailwayObjectNamespace; key: string; size: number; sha256: string; contentType: string; file: string };
export type Manifest = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  company: { id: string; name: string; slug: string; status: string };
  source: { database: string; schemaFingerprint: string };
  tables: TableEntry[]; // restore order (parents first)
  skippedTables: Array<{ table: string; reason: string }>;
  objects: ObjectEntry[];
  files: Record<string, string>; // relative path -> sha256 of every file except manifest.json
};

export class BackupError extends Error {}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export function loadClassification(file: string): Record<string, { class: string }> {
  return JSON.parse(fs.readFileSync(file, "utf8")).tables;
}

type Db = pg.Client;

/** Tables to export: classified company-owned, present in the database with a company_id column. */
async function discoverTables(db: Db, classification: Record<string, { class: string }>) {
  const wanted = Object.entries(classification).filter(([, v]) => EXPORT_CLASSES.has(v.class)).map(([k]) => k).sort();
  const present = await db.query(
    `select c.table_name, array_agg(c.column_name::text order by c.ordinal_position) as cols,
            array_agg(c.column_name::text order by c.ordinal_position) filter (where c.is_generated = 'ALWAYS') as generated,
            bool_or(c.column_name = 'company_id') as has_company
       from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' group by c.table_name`);
  const byName = new Map(present.rows.map((r: any) => [r.table_name as string, r]));
  const tables: Array<{ name: string; columns: string[]; generated: string[] }> = [];
  const skipped: Array<{ table: string; reason: string }> = [];
  for (const t of wanted) {
    const r: any = byName.get(t);
    if (!r) { skipped.push({ table: t, reason: "table not present in this database" }); continue; }
    if (!r.has_company) { skipped.push({ table: t, reason: "table has no company_id column" }); continue; }
    tables.push({ name: t, columns: (r.cols as string[]).filter((c) => !(r.generated || []).includes(c)), generated: r.generated || [] });
  }
  return { tables, skipped };
}

/** Parents before children. Tables in a foreign-key cycle are appended in name order and reported (restore then needs replica mode). */
async function orderByDependency(db: Db, names: string[]): Promise<{ ordered: string[]; cyclic: string[] }> {
  const fks = await db.query(
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
       from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  const set = new Set(names);
  const deps = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const r of fks.rows) {
    const child = String(r.child).replace(/^public\./, ""), parent = String(r.parent).replace(/^public\./, "");
    if (set.has(child) && set.has(parent) && child !== parent) deps.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const remaining = new Set(names);
  while (remaining.size) {
    const ready = [...remaining].filter((n) => [...deps.get(n)!].every((p) => !remaining.has(p))).sort();
    if (!ready.length) break;
    for (const n of ready) { ordered.push(n); remaining.delete(n); }
  }
  const cyclic = [...remaining].sort();
  return { ordered: [...ordered, ...cyclic], cyclic };
}

/** Digest of a company's rows in one table, computed by the database (so export and restore compare the same representation). */
async function tableDigest(db: Db, table: string, companyId: string): Promise<{ rows: number; digest: string }> {
  const r = await db.query(
    `select count(*)::int as n, md5(coalesce(string_agg(j, '|' order by j), '')) as d from (select to_jsonb(t)::text as j from public.${q(table)} t where t.company_id = $1) s`,
    [companyId]);
  return { rows: r.rows[0].n, digest: r.rows[0].d };
}

async function schemaFingerprint(db: Db, tables: Array<{ name: string; columns: string[] }>): Promise<string> {
  const r = await db.query(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = any($1) order by table_name, ordinal_position`,
    [tables.map((t) => t.name)]);
  return sha256(JSON.stringify(r.rows));
}

export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env, allowRemote = false): pg.ClientConfig {
  const host = env.PGHOST || "";
  const local = host === "" || host.startsWith("/") || /^(127\.|localhost$|::1$)/.test(host);
  if (!local && !allowRemote) throw new BackupError(`Refusing a non-local database (PGHOST=${host}). Pass --allow-remote only for a database you mean to change.`);
  return { host: host || undefined, port: env.PGPORT ? Number(env.PGPORT) : undefined, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE };
}

function writeFile(root: string, rel: string, data: Buffer | string, files: Record<string, string>) {
  const target = path.join(root, rel);
  if (!path.resolve(target).startsWith(path.resolve(root) + path.sep)) throw new BackupError(`Unsafe path in archive: ${rel}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  fs.writeFileSync(target, buf, { mode: 0o600 });
  files[rel] = sha256(buf);
}

export type ExportOptions = { client: pg.ClientConfig; companyId: string; outDir: string; classificationFile: string; /** Database only (a rehearsal without object storage). The manifest then lists no objects. */ skipObjects?: boolean; log?: (m: string) => void };

export async function exportCompany(opts: ExportOptions): Promise<Manifest> {
  const log = opts.log || (() => {});
  if (!isValidCompanyId(opts.companyId)) throw new BackupError("Invalid company id.");
  if (fs.existsSync(opts.outDir) && fs.readdirSync(opts.outDir).length) throw new BackupError(`${opts.outDir} exists and is not empty.`);
  fs.mkdirSync(opts.outDir, { recursive: true, mode: 0o700 });
  const db = new pg.Client(opts.client);
  await db.connect();
  try {
    await db.query("begin isolation level repeatable read read only");
    await db.query("set time zone 'UTC'");
    const co = await db.query("select id, name, slug, status from public.companies where id = $1", [opts.companyId]);
    if (!co.rowCount) throw new BackupError(`Company ${opts.companyId} does not exist.`);
    const { tables, skipped } = await discoverTables(db, loadClassification(opts.classificationFile));
    const { ordered, cyclic } = await orderByDependency(db, tables.map((t) => t.name));
    if (cyclic.length) log(`note: tables in a foreign-key cycle (restore needs replica mode): ${cyclic.join(", ")}`);
    const byName = new Map(tables.map((t) => [t.name, t]));
    const files: Record<string, string> = {};
    const entries: TableEntry[] = [];
    for (const name of ordered) {
      const t = byName.get(name)!;
      const res = await db.query(`select to_jsonb(t)::text as j from public.${q(name)} t where t.company_id = $1 order by to_jsonb(t)::text`, [opts.companyId]);
      const body = res.rows.map((r: any) => r.j).join("\n") + (res.rowCount ? "\n" : "");
      const rel = `data/${name}.jsonl`;
      writeFile(opts.outDir, rel, body, files);
      const d = await tableDigest(db, name, opts.companyId);
      entries.push({ name, columns: t.columns, rows: d.rows, digest: d.digest, sha256: files[rel], file: rel });
      log(`  ${name}: ${d.rows} row(s)`);
    }
    // identity: the company row and its memberships (references to users, never their password hashes)
    const mem = await db.query(
      `select m.id, m.company_id, m.user_id, m.role, m.status, u.username, u.email from public.company_memberships m left join public.users u on u.id = m.user_id where m.company_id = $1 order by m.id`,
      [opts.companyId]);
    writeFile(opts.outDir, "identity/company.json", JSON.stringify(co.rows[0], null, 1), files);
    writeFile(opts.outDir, "identity/memberships.json", JSON.stringify(mem.rows, null, 1), files);
    const fingerprint = await schemaFingerprint(db, tables);
    const dbName = (await db.query("select current_database() as d")).rows[0].d;
    await db.query("commit");

    // documents: everything stored under the company's own prefix; the founding company (no prefix) by the keys its rows reference
    const objects: ObjectEntry[] = [];
    const keys = new Map<string, { namespace: RailwayObjectNamespace; key: string }>();
    if (opts.skipObjects) {
      log("  (documents skipped: --no-objects)");
    } else if (opts.companyId !== FOUNDING_COMPANY_ID) {
      for (const ns of NAMESPACES) for (const o of await listRailwayObjects(ns, `c/${opts.companyId}/`)) keys.set(`${ns}/${o.key}`, { namespace: ns, key: o.key });
    } else {
      const refs = await db.query(`select storage_path from public.customer_documents where company_id = $1 and storage_path is not null`, [opts.companyId]);
      for (const r of refs.rows) keys.set(`customer-documents/${r.storage_path}`, { namespace: "customer-documents", key: r.storage_path });
    }
    for (const { namespace, key } of [...keys.values()].sort((a, b) => (a.namespace + a.key).localeCompare(b.namespace + b.key))) {
      if (key.split("/").some((s) => s === ".." || s === ".")) throw new BackupError(`Refusing an object key with a traversal segment: ${key}`);
      const got = await getRailwayObject(namespace, key);
      if (!got) { log(`  (referenced object missing in storage, not exported: ${namespace}/${key})`); skipped.push({ table: `object:${namespace}/${key}`, reason: "referenced but not found in storage" }); continue; }
      const rel = `files/${namespace}/${key}`;
      writeFile(opts.outDir, rel, got.body, files);
      objects.push({ namespace, key, size: got.body.length, sha256: files[rel], contentType: got.contentType, file: rel });
    }
    log(`  ${objects.length} stored document(s)`);
    const manifest: Manifest = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(),
      company: co.rows[0], source: { database: dbName, schemaFingerprint: fingerprint },
      tables: entries, skippedTables: skipped, objects, files,
    };
    fs.writeFileSync(path.join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 1), { mode: 0o600 });
    return manifest;
  } catch (err) {
    try { await db.query("rollback"); } catch { /* connection may already be closed */ }
    throw err;
  } finally {
    await db.end();
  }
}

/** Reads and checks an exported directory: manifest shape, every file's sha256, no extra files, safe paths. Throws BackupError. */
export function verifyArchive(dir: string): Manifest {
  const mf = path.join(dir, "manifest.json");
  if (!fs.existsSync(mf)) throw new BackupError("manifest.json is missing.");
  const m = JSON.parse(fs.readFileSync(mf, "utf8")) as Manifest;
  if (m.format !== BACKUP_FORMAT || m.version !== BACKUP_VERSION) throw new BackupError("Not a company backup of a version this tool understands.");
  if (!isValidCompanyId(m.company?.id)) throw new BackupError("The manifest names no valid company.");
  const root = path.resolve(dir);
  for (const [rel, want] of Object.entries(m.files)) {
    const target = path.resolve(dir, rel);
    if (!target.startsWith(root + path.sep)) throw new BackupError(`Unsafe path in manifest: ${rel}`);
    if (!fs.existsSync(target)) throw new BackupError(`File listed in the manifest is missing: ${rel}`);
    if (sha256(fs.readFileSync(target)) !== want) throw new BackupError(`Checksum mismatch (the archive was changed or damaged): ${rel}`);
  }
  const listed = new Set(Object.keys(m.files).concat("manifest.json"));
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(root, path.join(d, e.name))]));
  const extra = walk(root).filter((f) => !listed.has(f.split(path.sep).join("/")));
  if (extra.length) throw new BackupError(`Files in the archive that the manifest does not list: ${extra.slice(0, 5).join(", ")}`);
  for (const t of m.tables) {
    if (m.files[t.file] !== t.sha256) throw new BackupError(`Manifest is inconsistent for ${t.name}.`);
  }
  for (const o of m.objects) {
    if (m.files[o.file] !== o.sha256) throw new BackupError(`Manifest is inconsistent for object ${o.key}.`);
    if (o.namespace && !NAMESPACES.includes(o.namespace)) throw new BackupError(`Unknown object namespace ${o.namespace}.`);
    if (m.company.id !== FOUNDING_COMPANY_ID && !o.key.startsWith(`c/${m.company.id}/`)) throw new BackupError(`Object ${o.key} is outside the company's own key space.`);
  }
  return m;
}

export type RestoreOptions = {
  client: pg.ClientConfig;
  dir: string;
  /** The company to restore INTO. Must equal the archive's company: an archive is never restored into another company. */
  companyId: string;
  apply: boolean;
  pruneObjects?: boolean;
  /** Database only: the archive's objects are not uploaded and storage is not listed. */
  skipObjects?: boolean;
  classificationFile: string;
  log?: (m: string) => void;
};
export type RestoreReport = {
  applied: boolean;
  company: string;
  tables: Array<{ name: string; deleted: number; inserted: number }>;
  objects: { uploaded: number; pruned: number; extraInStorage: number };
  memberships: { restored: number; missingUsers: string[] };
  warnings: string[];
};

export async function restoreCompany(opts: RestoreOptions): Promise<RestoreReport> {
  const log = opts.log || (() => {});
  const m = verifyArchive(opts.dir);
  if (m.company.id !== opts.companyId) throw new BackupError(`This archive belongs to company ${m.company.id}; it will not be restored into ${opts.companyId}.`);
  const report: RestoreReport = { applied: false, company: m.company.id, tables: [], objects: { uploaded: 0, pruned: 0, extraInStorage: 0 }, memberships: { restored: 0, missingUsers: [] }, warnings: [] };
  const db = new pg.Client(opts.client);
  await db.connect();
  try {
    const co = await db.query("select id from public.companies where id = $1", [m.company.id]);
    if (!co.rowCount) throw new BackupError(`Company ${m.company.id} does not exist in the target database (create it first).`);
    // schema compatibility: every exported column must exist in the target table
    const present = await db.query(
      `select table_name, array_agg(column_name::text) as cols from information_schema.columns where table_schema = 'public' and table_name = any($1) group by table_name`,
      [m.tables.map((t) => t.name)]);
    const cols = new Map<string, Set<string>>(present.rows.map((r: any) => [r.table_name as string, new Set<string>(r.cols)] as [string, Set<string>]));
    for (const t of m.tables) {
      const have = cols.get(t.name);
      if (!have) throw new BackupError(`Table ${t.name} of the archive does not exist in the target database.`);
      const missing = t.columns.filter((c) => !have.has(c));
      if (missing.length) throw new BackupError(`Table ${t.name}: the target has no column ${missing.join(", ")} (schema differs from the source).`);
    }
    const { ordered, cyclic } = await orderByDependency(db, m.tables.map((t) => t.name));
    const order = ordered;
    const entry = new Map(m.tables.map((t) => [t.name, t]));
    // plan
    const current: Record<string, number> = {};
    for (const n of order) current[n] = (await tableDigest(db, n, m.company.id)).rows;
    for (const n of order) report.tables.push({ name: n, deleted: current[n], inserted: entry.get(n)!.rows });
    const inStorage = new Map<string, Set<string>>();
    if (m.company.id !== FOUNDING_COMPANY_ID && !opts.skipObjects) {
      for (const ns of NAMESPACES) inStorage.set(ns, new Set((await listRailwayObjects(ns, `c/${m.company.id}/`)).map((o) => o.key)));
    }
    const exportKeys = new Set(m.objects.map((o) => `${o.namespace}/${o.key}`));
    const extra = [...inStorage.entries()].flatMap(([ns, keys]) => [...keys].filter((k) => !exportKeys.has(`${ns}/${k}`)).map((k) => ({ ns: ns as RailwayObjectNamespace, k })));
    report.objects.extraInStorage = extra.length;
    if (cyclic.length) report.warnings.push(`tables in a foreign-key cycle: ${cyclic.join(", ")} (restored with triggers and foreign keys deferred, then verified)`);
    if (!opts.apply) return report;

    // 1. objects first: a failed upload leaves the database untouched
    for (const o of opts.skipObjects ? [] : m.objects) {
      const body = fs.readFileSync(path.join(opts.dir, o.file));
      await putRailwayObject(o.namespace, o.key, body, o.contentType || "application/octet-stream");
      const back = await getRailwayObject(o.namespace, o.key);
      if (!back || sha256(back.body) !== o.sha256) throw new BackupError(`Uploaded object did not read back identically: ${o.key}`);
      report.objects.uploaded++;
    }
    log(`uploaded ${report.objects.uploaded} document(s)`);

    // 2. database: one transaction
    await db.query("begin");
    try {
      await db.query("set local lock_timeout = '10s'");
      await db.query("set local time zone 'UTC'");
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [`company-restore:${m.company.id}`]);
      const su = await db.query("select rolsuper from pg_roles where rolname = current_user");
      if (cyclic.length || su.rows[0]?.rolsuper) {
        // Rows are restored verbatim: no trigger recomputes anything and no foreign key is checked row by row; both are verified below instead.
        try { await db.query("set local session_replication_role = replica"); }
        catch (e) { if (cyclic.length) throw new BackupError("Tables in a foreign-key cycle need superuser access to restore."); }
      }
      for (const n of [...order].reverse()) {
        await db.query(`delete from public.${q(n)} where company_id = $1`, [m.company.id]);
      }
      for (const n of order) {
        const t = entry.get(n)!;
        const lines = fs.readFileSync(path.join(opts.dir, t.file), "utf8").split("\n").filter(Boolean);
        const colList = t.columns.map(q).join(", ");
        const ident = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and is_identity = 'YES' and identity_generation = 'ALWAYS' limit 1`, [n]);
        for (let i = 0; i < lines.length; i += 500) {
          const chunk = lines.slice(i, i + 500).map((l) => JSON.parse(l));
          for (const row of chunk) if (row.company_id !== m.company.id) throw new BackupError(`Row in ${n} belongs to ${row.company_id}, not ${m.company.id}: archive refused.`);
          await db.query(
            `insert into public.${q(n)} (${colList}) ${ident.rowCount ? "overriding system value " : ""}select ${colList} from jsonb_populate_recordset(null::public.${q(n)}, $1::jsonb)`,
            [JSON.stringify(chunk)]);
        }
      }
      // sequences owned by restored columns must not lag behind the restored values
      const seqs = await db.query(
        `select s.relname as seq, t.relname as tbl, a.attname as col from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a','i') join pg_class t on t.oid = d.refobjid join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
          where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace and t.relname = any($1)`, [order]);
      for (const s of seqs.rows) {
        await db.query(`select setval(format('public.%I', $1::text)::regclass, greatest((select coalesce(max(${q(s.col)}), 0) from public.${q(s.tbl)}), (select last_value from public.${q(s.seq)})), true)`, [s.seq]);
      }
      // verify before COMMIT: digests equal the manifest's, no orphan references, every parent in the same company
      for (const n of order) {
        const d = await tableDigest(db, n, m.company.id);
        const want = entry.get(n)!;
        if (d.rows !== want.rows || d.digest !== want.digest) throw new BackupError(`Verification failed for ${n}: restored ${d.rows} row(s) / ${d.digest}, archive has ${want.rows} / ${want.digest}. Nothing was changed.`);
      }
      const fk = await db.query(
        `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
                (select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ord) from unnest(c.conkey, c.confkey) with ordinality k(ck, pk, ord) join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = k.ck join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.pk) as joincond,
                (select string_agg(format('c.%I is not null', a.attname), ' and ') from unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as notnull
           from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
      const mine = new Set(order);
      for (const f of fk.rows) {
        const child = String(f.child).replace(/^public\./, ""), parent = String(f.parent).replace(/^public\./, "");
        if (!mine.has(child) || !f.joincond) continue;
        const orphans = await db.query(`select count(*)::int as n from public.${q(child)} c where c.company_id = $1 and ${f.notnull} and not exists (select 1 from public.${q(parent)} p where ${f.joincond})`, [m.company.id]);
        if (orphans.rows[0].n) throw new BackupError(`Verification failed: ${orphans.rows[0].n} row(s) of ${child} reference a missing ${parent}. Nothing was changed.`);
        if (mine.has(parent)) {
          const cross = await db.query(`select count(*)::int as n from public.${q(child)} c join public.${q(parent)} p on ${f.joincond} where c.company_id = $1 and p.company_id <> c.company_id`, [m.company.id]);
          if (cross.rows[0].n) throw new BackupError(`Verification failed: ${cross.rows[0].n} row(s) of ${child} reference a ${parent} of another company. Nothing was changed.`);
        }
      }
      // memberships: restored where the user exists; never created for unknown users, never removed
      const members = JSON.parse(fs.readFileSync(path.join(opts.dir, "identity/memberships.json"), "utf8")) as Array<{ id: string; user_id: string; role: string; status: string; username?: string }>;
      for (const mm of members) {
        const u = await db.query("select 1 from public.users where id = $1", [mm.user_id]);
        if (!u.rowCount) { report.memberships.missingUsers.push(mm.username || mm.user_id); continue; }
        await db.query(
          `insert into public.company_memberships (id, company_id, user_id, role, status) values ($1, $2, $3, $4, $5)
           on conflict (company_id, user_id) do update set role = excluded.role, status = excluded.status`,
          [mm.id, m.company.id, mm.user_id, mm.role, mm.status]);
        report.memberships.restored++;
      }
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
    report.applied = true;

    // 3. objects the export does not contain (only when asked)
    if (opts.pruneObjects) {
      for (const { ns, k } of extra) { await deleteRailwayObject(ns, k); report.objects.pruned++; }
    }
    return report;
  } finally {
    await db.end();
  }
}

/** Per-company digest of every exported table and every stored object, used by the isolation proof. */
export async function companyFingerprint(client: pg.ClientConfig, companyId: string, classificationFile: string, options: { skipObjects?: boolean } = {}): Promise<{ tables: Record<string, string>; objects: Record<string, string> }> {
  const db = new pg.Client(client);
  await db.connect();
  try {
    await db.query("set time zone 'UTC'");
    const { tables } = await discoverTables(db, loadClassification(classificationFile));
    const out: Record<string, string> = {};
    for (const t of tables) { const d = await tableDigest(db, t.name, companyId); out[t.name] = `${d.rows}:${d.digest}`; }
    const objects: Record<string, string> = {};
    if (companyId !== FOUNDING_COMPANY_ID && !options.skipObjects) {
      for (const ns of NAMESPACES) for (const o of await listRailwayObjects(ns, `c/${companyId}/`)) {
        const got = await getRailwayObject(ns, o.key);
        objects[`${ns}/${o.key}`] = got ? sha256(got.body) : "missing";
      }
    }
    return { tables: out, objects };
  } finally {
    await db.end();
  }
}
