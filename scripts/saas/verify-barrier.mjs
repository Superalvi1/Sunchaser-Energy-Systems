#!/usr/bin/env node
// Proves, over HTTP, that the database barrier of t1b-tenancy-barrier is ACTIVE in the PostgREST that this stack really uses, and (with --confirm) records that proof in the
// database so that pilot companies can be created. Run it after `select app.tenancy_enable()` and before the first pilot company. Read-only apart from --confirm.
//
//   RAILWAY_POSTGREST_URL=http://127.0.0.1:3000 SUPABASE_SERVICE_ROLE_KEY=<service key> [CRM_TENANT_POSTGREST_KEY=<tenant key>] \
//   [VERIFY_PSQL="-h host -p 5432 -U owner -d db"] node scripts/saas/verify-barrier.mjs [--confirm]
//
// What it checks (each must hold, otherwise it stops with a non-zero exit and says what to fix):
//   1. the marker is on (the status function answers mode=multi, and answers even without the header)
//   2. a service-role request with NO header is refused with HTTP 503 (SQLSTATE PT503)  -> an older backend or a script cannot read anything
//   3. header x-isolation-mode: single is refused                                         -> a flag-off process of the new build cannot either
//   4. header x-isolation-mode: multi is not refused                                      -> the multi-company build works
//   5. header global-only is refused on a tenant path and allowed on a marketplace path   -> the cron job keeps working, and only for those paths
//   6. (if a tenant key is given) the tenant role is not touched by the barrier
// If step 2 answers 200 the pre-request function is not active: check that PostgREST reads in-database configuration (db-config = true, no db-pre-request in the file
// config), then `NOTIFY pgrst, 'reload config';` or restart PostgREST.
import { execFileSync } from "node:child_process";

const base = String(process.env.RAILWAY_POSTGREST_URL || "").replace(/\/$/, "");
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const tenant = process.env.CRM_TENANT_POSTGREST_KEY || "";
const confirm = process.argv.includes("--confirm");
if (!base || !svc) { console.error("Set RAILWAY_POSTGREST_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }

let failed = 0;
const say = (ok, msg, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${msg}${!ok && detail ? " - " + String(detail).slice(0, 300) : ""}`); if (!ok) failed++; };
const call = async (path, { mode, key = svc, method = "GET", body, extra = {} } = {}) => {
  const headers = { apikey: key, authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}), ...extra };
  if (mode) headers["x-isolation-mode"] = mode;
  const r = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
};

const st = await call("/rpc/saas_isolation_status", { method: "POST", body: { p_deep: false } });
if (st.status === 404 || st.status === 400) { console.error("The status function is missing: apply migration t1b-tenancy-barrier first."); process.exit(1); }
say(st.status === 200 && st.body?.mode === "multi", "the marker is on (select app.tenancy_enable() has been run) and the status function answers without any header", JSON.stringify(st.body));
if (st.body?.mode !== "multi") { console.error("Stop: enable the marker first (select app.tenancy_enable();), then run this again."); process.exit(1); }

const none = await call("/companies?limit=1");
say(none.status === 503 && /isolation barrier/.test(JSON.stringify(none.body)), "a service-role request with NO header is refused (HTTP 503, 'tenant isolation barrier')", `${none.status} ${JSON.stringify(none.body)}`);
const single = await call("/companies?limit=1", { mode: "single" });
say(single.status === 503, "header x-isolation-mode: single is refused (a flag-off process of the new build)", `${single.status}`);
const multi = await call("/companies?limit=1", { mode: "multi" });
say(multi.status === 200, "header x-isolation-mode: multi is allowed (the multi-company build)", `${multi.status} ${JSON.stringify(multi.body)}`);
const goTenant = await call("/leads?limit=1", { mode: "global-only" });
say(goTenant.status === 503, "header global-only is refused on a tenant path (/leads)", `${goTenant.status}`);
const goMp = await call("/mp_products?limit=1", { mode: "global-only" });
say(goMp.status !== 503, "header global-only is allowed on a marketplace path (/mp_products)", `${goMp.status} ${JSON.stringify(goMp.body)}`);
if (tenant) {
  const t = await call("/leads?limit=1", { key: tenant, extra: { "x-company-id": "sunchaser" } });
  say(t.status !== 503, "the tenant role is not touched by the barrier", `${t.status} ${JSON.stringify(t.body)}`);
} else console.log("SKIP: no CRM_TENANT_POSTGREST_KEY given: tenant role not checked");

if (failed) { console.error(`\n${failed} check(s) failed: the barrier is NOT proven. Pilot companies must not be created.`); process.exit(1); }
console.log("\nThe barrier is active and behaves as designed.");
if (!confirm) { console.log("Run again with --confirm (and VERIFY_PSQL) to record it, or run: select app.tenancy_confirm_barrier();"); process.exit(0); }
if (!process.env.VERIFY_PSQL) { console.error("--confirm needs VERIFY_PSQL (psql connection arguments, owner role)."); process.exit(2); }
const out = execFileSync("psql", process.env.VERIFY_PSQL.split(/\s+/).concat(["-v", "ON_ERROR_STOP=1", "-tAc", "select app.tenancy_confirm_barrier()"]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
console.log(`Recorded in the database: ${out}`);
