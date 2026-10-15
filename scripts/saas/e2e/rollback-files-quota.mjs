// Rollback keeps existing files and the quota accounting. SYNTHETIC companies, disposable stack, the migrations are rolled back and re-applied through the runner.
//   1  rollback of t8 alone (the storage reservations): every stored object and document row is untouched and still downloads byte-identical; until t8 is back a
//      pilot company's upload FAILS CLOSED (503, retryable, nothing written) and reads still work; the founding company's upload is unaffected; a reservation that was
//      in flight at the time is simply gone; after t8 is applied again the boundary is exactly where it was (the stored files still count, a deleted file frees
//      exactly its room, no reservation is left)
//   2  rollback of the whole tenant series (t8 .. t1) while pilot companies exist: t1b (the barrier, right after t1) REFUSES (a designed data-safety guard) after t8 .. t2 were rolled back; in that
//      state every object, document row and invoice is still there, byte-identical; after everything is applied again the limit, the accounting and the downloads are as before
//   Env: E2E_BASE_URL, E2E_PSQL, E2E_S3_DIR, RAILWAY_S3_ENDPOINT, TEST_PW, PGHOST/PGPORT/PGUSER/PGDATABASE (+PGPASSWORD) for the migration runner.   Seed first.
import "./lib/fresh-connections.mjs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL, PW = process.env.TEST_PW, S3DIR = process.env.E2E_S3_DIR;
if (!PW || !S3DIR || !BASE || !process.env.E2E_PSQL || !process.env.PGDATABASE || !process.env.RAILWAY_S3_ENDPOINT || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_S3_DIR, E2E_BASE_URL, E2E_PSQL, PG*, RAILWAY_S3_ENDPOINT for a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-v", "ON_ERROR_STOP=1", "-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const runner = (...a) => { try { return execFileSync("node", ["scripts/migrations/run.mjs", ...a, "--yes"], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { throw new Error(`runner ${a.join(" ")} failed: ${String(e.stderr || e.stdout || e.message).split("\n").filter(Boolean).slice(0, 6).join(" | ")}`); } };
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 400) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024, RUN = randomBytes(3).toString("hex").toUpperCase(), CACHE_WAIT = Number(process.env.STORAGE_TEST_WAIT_MS || 3500);
const reload = async () => { psql("notify pgrst, 'reload schema'"); await sleep(3500); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const api = (t) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(init.headers || {}) } });
let A = api((await login("alpha_admin")).token); const OP = api((await login("platform_op")).token), FA = api((await login("t_admin")).token);
const setLimit = (mb) => OP("/api/platform/companies/co_alpha", { method: "PATCH", body: JSON.stringify({ limitOverrides: { max_storage_mb: mb } }) });
const objs = (co) => fs.readdirSync(S3DIR).filter((f) => decodeURIComponent(f).includes(`/c/${co}/`));
const usedBytes = (co) => objs(co).reduce((n, f) => n + fs.statSync(path.join(S3DIR, f)).size, 0);
const objectMap = (co) => Object.fromEntries(objs(co).sort().map((f) => [decodeURIComponent(f), sha(fs.readFileSync(path.join(S3DIR, f)))]));
const s3Delete = (key) => new Promise((resolve, reject) => { const u = new URL(process.env.RAILWAY_S3_ENDPOINT + "/" + encodeURI(key)); const rq = https.request(u, { method: "DELETE", rejectUnauthorized: false }, (r) => { r.resume(); r.on("end", () => resolve(r.statusCode)); }); rq.on("error", reject); rq.end(); });
const bigKey = () => objs("co_alpha").filter((f) => fs.statSync(path.join(S3DIR, f)).size === S).map(decodeURIComponent)[0];   // a file of exactly the test size: a deletion frees exactly one file's room (leftovers of earlier journeys are never chosen)
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };
const png = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const fingerprint = () => ({
  docs: psql(`select md5(coalesce(string_agg(to_jsonb(d)::text, '|' order by d.id), '')) || ':' || count(*) from customer_documents d where d.company_id='co_alpha'`),
  invoices: psql(`select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) || ':' || count(*) from invoices i where i.company_id='co_alpha'`),
});

// ---- a customer, a limit that fits exactly N files, and N files stored through the application
const inv = await json(await A("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `rollback customer ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "item", description: "item", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] }) }));
const customerId = inv.invoice?.customerId;
const preKeys = new Set(Object.keys(objectMap("co_alpha")));   // objects of earlier runs/journeys are not this run's
const before = usedBytes("co_alpha"), L = Math.ceil(before / MB) + 1, free = L * MB - before, S = Math.floor(free / 5.5), N = Math.floor(free / S);
check(`setup: alpha has a customer and the operator sets a ${L} MB limit (${N} files of ${(S / 1024).toFixed(0)} KB fit)`, Boolean(customerId) && (await setLimit(L)).status === 200);
await sleep(CACHE_WAIT);
const upload = (api_, tag) => api_("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: `${tag} ${RUN}`, fileName: `${tag}.pdf`, mimeType: "application/pdf", base64Data: pdf(S, tag).toString("base64") }) });
let stored = 0; for (let i = 0; i < N; i++) if ((await upload(A, `file${i}`)).status === 201) stored++;
check(`${N} files are stored through the application`, stored === N, `${stored}`);
const full = await upload(A, "over");
check("the next one is refused at the limit (402)", full.status === 402, String(full.status));
const OBJ0 = objectMap("co_alpha"), FP0 = fingerprint();
const downloadAll = async (label) => {
  const expected = Object.keys(objectMap("co_alpha")).filter((k) => !preKeys.has(k) && /file\d/.test(k)).length;   // a file the journey deleted on purpose is not expected
  const list = await json(await A(`/api/admin/customer-documents/${customerId}`));
  let ok = 0, total = 0;
  for (const d of (list.documents || []).filter((x) => new RegExp(`^file\\d ${RUN}$`).test(x.title || ""))) {
    total++; const g = await fetch(new URL(d.fileUrl, BASE).toString());
    if (g.status === 200 && sha(Buffer.from(await g.arrayBuffer())) === sha(pdf(S, (d.fileName || "").replace(/\.pdf$/, "")))) ok++;
  }
  check(`${label}: all ${expected} stored documents download through fresh links, byte-identical to what was uploaded (${ok} of ${expected})`, ok === expected && expected >= N - 1);
};
await downloadAll("before any rollback");

try {
  // ================================================================ 1. rollback of t8 alone
  console.log("\n1. rollback of t8 (storage reservations) alone");
  psql(`insert into saas_storage_reservations (company_id, bytes, state, expires_at) values ('co_alpha', ${S}, 'pending', clock_timestamp() + interval '1 hour')`);
  runner("rollback", "--to", "t8-storage-reservations");
  await reload();
  check("t8 is rolled back (no reservation table, no functions) - the in-flight reservation went with it", psql(`select to_regclass('public.saas_storage_reservations') is null and to_regprocedure('public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)') is null`) === "t");
  check("every stored object is untouched (same keys, same bytes)", JSON.stringify(objectMap("co_alpha")) === JSON.stringify(OBJ0));
  const FP1 = fingerprint();
  check("every document row and every invoice row is untouched", JSON.stringify(FP1) === JSON.stringify(FP0));
  await downloadAll("t8 rolled back");
  A = api((await login("alpha_admin")).token);
  const objNow = objs("co_alpha").length;
  const up = await upload(A, "while-t8-is-out"); const ub = await json(up);
  check(`a pilot company's upload fails CLOSED while t8 is out: 503 storage_unverified, retryable, nothing written (${up.status})`, up.status === 503 && ub.code === "storage_unverified" && ub.retryable === true && objs("co_alpha").length === objNow);
  check("reading still works", (await A("/api/state")).status === 200 && (await A(`/api/admin/customer-documents/${customerId}`)).status === 200);
  const fu = await FA("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(500).toString("base64")}`, filename: `rollback-founding-${RUN}.png` }) });
  check(`the founding company's upload is unaffected (${fu.status})`, fu.status === 200);
  for (const d of ["public/uploads", "dist/public/uploads"]) fs.rmSync(`${d}/rollback-founding-${RUN}.png`, { force: true });   // tidy the synthetic file
  runner("apply", "--to", "t8-storage-reservations");
  await reload(); await sleep(CACHE_WAIT);
  check("t8 is applied again: the table is empty (the in-flight reservation did not come back)", psql(`select count(*) from saas_storage_reservations`) === "0");
  const again = await upload(A, "over-again"); const ab = await json(again);
  check(`the boundary is exactly where it was: the stored files still count, the next upload is refused (402, limit ${ab.limitMb} MB)`, again.status === 402 && ab.code === "storage_limit_exceeded");
  await s3Delete(bigKey());
  await sleep(CACHE_WAIT);
  const two = await Promise.all([upload(A, "after-delete-a"), upload(A, "after-delete-b")]);
  const okTwo = two.filter((r) => r.status === 201).length;
  check(`a deleted file frees exactly its room: of two simultaneous uploads exactly one is accepted (${two.map((r) => r.status).join(",")})`, okTwo === 1 && two.some((r) => r.status === 402));
  check("no reservation is left pending", psql(`select count(*) from saas_storage_reservations where state='pending'`) === "0");

  // ================================================================ 2. rollback of the whole tenant series while pilot companies exist
  console.log("\n2. rollback t8 .. t1 while pilot companies exist");
  const OBJ1 = objectMap("co_alpha"), FP2 = fingerprint(); const INVROW = () => Object.fromEntries(psql(`select id || '=' || to_jsonb(i)::text from invoices i where company_id='co_alpha' order by id`).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), JSON.parse(l.slice(l.indexOf('=') + 1))])); const INV2 = INVROW();
  const countBefore = Object.keys(OBJ1).length;
  let refused = ""; try { runner("rollback", "--to", "t1-company-foundation"); } catch (e) { refused = String(e.message); }
  check("the rollback of t1 stops at t1b (the tenancy barrier, which sits right after t1): it REFUSES while the marker is on or companies other than the founding one exist; the message tells the operator to export or remove the pilot companies first", /Rollback refused: the tenancy marker is on\. Export or remove the pilot companies/.test(refused), refused.slice(0, 300));
  const ledger = psql(`select string_agg(migration_id || ':' || action || ':' || status, ' ' order by seq) from (select distinct on (migration_id) * from ops.migration_ledger where migration_id like 't%' order by migration_id, seq desc) l`);
  check("the refusal came after t8 .. t2 were rolled back (newest first) and left t1 and t1b applied (the rollback of t1b is recorded as failed): the schema is in the state 'foundation and barrier only'", /t8-storage-reservations:rollback:ok/.test(ledger) && /t2-ownership:rollback:ok/.test(ledger) && /t1b-tenancy-barrier:rollback:failed/.test(ledger), ledger);
  check(`in that state every stored object is still there, same keys, same bytes (${countBefore} objects)`, JSON.stringify(objectMap("co_alpha")) === JSON.stringify(OBJ1));
  const INV3 = INVROW();
  const sameButSnapshot = Object.keys(INV2).every((id) => INV3[id] && Object.keys(INV2[id]).filter((k) => k !== "issuance_snapshot").every((k) => JSON.stringify(INV2[id][k]) === JSON.stringify(INV3[id][k])));
  check("...and every document row of alpha is content-identical, and every invoice is still there with every column identical except the issuance snapshot (that column belongs to t6, which is rolled back; its values are kept in app_rollback_backup and come back below)", fingerprint().docs === FP2.docs && sameButSnapshot && Number(psql(`select count(*) from app_rollback_backup.invoice_issuance_snapshot`)) >= 1, JSON.stringify([fingerprint().docs, FP2.docs]));
  for (const id of Object.keys(INV2)) { const d = Object.keys({ ...INV2[id], ...(INV3[id] || {}) }).filter((k) => JSON.stringify(INV2[id][k]) !== JSON.stringify((INV3[id] || {})[k])); if (d.length) console.log(`   INVOICE-DIFF after the partial rollback (before applying again): ${id}: ${d.map((k) => `${k}: ${JSON.stringify(INV2[id][k])?.slice(0, 80)} -> ${JSON.stringify((INV3[id] || {})[k])?.slice(0, 80)}`).join(' ; ')}`); }
  runner("apply");
  await reload(); await sleep(6500);   // the application caches memberships and subscriptions for 5 s
  A = api((await login("alpha_admin")).token);
  check("everything is applied again (t2 .. t8): alpha signs in", Boolean((await login("alpha_admin")).token));
  { const INV4 = INVROW(); for (const id of Object.keys(INV2)) { const d = Object.keys({ ...INV2[id], ...(INV4[id] || {}) }).filter((k) => JSON.stringify(INV2[id][k]) !== JSON.stringify((INV4[id] || {})[k])); if (d.length) console.log(`   INVOICE-DIFF after applying again: ${id}: ${d.map((k) => `${k}: ${JSON.stringify(INV2[id][k])?.slice(0, 80)} -> ${JSON.stringify((INV4[id] || {})[k])?.slice(0, 80)}`).join(' ; ')}`); } }
  check("every document row and every invoice of alpha is exactly as before (content hash)", JSON.stringify(fingerprint()) === JSON.stringify(FP2));
  await downloadAll("after the partial rollback and applying again");
  const over = await upload(A, "over-after-full-rollback"); const ob = await json(over);
  check(`the limit survived (${L} MB) and the accounting is intact: an upload at the boundary is refused 402, not 403 "no limit" and not accepted (${over.status} ${ob.code})`, over.status === 402 && ob.code === "storage_limit_exceeded", JSON.stringify(ob).slice(0, 200));
  await s3Delete(bigKey()); await sleep(CACHE_WAIT);
  const one = await upload(A, "after-full-rollback-delete");
  check(`a deleted file frees exactly its room here too (accepted ${one.status}), then 402 again`, one.status === 201 && (await upload(A, "again2")).status === 402);
  // the operator can still onboard a company after the whole cycle (the onboarding function, its plan and its grants survived)
  const op2 = api((await login("platform_op")).token);
  const lc = RUN.toLowerCase();
  const onb = await op2("/api/platform/companies", { method: "POST", body: JSON.stringify({ name: `Rollback Co ${RUN}`, id: `rb_${lc}`, ownerName: "RB Owner", ownerUsername: `rb_owner_${lc}`, ownerEmail: `rb${lc}@example.test`, planId: "pilot", trialDays: 5, storageLimitMb: 10 }) });
  const onbb = await json(onb);
  check(`after the cycle the operator can still onboard a company (${onb.status})`, onb.status === 201, JSON.stringify(onbb).slice(0, 300));
} finally {
  try { runner("apply"); await reload(); } catch (e) { console.log("could not re-apply in cleanup: " + String(e).slice(0, 200)); }
}
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
