// Table-by-table cross-company attack matrix. DISPOSABLE DATABASES ONLY.
// Seeds one row per company in every tenant table (as superuser), then, through PostgREST with the tenant key,
// tries to read, update, delete, upsert and forge rows of the other company. Prints a per-table result and a
// coverage line; tables that cannot be seeded automatically are listed with the reason (never silently skipped).
//   E2E_PSQL="-h /srv/s -p 55432 -U postgres -d sunchaser_test" PGRST_URL=http://127.0.0.1:54321 \
//   CRM_TENANT_POSTGREST_KEY=... node scripts/saas/tenant-isolation-matrix.mjs
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (flag) => { const a = (process.env.E2E_PSQL || "").split(/\s+/); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
const host = arg("-h"), port = Number(arg("-p") || 5432), user = arg("-U") || "postgres", database = arg("-d");
if (!host || !database || /railway|supabase|rlwy/i.test(`${host} ${database}`)) { console.error("Set E2E_PSQL to a disposable local database."); process.exit(2); }
const PGRST = process.env.PGRST_URL; const TENANT_KEY = process.env.CRM_TENANT_POSTGREST_KEY;
if (!PGRST || !TENANT_KEY) { console.error("Set PGRST_URL and CRM_TENANT_POSTGREST_KEY."); process.exit(2); }

const classification = JSON.parse(fs.readFileSync(path.join(here, "table-classification.json"), "utf8")).tables;
const tenantTables = Object.entries(classification).filter(([, v]) => ["tenant", "tenant_config", "tenant_existing_company_id"].includes(v.class)).map(([k]) => k).sort();
const A = "co_alpha", B = "co_beta";
const RUN = randomUUID().slice(0, 6);

const db = new pg.Client({ host, port, user, database });
await db.connect();
await db.query(`insert into public.companies (id, slug, name) values ('${A}','alpha','Alpha Solar'),('${B}','beta','Beta Energy') on conflict do nothing`);
const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

const pgrstFetch = (input, init) => { const u = new URL(typeof input === "string" ? input : input.url); const t = new URL(PGRST + (u.pathname.replace(/^\/rest\/v1/, "") || "/")); t.search = u.search; return fetch(t, init); };
const client = (headers = {}) => createClient("https://postgrest.invalid", TENANT_KEY, { auth: { persistSession: false }, global: { headers, fetch: pgrstFetch } });
const asA = client({ "x-company-id": A }), asB = client({ "x-company-id": B }), anon = client();

// ---------- catalog ----------
const cols = await q(`select table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, is_generated, is_identity, identity_generation from information_schema.columns where table_schema='public'`);
const pks = await q(`select c.conrelid::regclass::text as t, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.contype='p' and c.connamespace='public'::regnamespace`);
const fks = await q(`select c.conrelid::regclass::text as t, a.attname as col, c.confrelid::regclass::text as parent, af.attname as pcol from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1] where c.contype='f' and c.connamespace='public'::regnamespace and array_length(c.conkey,1)=1`);
const checks = await q(`select c.conrelid::regclass::text as t, pg_get_constraintdef(c.oid) as def from pg_constraint c where c.contype='c' and c.connamespace='public'::regnamespace`);
const colsOf = (t) => cols.filter((c) => c.table_name === t);
const pkOf = (t) => pks.filter((p) => p.t.replace(/^public\./, "") === t).map((p) => p.col);
const fkOf = (t, col) => fks.find((f) => f.t.replace(/^public\./, "") === t && f.col === col);
const enumFor = (t, col) => {
  for (const c of checks.filter((x) => x.t.replace(/^public\./, "") === t)) {
    const m = c.def.match(new RegExp(`\\(?${col} = ANY \\(\\(?ARRAY\\[(.*?)\\]`)) || c.def.match(new RegExp(`${col}\\)::text = ANY \\(\\(?ARRAY\\[(.*?)\\]`));
    if (m) { const lit = m[1].match(/'([^']*)'/); if (lit) return lit[1]; }
  }
  return undefined;
};

async function cleanup() {
  await db.query("set session_replication_role = replica");
  for (const t of [...tenantTables, "smart_quote_versions"]) {
    if (!colsOf(t).length) continue;
    await db.query(`delete from public."${t}" where company_id in ($1,$2)`, [A, B]);
  }
  await db.query("set session_replication_role = origin");
}
async function removeTestCompanies() {
  await db.query("delete from public.company_memberships where company_id in ($1,$2)", [A, B]);
  await db.query("delete from public.companies where id in ($1,$2)", [A, B]);
}
let counter = 0;
function valueFor(t, c, tag) {
  const e = enumFor(t, c.column_name); if (e !== undefined) return e;
  const n = ++counter, max = c.character_maximum_length || 200;
  switch (c.udt_name) {
    case "int2": case "int4": case "int8": case "numeric": case "float4": case "float8": return 1;
    case "bool": return false;
    case "uuid": return randomUUID();
    case "date": return "2026-01-01";
    case "timestamptz": case "timestamp": return new Date().toISOString();
    case "jsonb": case "json": return /s$|list|items|lines|tags/.test(c.column_name) ? [] : {};
    case "text": case "varchar": case "bpchar": return `${tag}-${c.column_name}-${n}`.slice(0, max);
    default: return undefined;
  }
}
const cache = new Map();
let added = [];
async function seed(t, company, tag, depth = 0) {
  const key = `${t}|${company}|${tag}`; if (cache.has(key)) return cache.get(key);
  const row = await build(t, company, tag, depth);
  const out = await insertRow(t, row);
  cache.set(key, out); added.push(key); return out;
}
async function build(t, company, tag, depth = 0) {
  if (depth > 6) throw new Error(`FK depth exceeded at ${t}`);
  const row = {};
  tag = `${tag}${RUN}`;
  for (const c of colsOf(t)) {
    if (c.column_name === "company_id") { row.company_id = company; continue; }
    if (c.is_generated === "ALWAYS" || c.is_identity === "YES") continue;
    const isPk = pkOf(t).includes(c.column_name);
    if (c.column_default && !isPk) continue;
    if (c.is_nullable === "YES" && !isPk) continue;
    const fk = fkOf(t, c.column_name);
    if (fk && fk.parent.replace(/^public\./, "") !== t) { const parent = await seed(fk.parent.replace(/^public\./, ""), company, tag, depth + 1); row[c.column_name] = parent[fk.pcol]; continue; }
    if (isPk && c.column_default) continue;
    const ov = OVERRIDES[t]?.[c.column_name]; const v = ov ? ov(tag) : valueFor(t, c, tag); if (v === undefined) throw new Error(`no generator for ${c.column_name} (${c.udt_name})`);
    row[c.column_name] = v;
  }
  if (!("company_id" in row) && colsOf(t).some((c) => c.column_name === "company_id")) row.company_id = company;
  return row;
}
async function insertRow(t, row) {
  const names = Object.keys(row), vals = names.map((n) => (typeof row[n] === "object" && row[n] !== null ? JSON.stringify(row[n]) : row[n]));
  const sql = `insert into public."${t}" (${names.map((n) => `"${n}"`).join(",")}) values (${names.map((_, i) => `$${i + 1}`).join(",")}) returning *`;
  let out;
  await db.query("savepoint s");
  try { out = (await db.query(sql, vals)).rows[0]; await db.query("release savepoint s"); }
  catch (err) { await db.query("rollback to savepoint s"); throw err; }
  return out;
}

const generated = (t) => new Set(colsOf(t).filter((c) => c.is_generated === "ALWAYS" || c.identity_generation === "ALWAYS").map((c) => c.column_name));
const payload = (t, row, extra = {}) => { const g = generated(t); return { ...Object.fromEntries(Object.entries(row).filter(([k]) => !g.has(k))), ...extra }; };
// Values for columns whose CHECK constraint is a pattern the generic generator cannot guess.
const OVERRIDES = {
  interactive_proposals: { token_hash: (tag) => tag.padEnd(64, "0") },
  smart_quote_versions: { quote_number: () => `SES-20261009-${String(1000 + (++counter % 8000))}` },
};
await cleanup();
const results = [], skipped = [];
for (const t of tenantTables) {
  const r = { table: t, checks: {} }; results.push(r);
  if (!colsOf(t).length) { r.skipped = "table not present in this database"; skipped.push([t, r.skipped]); continue; }
  const pk = pkOf(t); if (!pk.length) { r.skipped = "no primary key"; skipped.push([t, r.skipped]); continue; }
  let ra, rb;
  added = [];
  await db.query("begin");
  try { ra = await seed(t, A, "a"); rb = await seed(t, B, "b"); await db.query("commit"); }
  catch (e) { await db.query("rollback"); for (const k of added) cache.delete(k); r.skipped = String(e.message).slice(0, 140); skipped.push([t, r.skipped]); continue; }
  const where = (row) => Object.fromEntries(pk.map((k) => [k, row[k]]));
  const filt = (qb, row) => { for (const [k, v] of Object.entries(where(row))) qb = qb.eq(k, v); return qb; };
  const same = (a, b) => pk.every((k) => String(a[k]) === String(b[k]));
  const rec = (name, ok, detail) => { r.checks[name] = ok; if (!ok) r.detail = (r.detail || "") + `${name}: ${detail}; `; };

  let x = await filt(asA.from(t).select("*"), ra); rec("owner reads own row", !x.error && x.data?.length === 1, JSON.stringify(x.error));
  x = await filt(asA.from(t).select("*"), rb); rec("A cannot read B's row by key", !x.error && x.data?.length === 0, JSON.stringify(x.error || x.data));
  x = await asA.from(t).select("*").limit(1000); rec("A's full scan has only A rows", !x.error && x.data.every((row) => row.company_id === A) && x.data.some((row) => same(row, ra)), JSON.stringify(x.error) || "foreign rows visible");
  x = await asB.from(t).select("*").limit(1000); rec("B's full scan has only B rows", !x.error && x.data.every((row) => row.company_id === B), JSON.stringify(x.error) || "foreign rows visible");
  x = await filt(asA.from(t).update({ company_id: A }), rb).select(); rec("A cannot update B's row", !x.error && (x.data?.length ?? 0) === 0, JSON.stringify(x.error || x.data));
  x = await filt(asA.from(t).delete(), rb).select(); rec("A cannot delete B's row", !x.error && (x.data?.length ?? 0) === 0, JSON.stringify(x.error || x.data));
  const still = await q(`select company_id from public."${t}" where ${pk.map((k, i) => `"${k}"=$${i + 1}`).join(" and ")}`, pk.map((k) => rb[k]));
  rec("B's row survives untouched in the database", still.length === 1 && still[0].company_id === B, JSON.stringify(still));
  x = await asA.from(t).upsert(payload(t, rb, { company_id: A }), { onConflict: pk.join(",") }).select(); rec("A cannot take over B's row by upsert", !x.error ? (x.data?.length ?? 0) === 0 : x.error.code === "42501", JSON.stringify(x.error || x.data));
  x = await asA.from(t).update({ company_id: B }).match(where(ra)).select(); rec("A cannot hand its row to B", !!x.error ? x.error.code === "42501" : (x.data?.length ?? 0) === 0, JSON.stringify(x.error || x.data));
  // Cross-company reference: A inserts a row of its own that points at B's parent. Positive control first.
  const fk = fks.find((f) => f.t.replace(/^public\./, "") === t && f.parent.replace(/^public\./, "") !== t && tenantTables.includes(f.parent.replace(/^public\./, "")) && !(fkOf(t, f.col)?.optionalRef));
  if (fk) {
    const parent = fk.parent.replace(/^public\./, "");
    let draftOwn, draftForeign, foreignParent;
    await db.query("begin");
    try { draftOwn = await build(t, A, "x"); draftForeign = { ...(await build(t, A, "y")) }; foreignParent = await seed(parent, B, "b"); await db.query("commit"); }
    catch (e) { await db.query("rollback"); rec("cross-company reference test could be built", false, String(e.message).slice(0, 120)); }
    if (draftOwn) {
      const own = await asA.from(t).insert(payload(t, draftOwn)).select();
      if (own.error) rec("positive control: own-parent insert works", false, JSON.stringify(own.error).slice(0, 160));
      else {
        draftForeign[fk.col] = foreignParent[fk.pcol];
        const bad = await asA.from(t).insert(payload(t, draftForeign)).select();
        rec("A cannot reference B's parent row", !!bad.error && bad.error.code === "42501" && /cross-company/.test(bad.error.message || ""), JSON.stringify(bad.error || bad.data).slice(0, 200));
      }
    }
  } else r.checks["cross-company reference (no FK to another tenant table)"] = true;
  x = await anon.from(t).select("*").limit(5); rec("no company header reads nothing", !x.error && x.data.length === 0, JSON.stringify(x.error || x.data?.length));
  r.ok = Object.values(r.checks).every(Boolean);
}
const seeded = results.filter((r) => !r.skipped);
if (!process.env.KEEP_ROWS) { await cleanup(); await removeTestCompanies(); }
for (const r of seeded) console.log(`${r.ok ? "PASS" : "FAIL"}: ${r.table}${r.ok ? "" : "  <- " + r.detail}`);
console.log(`\nSeeded and attacked: ${seeded.length} of ${tenantTables.length} tenant tables (${seeded.filter((r) => r.ok).length} fully isolated).`);
if (skipped.length) { console.log("NOT covered by the automatic matrix (needs a hand-written test):"); for (const [t, why] of skipped) console.log(`  - ${t}: ${why}`); }
fs.writeFileSync(process.env.MATRIX_OUT || "/tmp/tenant-isolation-matrix.json", JSON.stringify({ seeded: seeded.length, total: tenantTables.length, results }, null, 1));
await db.end();
process.exitCode = seeded.some((r) => !r.ok) ? 1 : 0;
