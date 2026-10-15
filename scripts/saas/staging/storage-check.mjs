#!/usr/bin/env node
// Real-storage checks for the staging rehearsal. It uses the application's OWN storage functions (server/storage/railwayObjectStorage.ts), so what it proves is what the
// application experiences: the same signing, the same timeouts, the same listing code that the storage quota relies on. It writes only under a unique throw-away prefix and
// deletes only what it wrote.
//
//   RAILWAY_S3_ENDPOINT=... RAILWAY_S3_BUCKET=<STAGING bucket> RAILWAY_S3_ACCESS_KEY_ID=... RAILWAY_S3_SECRET_ACCESS_KEY=... RAILWAY_S3_REGION=... \
//   STAGING_STORAGE_CONFIRM=<the same bucket name> node --import tsx scripts/saas/staging/storage-check.mjs [--objects 1100] [--sequential 25]
//
// Refuses to run unless STAGING_STORAGE_CONFIRM equals the configured bucket (so a production bucket cannot be hit by accident: you must type its name), and refuses a bucket
// named in PRODUCTION_S3_BUCKET. What it checks, and why the quota cares:
//   C1  read-after-write: after each PUT the key is in the very next listing  -> the storage quota counts what the listing shows; a lagging listing lets a burst overshoot
//   C2  overwrite and delete are visible in the next listing and the sizes are right
//   C3  pagination: a prefix with more objects than one page (S3: 1000) is listed completely, once each
//   C4  listing latency for that prefix is far below the quota's 8 s guard (otherwise uploads would be refused as 'could not verify storage')
//   C5  an unsigned request is refused (signature checking is on)
//   C6  a download returns the exact bytes
import crypto from "node:crypto";
import { deleteRailwayObject, getRailwayObject, listRailwayObjects, putRailwayObject } from "../../../server/storage/railwayObjectStorage.ts";

process.env.RAILWAY_OBJECT_PROXY_SECRET ||= crypto.randomBytes(24).toString("hex");   // the storage module insists on one; this check never builds a proxy link
const bucket = String(process.env.RAILWAY_S3_BUCKET || "");
const endpoint = String(process.env.RAILWAY_S3_ENDPOINT || "");
if (!bucket || !endpoint || !process.env.RAILWAY_S3_ACCESS_KEY_ID || !process.env.RAILWAY_S3_SECRET_ACCESS_KEY) { console.error("Set RAILWAY_S3_ENDPOINT, RAILWAY_S3_BUCKET, RAILWAY_S3_ACCESS_KEY_ID, RAILWAY_S3_SECRET_ACCESS_KEY (and RAILWAY_S3_REGION)."); process.exit(2); }
if (process.env.STAGING_STORAGE_CONFIRM !== bucket) { console.error(`Refusing: STAGING_STORAGE_CONFIRM must equal the bucket name (${bucket}). Type it on purpose; it must be the STAGING bucket.`); process.exit(2); }
if (process.env.PRODUCTION_S3_BUCKET && process.env.PRODUCTION_S3_BUCKET === bucket) { console.error("Refusing: this is the production bucket."); process.exit(2); }
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const N = arg("objects", 1100), SEQ = arg("sequential", 25);

const RUN = crypto.randomBytes(4).toString("hex");
const NS = "customer-documents";
const PREFIX = `c/_stagingcheck_${RUN}/`;
const written = [];
let failed = 0;
const say = (ok, msg, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${msg}${!ok && d ? " - " + String(d).slice(0, 300) : ""}`); if (!ok) failed++; };
const obs = (m) => console.log(`OBSERVED: ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const put = async (name, body) => { await putRailwayObject(NS, PREFIX + name, body, "application/octet-stream"); written.push(PREFIX + name); };

try {
  // C1: read-after-write, one object at a time
  let missing = 0; const lag = [];
  for (let i = 0; i < SEQ; i++) {
    const name = `seq-${i}.bin`; await put(name, Buffer.from(`seq ${i} ${RUN}`));
    const t0 = Date.now(); let seen = false;
    for (let k = 0; k < 20 && !seen; k++) { const l = await listRailwayObjects(NS, PREFIX); seen = l.some((o) => o.key === PREFIX + name); if (!seen) await sleep(250); }
    const ms = Date.now() - t0; lag.push(ms);
    const first = seen && ms < 200; // seen by the first listing (a listing itself takes longer than 0 ms)
    if (!seen) missing++; else if (!first) obs(`seq-${i} appeared only after ${ms} ms`);
  }
  say(missing === 0, `C1 read-after-write: ${SEQ} objects, each in a listing after its PUT (never seen: ${missing})`, `${missing} never appeared`);
  obs(`time until each new object was visible: p50 ${pct(lag, 50)} ms, p95 ${pct(lag, 95)} ms, max ${Math.max(...lag)} ms`);
  const strict = []; // the strict form: the VERY NEXT listing (no waiting) must contain it
  for (let i = 0; i < SEQ; i++) { const name = `strict-${i}.bin`; await put(name, Buffer.from(`strict ${i}`)); const l = await listRailwayObjects(NS, PREFIX); strict.push(l.some((o) => o.key === PREFIX + name)); }
  const lagged = strict.filter((x) => !x).length;
  say(lagged === 0, `C1b the VERY NEXT listing contains the object just written (${SEQ} tries; the cross-process storage accounting assumes this)`, `${lagged} of ${SEQ} were missing from the next listing: a burst could overshoot the limit by that window`);

  // C2: overwrite and delete
  await put("ow.bin", Buffer.alloc(1000, 1)); await put("ow.bin", Buffer.alloc(2500, 2));
  const ow = (await listRailwayObjects(NS, PREFIX)).find((o) => o.key === PREFIX + "ow.bin");
  say(ow?.size === 2500, "C2 an overwrite is visible with its new size in the next listing", `size ${ow?.size}`);
  await deleteRailwayObject(NS, PREFIX + "ow.bin"); written.splice(written.indexOf(PREFIX + "ow.bin"), 1);
  say(!(await listRailwayObjects(NS, PREFIX)).some((o) => o.key === PREFIX + "ow.bin"), "C2 a deleted object is gone from the next listing (a deletion frees quota at once)");

  // C3 / C4: pagination and listing latency
  const t0 = Date.now(); let idx = 0;
  await Promise.all(Array.from({ length: 20 }, async () => { for (;;) { const i = idx++; if (i >= N) return; await put(`bulk/${String(i).padStart(5, "0")}.bin`, Buffer.from("x")); } }));
  obs(`wrote ${N} small objects in ${Date.now() - t0} ms`);
  const lt = []; let listed = [];
  for (let k = 0; k < 5; k++) { const a = Date.now(); listed = await listRailwayObjects(NS, PREFIX + "bulk/"); lt.push(Date.now() - a); }
  const keys = new Set(listed.map((o) => o.key));
  say(listed.length === N && keys.size === N, `C3 pagination: ${N} objects (more than one page) listed completely and once each`, `listed ${listed.length}, unique ${keys.size}`);
  const small = await listRailwayObjects(NS, PREFIX + "bulk/", { pageSize: 100 });
  say(small.length === N, `C3 the same with a page size of 100 (${Math.ceil(N / 100)} pages)`, `listed ${small.length}`);
  say(pct(lt, 95) < 4000, `C4 listing ${N} objects: p50 ${pct(lt, 50)} ms, p95 ${pct(lt, 95)} ms, max ${Math.max(...lt)} ms (the quota refuses uploads after 8000 ms)`, `max ${Math.max(...lt)} ms`);

  // C5: signature checking. An unsigned request for a real object must NOT be answered with the object, in either addressing style.
  // (The repository's S3 stand-in does not verify signatures and answers 200: against it this check FAILS, which is how you know the check can fail.)
  const ep = new URL(endpoint);
  const urls = [`${endpoint.replace(/\/$/, "")}/${bucket}/${NS}/${PREFIX}seq-0.bin`, `${ep.protocol}//${bucket}.${ep.host}/${NS}/${PREFIX}seq-0.bin`];
  const statuses = [];
  for (const u of urls) statuses.push((await fetch(u).catch(() => ({ status: 0 }))).status);
  say(!statuses.includes(200), "C5 an UNSIGNED request for an object is not answered with the object, path-style or virtual-hosted (signature checking is on)", `statuses ${statuses.join(", ")}: the object was served without credentials`);

  // C6: exact bytes
  const payload = crypto.randomBytes(300_000);
  await put("bytes.bin", payload);
  const got = await getRailwayObject(NS, PREFIX + "bytes.bin");
  const body = got?.body ?? Buffer.alloc(0);
  say(Buffer.compare(body, payload) === 0, "C6 a 300 kB object comes back byte-identical", `got ${body.length} bytes`);
} catch (e) {
  say(false, "the check could not complete", e instanceof Error ? e.message : String(e));
} finally {
  let left = 0;
  for (let i = 0; i < written.length; i += 20) await Promise.all(written.slice(i, i + 20).map((k) => deleteRailwayObject(NS, k).catch(() => { left++; })));
  const rest = await listRailwayObjects(NS, PREFIX).catch(() => []);
  console.log(`cleanup: ${written.length} objects deleted, ${rest.length} left under ${PREFIX}${left ? ` (${left} deletes failed)` : ""}`);
  if (rest.length) failed++;
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll storage checks passed.");
process.exit(failed ? 1 : 0);
