// Storage limit across TWO server processes of the same build on one database and one object store. SYNTHETIC companies, disposable stack.
//   A  24 uploads of mixed routes (customer document / image) race over BOTH processes at the quota boundary: exactly as many are accepted as fit
//   B  a deleted file frees exactly its room: two simultaneous uploads (one per process) admit exactly one (finished reservations are not counted twice)
//   C  failed writes (store answers 503) through both processes give their room back at once: no reservation left, the room is still all there
//   D  the founding company is never metered and never reserves
//   E  the database refuses the reservation (privilege withdrawn): both processes fail CLOSED with a retryable 503; reading works; no restart needed after
//   F  a process KILLED mid-upload leaves a pending reservation that counts while it lives and stops counting once it expires; nothing is lost or stuck
//   Env: E2E_BASE_URL (process 1), E2E_BASE_URL_2 (process 2), E2E_APP2_PID, E2E_S3_DIR (stand-in objects dir; "fault" is read from its parent), RAILWAY_S3_ENDPOINT,
//        E2E_PSQL, TEST_PW. The runner starts both processes with STORAGE_USAGE_CACHE_MS / STORAGE_LIMIT_CACHE_MS = 2000 and process 2 with a 12 s reservation expiry.
//   Seed first: seed-two-companies.mjs
import "./lib/fresh-connections.mjs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const BASE1 = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", BASE2 = process.env.E2E_BASE_URL_2;
const PW = process.env.TEST_PW, S3DIR = process.env.E2E_S3_DIR, APP2_PID = Number(process.env.E2E_APP2_PID), APP1_PID = Number(process.env.E2E_APP1_PID);
if (!PW || !S3DIR || !BASE2 || !APP2_PID || !process.env.E2E_PSQL || !process.env.RAILWAY_S3_ENDPOINT || /sunchaserenergy|railway\.app/.test(BASE1)) { console.error("Set TEST_PW, E2E_S3_DIR, E2E_BASE_URL_2, E2E_APP2_PID, E2E_PSQL, RAILWAY_S3_ENDPOINT and point E2E_BASE_URL at a local stack."); process.exit(2); }
const FAULT = path.join(S3DIR, "..", "fault");
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-v", "ON_ERROR_STOP=1", "-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + String(detail).slice(0, 400) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = randomBytes(3).toString("hex").toUpperCase();
const CACHE_WAIT = Number(process.env.STORAGE_TEST_WAIT_MS || 3500);
const MB = 1024 * 1024;

const login = async (base, username) => json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }));
const caller = (base, token) => (p, init = {}) => fetch(base + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
// one signed-in caller per company PER PROCESS (the same token works on both: they share the secret)
const tokenOf = {}; for (const u of ["alpha_admin", "platform_op", "t_admin"]) tokenOf[u] = (await login(BASE1, u)).token;
const on = (n, user) => caller(n === 1 ? BASE1 : BASE2, tokenOf[user]);
const alpha = [null, on(1, "alpha_admin"), on(2, "alpha_admin")];
const OP = on(1, "platform_op");
const health = async (base) => (await fetch(base + "/health").catch(() => ({ status: 0 }))).status;
check("both server processes answer, and they are different processes", (await health(BASE1)) === 200 && (await health(BASE2)) === 200 && APP1_PID !== APP2_PID && APP1_PID > 0 && APP2_PID > 0);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const setFault = (mode) => (mode ? fs.writeFileSync(FAULT, mode + "\n") : fs.rmSync(FAULT, { force: true }));
process.on("exit", () => { setFault(null); try { psql(`grant execute on function public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer) to service_role`); } catch { /* best effort */ } });
const objs = (co) => fs.readdirSync(S3DIR).filter((f) => decodeURIComponent(f).includes(`/c/${co}/`));
const usedBytes = (co) => objs(co).reduce((n, f) => n + fs.statSync(path.join(S3DIR, f)).size, 0);
const s3Delete = (key) => new Promise((resolve, reject) => { const u = new URL(process.env.RAILWAY_S3_ENDPOINT + "/" + encodeURI(key)); const rq = https.request(u, { method: "DELETE", rejectUnauthorized: false }, (r) => { r.resume(); r.on("end", () => resolve(r.statusCode)); }); rq.on("error", reject); rq.end(); });
// the stored files that are as large as the test files (not the tiny ones that primed the caches)
const bigKeys = (co, min) => objs(co).filter((f) => fs.statSync(path.join(S3DIR, f)).size >= min).map(decodeURIComponent);
const rows = (state) => Number(psql(`select count(*) from saas_storage_reservations where company_id='co_alpha'${state ? ` and state='${state}'` : ""}`));
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };
const png = (bytes) => { const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return Buffer.concat([sig, Buffer.alloc(Math.max(0, bytes - sig.length), 0x00)]); };

// a customer for the documents of alpha
const inv = await json(await alpha[1]("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `two-instance customer ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "item", description: "item", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] }) }));
const customerId = inv.invoice?.customerId;
check("alpha has a customer to attach documents to", Boolean(customerId));
const send = (n, kind, bytes, tag) => kind === "document"
  ? alpha[n]("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: `${tag} ${RUN}`, fileName: `${tag}.pdf`, mimeType: "application/pdf", base64Data: pdf(bytes, tag).toString("base64") }) })
  : alpha[n]("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(bytes).toString("base64")}`, filename: `${tag}.png` }) });
const outcome = async (r) => { const b = await json(r); return { status: r.status, code: b.code, retryable: b.retryable, body: b }; };
const setLimit = (mb) => OP(`/api/platform/companies/co_alpha`, { method: "PATCH", body: JSON.stringify({ limitOverrides: { max_storage_mb: mb } }) });

// ================================================================ A. the boundary, raced over both processes
console.log("\nA. 24 uploads (documents and images) race over both processes at the boundary");
const before = usedBytes("co_alpha");
const L = Math.ceil(before / MB) + 1, free = L * MB - before, S = Math.floor(free / 5.5), N = Math.floor(free / S);
check(`the operator sets a ${L} MB limit for alpha (it stores ${(before / MB).toFixed(2)} MB; ${N} files of ${(S / 1024).toFixed(0)} KB fit)`, (await setLimit(L)).status === 200);
await sleep(CACHE_WAIT);
// prime BOTH processes' caches with a tiny accepted upload each, so both race on their own (stale) measurement
for (const n of [1, 2]) await send(n, "image", 1200, `prime${n}`).then(async (r) => r.status);
await sleep(300);
const objBefore = objs("co_alpha").length, bytesBefore = usedBytes("co_alpha");
const room0 = L * MB - bytesBefore, N0 = Math.floor(room0 / S);
const jobs = Array.from({ length: 24 }, (_, i) => ({ i, n: (i % 2) + 1, kind: Math.floor(i / 2) % 2 ? "image" : "document" }));
const res = await Promise.all(jobs.map(async (j) => ({ ...j, ...(await outcome(await send(j.n, j.kind, S, `race${j.i}`))) })));
const acc = res.filter((r) => r.status === 200 || r.status === 201), ref = res.filter((r) => r.status === 402 && r.code === "storage_limit_exceeded");
console.log(`   by process: ${[1, 2].map((n) => `#${n} accepted ${acc.filter((r) => r.n === n).length}, refused ${ref.filter((r) => r.n === n).length}`).join("; ")}`);
check(`exactly ${N0} of the 24 are accepted (got ${acc.length}) and the other ${24 - N0} are refused with 402 storage_limit_exceeded (got ${ref.length})`, acc.length === N0 && ref.length === 24 - N0, JSON.stringify(res.map((r) => r.status)));
check("both processes took part: each answered every request it received with an accepted upload or a 402 refusal (never a 5xx); which process wins the last slots is scheduling and is not asserted", [1, 2].every((n) => res.filter((r) => r.n === n).length === 12 && res.filter((r) => r.n === n).every((r) => r.status === 200 || r.status === 201 || r.status === 402)), JSON.stringify(res.map((r) => `${r.n}:${r.status}`)));
check("the object store holds exactly the accepted files and the company is within its limit", objs("co_alpha").length === objBefore + acc.length && usedBytes("co_alpha") <= L * MB, `${usedBytes("co_alpha")} of ${L * MB}`);
check("no reservation is left pending; the accepted uploads are kept as finished reservations", rows("pending") === 0 && rows("done") >= acc.length, `pending ${rows("pending")}, done ${rows("done")}`);
check("every refusal says existing files are safe and is not retryable", ref.every((r) => r.retryable === false && /existing files are safe/i.test(r.body.error || "")));
await sleep(CACHE_WAIT);
const after = await Promise.all([1, 2].map(async (n) => (await send(n, "document", S, `full${n}`)).status));
check("once both processes list again, both still refuse (402): the full company is not 'freed' by the reservations expiring or being counted twice", after.every((s) => s === 402), after.join(","));

// ================================================================ B. a deleted file frees exactly its room
console.log("\nB. a deleted file frees exactly its room");
const victim = bigKeys("co_alpha", S)[0];
const delStatus = await s3Delete(victim);
check(`one stored file is deleted (HTTP ${delStatus})`, delStatus === 204 || delStatus === 200);
await sleep(CACHE_WAIT);
const roomNow = L * MB - usedBytes("co_alpha"), fit = Math.floor(roomNow / S);
const two = await Promise.all([1, 2].map(async (n) => (await outcome(await send(n, "document", S, `after-delete${n}`))).status));
const okTwo = two.filter((s) => s === 200 || s === 201).length;
check(`room for ${fit} file(s) now: exactly ${fit} of 2 simultaneous uploads (one per process) are accepted (got ${okTwo}: ${two.join(",")})`, okTwo === fit, two.join(","));
check("...and the company is still within its limit", usedBytes("co_alpha") <= L * MB);

// ================================================================ C. failed writes give their room back
console.log("\nC. failed writes (store answers 503) through both processes");
for (const k of bigKeys("co_alpha", S).slice(0, 2)) await s3Delete(k);
await sleep(CACHE_WAIT);
const room2 = L * MB - usedBytes("co_alpha"), fit2 = Math.floor(room2 / S);
check(`two files were deleted: room for ${fit2} files`, fit2 >= 2, `${fit2}`);
const objC = objs("co_alpha").length;
setFault("put");
const failed = await Promise.all(Array.from({ length: 8 }, (_, i) => send((i % 2) + 1, i % 4 < 2 ? "document" : "image", S, `fail${i}`).then(async (r) => ({ status: r.status }))));
setFault(null);
check(`8 uploads whose write fails (both processes): none is accepted (${failed.map((f) => f.status).join(",")}), nothing is stored`, failed.every((f) => f.status >= 400) && objs("co_alpha").length === objC);
check("...and no reservation was left behind by the failures", rows("pending") === 0, `pending ${rows("pending")}`);
const again = await Promise.all(Array.from({ length: fit2 + 3 }, (_, i) => send((i % 2) + 1, "document", S, `again${i}`).then((r) => r.status)));
check(`the failures used up none of the room: exactly ${fit2} of ${fit2 + 3} later uploads are accepted (got ${again.filter((s) => s === 200 || s === 201).length})`, again.filter((s) => s === 200 || s === 201).length === fit2, again.join(","));

// ================================================================ D. founding company
console.log("\nD. the founding company is never metered");
{
  const before = rows();
  const f = on(2, "t_admin");
  const r = await f("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(2000).toString("base64")}`, filename: `founding-${RUN}.png` }) });
  check(`the founding administrator's upload through process 2 is accepted (${r.status})`, r.status === 200);
  check("...and made no reservation of any company", rows() === before && Number(psql(`select count(*) from saas_storage_reservations where company_id='sunchaser'`)) === 0);
  try { fs.rmSync(`public/uploads/founding-${RUN}.png`, { force: true }); fs.rmSync(`dist/public/uploads/founding-${RUN}.png`, { force: true }); } catch { /* tidy */ }
}

// ================================================================ E. the database refuses: fail closed on both processes, recover without a restart
console.log("\nE. the reservation function is not available: fail closed on both processes");
for (const k of bigKeys("co_alpha", S).slice(0, 2)) await s3Delete(k);
await sleep(CACHE_WAIT);
const FN = "public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)";
psql(`revoke execute on function ${FN} from service_role`);
const objE = objs("co_alpha").length;
const refused = await Promise.all([1, 2].map(async (n) => { const r = await send(n, "document", S, `nodb${n}`); return { n, status: r.status, retryAfter: r.headers.get("retry-after"), ...(await outcome(r)) }; }));
check("with the function unavailable, an upload through each process is refused 503 storage_unverified, retryable, with Retry-After", refused.every((r) => r.status === 503 && r.code === "storage_unverified" && r.retryable === true && Number(r.retryAfter) > 0), JSON.stringify(refused.map((r) => [r.status, r.code, r.retryAfter])));
check("...nothing was written", objs("co_alpha").length === objE);
check("...and reading still works on both processes", (await Promise.all([1, 2].map((n) => alpha[n]("/api/state")))).every((r) => r.status === 200));
if (process.env.E2E_APP1_LOG && fs.existsSync(process.env.E2E_APP1_LOG)) check("the application log says which function failed (so an operator can see that the migration is missing or the privilege withdrawn)", /saas_storage_(reserve|mark) failed|saas_storage_(reserve|mark) is missing/.test(fs.readFileSync(process.env.E2E_APP1_LOG, "utf8")));
psql(`grant execute on function ${FN} to service_role`);
const back = await Promise.all([1, 2].map(async (n) => (await send(n, "document", S, `db-back${n}`)).status));
check(`once the privilege is back, uploads work again with no restart (${back.join(",")})`, back.every((s) => s === 200 || s === 201), back.join(","));

// ================================================================ F. a process killed mid-upload
console.log("\nF. process 2 is killed in the middle of an upload");
for (const k of bigKeys("co_alpha", S).slice(0, 3)) await s3Delete(k);
await sleep(CACHE_WAIT);
const roomF = L * MB - usedBytes("co_alpha"), fitF = Math.floor(roomF / S);
check(`room for exactly ${fitF} file(s); to make one reservation matter, fill all but one`, fitF >= 1, `${fitF}`);
for (let i = 0; i < fitF - 1; i++) await send(1, "document", S, `fill${i}`);
await sleep(CACHE_WAIT);
check("one file's room is left", Math.floor((L * MB - usedBytes("co_alpha")) / S) === 1, `${Math.floor((L * MB - usedBytes("co_alpha")) / S)}`);
const pendingBefore = rows("pending");
setFault("puthang");
const stuck = send(2, "document", S, `stuck-${RUN}`).then((r) => r.status).catch(() => "connection closed");
let seen = 0; for (let i = 0; i < 40 && !seen; i++) { await sleep(250); seen = rows("pending") - pendingBefore; }
check("process 2 accepted the upload and holds a pending reservation while its write hangs", seen === 1, `${seen}`);
process.kill(APP2_PID, "SIGKILL");
await sleep(500);
check("process 2 is gone (killed with SIGKILL, no chance to release anything)", !alive(APP2_PID));
setFault(null);
check("its reservation is still there, pending, after the kill", rows("pending") - pendingBefore === 1, `${rows("pending") - pendingBefore}`);
check("the stuck request ended without a success", (await stuck) !== 201 && (await stuck) !== 200, String(await stuck));
await sleep(CACHE_WAIT);
const blocked = await outcome(await send(1, "document", S, "while-dead-holds"));
check("while the dead process's reservation is live, process 1 counts it: the last file's room is NOT given away (402)", blocked.status === 402, `${blocked.status} ${blocked.code}`);
// wait for its expiry (12 s on process 2), polling the database
let waited = 0; while (rows("pending") - pendingBefore > 0 && waited < 40) { await sleep(1000); waited++; if (waited >= 12 && rows("pending") - pendingBefore > 0) { /* the purge happens on the next reservation attempt */ const t = await send(1, "document", S, `probe${waited}`); if (t.status === 200 || t.status === 201) { waited = -1; break; } } }
const stillThere = Number(psql(`select count(*) from saas_storage_reservations where company_id='co_alpha' and state='pending' and expires_at < clock_timestamp()`));
check(`after its expiry (about 12 s) the reservation no longer blocks anyone and was purged (waited ~${waited < 0 ? "until the room came back" : waited + " s"})`, rows("pending") === pendingBefore && stillThere === 0, `pending ${rows("pending")} expired-but-present ${stillThere}`);
const live = alive(APP1_PID) && (await health(BASE1)) === 200;
check("process 1 kept serving throughout (no restart needed anywhere)", live);

console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
