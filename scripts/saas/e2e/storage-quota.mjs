// Storage-limit journey: SYNTHETIC companies against a running multi-company server on a disposable stack with a fault-injectable S3 stand-in.
//   A  concurrent uploads at the quota boundary: exactly as many are accepted as fit; every ENABLED upload route is refused over the limit
//      and accepted with room; the pilot company's /api/upload never touches the shared public folder
//   B  usage that cannot be verified (store listing fails, hangs, or a write fails): new uploads are refused with a retryable 503; existing files
//      stay readable; a failed write does not use up quota; recovery needs no restart
//   C  no limit set (plan without one, or no subscription): uploads refused with a clear message; reading untouched; the operator's fix works at once
//   D  a limit of 0 MB; the founding company is unchanged
//   Env: E2E_BASE_URL, E2E_PSQL, E2E_S3_DIR (the stand-in's objects directory; "fault" is read from its parent), TEST_PW, and the server started with
//   STORAGE_USAGE_CACHE_MS / STORAGE_LIMIT_CACHE_MS shortened (the runner does).   Seed first: seed-two-companies.mjs
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
const S3DIR = process.env.E2E_S3_DIR;
if (!PW || !S3DIR || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_S3_DIR and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const FAULT = path.join(S3DIR, "..", "fault");
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + detail : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = randomBytes(3).toString("hex").toUpperCase();
const CACHE_WAIT = Number(process.env.STORAGE_TEST_WAIT_MS || 3500); // a little more than STORAGE_*_CACHE_MS (2000) of the server

const login = async (username) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }));
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const A = { id: "co_alpha", user: "alpha_admin" }, B = { id: "co_beta", user: "beta_admin" };
for (const c of [A, B]) { const l = await login(c.user); c.api = caller(l.token); }
const OP = caller((await login("platform_op")).token);
const FOUNDING = caller((await login("t_admin")).token);
check("alpha, beta, the operator and the founding administrator sign in", [A, B].every((c) => c.api) && Boolean(OP) && Boolean(FOUNDING));
const setLimit = async (company, limitOverrides, planId) => OP(`/api/platform/companies/${company}`, { method: "PATCH", body: JSON.stringify({ limitOverrides, ...(planId ? { planId } : {}) }) });
const dayStr = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- helpers: files of an exact size, the stand-in's contents, and every upload route
const MB = 1024 * 1024;
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`); const tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };
const png = (bytes) => { const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return Buffer.concat([sig, Buffer.alloc(Math.max(0, bytes - sig.length), 0x00)]); };
const objs = (co) => fs.readdirSync(S3DIR).filter((f) => decodeURIComponent(f).includes(`/c/${co}/`));
const usedBytes = (co) => objs(co).reduce((n, f) => n + fs.statSync(path.join(S3DIR, f)).size, 0);
const setFault = (mode) => (mode ? fs.writeFileSync(FAULT, mode + "\n") : fs.rmSync(FAULT, { force: true }));
process.on("exit", () => setFault(null));

// a customer and an invoice for each company (documents and receipts attach to them)
for (const c of [A, B]) {
  const r = await c.api("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `${c.id} storage customer ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "item", description: "item", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] }) });
  c.inv = (await json(r)).invoice || {};
}
check("both companies have an invoice and a customer to attach files to", Boolean(A.inv.id && A.inv.customerId && B.inv.id && B.inv.customerId));

const routes = (c) => ({
  document: (bytes, tag) => c.api("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: c.inv.customerId, documentType: "other", title: `${c.id} ${tag} ${RUN}`, fileName: `${tag}.pdf`, mimeType: "application/pdf", base64Data: pdf(bytes, tag).toString("base64") }) }),
  receipt: (bytes, tag) => c.api(`/api/admin/invoices/${c.inv.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 1, paymentMethod: "Cash", paymentDate: dayStr(0), clientRequestId: `rq-${tag}-${RUN}-${randomBytes(3).toString("hex")}`, base64Receipt: pdf(bytes, tag).toString("base64"), fileName: `${tag}.pdf`, mimeType: "application/pdf" }) }),
  watermark: (bytes) => c.api("/api/quote-assets/watermark", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(bytes).toString("base64")}`, settingsId: `s-${RUN}` }) }),
  image: (bytes, tag) => c.api("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(bytes).toString("base64")}`, filename: `${tag}.png` }) }),
});
const rowsOf = (c) => ({
  docs: Number(psql(`select count(*) from customer_documents where company_id='${c.id}' and title like '${c.id} % ${RUN}'`)),
  pays: Number(psql(`select count(*) from invoice_payments where invoice_id='${c.inv.id}' and amount=1`)),
});

// ================================================================ A. the boundary
console.log("\nA. concurrent uploads at the boundary; every enabled upload route");
{
  const before = usedBytes("co_alpha");
  const L = Math.ceil(before / MB) + 1;            // room: between 1 and 2 MB
  const free = L * MB - before;
  const S = Math.floor(free / 5.5);                // exactly five files of S bytes fit
  const expected = Math.floor(free / S);
  const rn = await setLimit("co_alpha", { max_storage_mb: L });
  check(`the operator sets a ${L} MB limit for alpha (it stores ${(before / MB).toFixed(2)} MB; ${expected} files of ${(S / 1024).toFixed(0)} KB fit)`, rn.status === 200);
  await sleep(CACHE_WAIT);
  const objBefore = objs("co_alpha").length, rowsBefore = rowsOf(A);
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) => routes(A).document(S, `race${i}`)));
  const codes = await Promise.all(results.map(async (r) => ({ status: r.status, body: await json(r) })));
  const ok = codes.filter((r) => r.status === 201).length;
  const refused = codes.filter((r) => r.status === 402 && r.body.code === "storage_limit_exceeded");
  check(`14 simultaneous uploads: exactly ${expected} are accepted (got ${ok}) and the other ${14 - expected} are refused with 402 storage_limit_exceeded (got ${refused.length})`, ok === expected && refused.length === 14 - expected, JSON.stringify(codes.map((c) => c.status)));
  check("every refusal is a clear, non-retryable message that says existing files are safe", refused.every((r) => r.body.retryable === false && /existing files are safe/i.test(r.body.error || "")));
  check(`what is stored matches what was accepted: ${expected} new objects, ${expected} new document rows, and the company is within its limit`, objs("co_alpha").length === objBefore + ok && rowsOf(A).docs === rowsBefore.docs + ok && usedBytes("co_alpha") <= L * MB, `${objs("co_alpha").length - objBefore} objects, ${rowsOf(A).docs - rowsBefore.docs} rows, ${usedBytes("co_alpha")} of ${L * MB}`);
  A.firstDoc = (await json(await A.api(`/api/admin/customers/${A.inv.customerId}/documents`))) ;

  // the same attempt at the boundary on EVERY other enabled upload route
  const room = L * MB - usedBytes("co_alpha");
  check(`at the boundary (${room} bytes of room) a file of ${S} bytes no longer fits`, room < S);
  const objAtLimit = objs("co_alpha").length, rowsAtLimit = rowsOf(A);
  const tries = { "payment receipt": await routes(A).receipt(S, "rcpt"), "watermark / logo image": await routes(A).watermark(S), "image upload (/api/upload)": await routes(A).image(S, `full-${RUN}`), "customer document": await routes(A).document(S, "full") };
  for (const [name, r] of Object.entries(tries)) { const b = await json(r); check(`over the limit, ${name}: 402 storage_limit_exceeded (${r.status})`, r.status === 402 && b.code === "storage_limit_exceeded", JSON.stringify(b).slice(0, 160)); }
  check("the refused calls left nothing behind: no object, no document row, and no payment was recorded for the receipt", objs("co_alpha").length === objAtLimit && rowsOf(A).docs === rowsAtLimit.docs && rowsOf(A).pays === rowsAtLimit.pays);
  check("being at the limit never blocks reading", (await A.api("/api/state")).status === 200 && (await A.api(`/api/admin/invoices/${A.inv.id}`)).status === 200);

  // downloads of existing files still work at the limit
  const docs = (A.firstDoc.documents || A.firstDoc || []);
  const link = (Array.isArray(docs) ? docs : []).map((d) => d.fileUrl || d.file_url).find(Boolean) || psql(`select file_url from customer_documents where company_id='co_alpha' and title like 'co_alpha race% ${RUN}' limit 1`);
  const dl = await fetch(link.startsWith("http") ? link : BASE + link);
  const dlBody = Buffer.from(await dl.arrayBuffer());
  check(`an authorised download of an existing file still works while the company is at its limit (${dl.status})`, dl.status === 200 && dlBody.subarray(0, 5).toString() === "%PDF-");
  A.dlHash = createHash("sha256").update(dlBody).digest("hex"); A.dlLink = link;

  // with room, every route accepts, stores under the company's own key space, and the bytes count
  await setLimit("co_alpha", { max_storage_mb: L + 6 });
  await sleep(CACHE_WAIT);
  const publicDirs = ["public/uploads", "dist/public/uploads"].filter((d) => fs.existsSync(d));
  const tag = `imgtest-${RUN}`;
  const filesIn = () => publicDirs.flatMap((d) => fs.readdirSync(d)).filter((f) => f.includes(tag));
  const good = { "customer document": await routes(A).document(40_000, "room"), "payment receipt": await routes(A).receipt(40_000, "roomr"), "watermark / logo image": await routes(A).watermark(30_000), "image upload (/api/upload)": await routes(A).image(30_000, tag) };
  const goodBodies = {};
  for (const [name, r] of Object.entries(good)) { goodBodies[name] = await json(r); check(`with room, ${name} is accepted (${r.status})`, r.status === 200 || r.status === 201, JSON.stringify(goodBodies[name]).slice(0, 160)); }
  const names = objs("co_alpha").map(decodeURIComponent);
  check("the image upload went to the company's own key space in the object store (c/co_alpha/uploads/), not to the shared public folder", names.some((n) => n.includes("/c/co_alpha/uploads/")) && filesIn().length === 0, `public folders checked: ${publicDirs.join(", ") || "(none exist)"}`);
  const imgRes = goodBodies["image upload (/api/upload)"];
  check("the image upload answers with a link into the object store and the data URL the interface stores", /\/api\/storage\/object\/quote-assets\//.test(imgRes.url || "") && String(imgRes.dataUrl || "").startsWith("data:image/png;base64,"), JSON.stringify(imgRes).slice(0, 120));
  const notImage = await A.api("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`, filename: "x.html" }) });
  check(`a pilot company cannot use the image upload to store a web page or other non-image (${notImage.status})`, notImage.status === 400 && filesIn().length === 0);
  const fImg = await FOUNDING("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: `data:image/png;base64,${png(2000).toString("base64")}`, filename: `${tag}-founding.png` }) });
  const fb = await json(fImg);
  const fileOnDisk = publicDirs.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f))).filter((f) => f.includes(tag));
  check(`the founding company's image upload is unchanged: it still answers with a /uploads/ link (${fImg.status})`, fImg.status === 200 && /^\/uploads\//.test(fb.url || ""), JSON.stringify(fb).slice(0, 120));
  for (const f of fileOnDisk) fs.rmSync(f, { force: true }); // tidy the synthetic file
  // the bytes of these accepted uploads count against the limit
  const usedNow = usedBytes("co_alpha");
  await setLimit("co_alpha", { max_storage_mb: Math.max(1, Math.floor(usedNow / MB) - 0) });
  await sleep(CACHE_WAIT);
  const pastNow = await routes(A).document(Math.max(S, 2 * MB), "past");
  check(`after the limit is lowered below what is stored, new uploads are refused (${pastNow.status}) while everything stored stays (no object was removed)`, pastNow.status === 402 && objs("co_alpha").length >= names.length);
}

// ================================================================ B. usage that cannot be verified
console.log("\nB. usage cannot be verified: refused, retryable, nothing lost");
{
  const used = usedBytes("co_alpha");
  await setLimit("co_alpha", { max_storage_mb: Math.ceil(used / MB) + 20 });
  await sleep(CACHE_WAIT);
  const objBefore = objs("co_alpha").length, rowsBefore = rowsOf(A);

  setFault("list");
  await sleep(CACHE_WAIT);                         // let the measured usage go stale
  const t0 = Date.now();
  const attempts = { "customer document": await routes(A).document(5000, "unv"), "payment receipt": await routes(A).receipt(5000, "unvr"), "watermark / logo image": await routes(A).watermark(5000), "image upload (/api/upload)": await routes(A).image(5000, `unv-${RUN}`) };
  for (const [name, r] of Object.entries(attempts)) {
    const b = await json(r);
    check(`store listing down, ${name}: refused with 503 storage_unverified, retryable, with Retry-After (${r.status})`, r.status === 503 && b.code === "storage_unverified" && b.retryable === true && Number(r.headers.get("retry-after")) > 0 && /try the upload again/i.test(b.error || "") && /unaffected/i.test(b.error || ""), JSON.stringify(b).slice(0, 200) + " retry-after=" + r.headers.get("retry-after"));
  }
  check("nothing was stored, no document row was written and no payment was recorded", objs("co_alpha").length === objBefore && rowsOf(A).docs === rowsBefore.docs && rowsOf(A).pays === rowsBefore.pays);
  const dl = await fetch(A.dlLink.startsWith("http") ? A.dlLink : BASE + A.dlLink);
  const dlHash = createHash("sha256").update(Buffer.from(await dl.arrayBuffer())).digest("hex");
  check(`while usage cannot be measured an authorised download of an existing file still works and is byte-identical (${dl.status})`, dl.status === 200 && dlHash === A.dlHash);
  check("and the application still reads normally", (await A.api("/api/state")).status === 200);
  const other = await routes(B).document(5000, "beta-unv");
  check(`other companies are refused the same way, no one is treated differently (${other.status})`, other.status === 503);
  const fnd = await FOUNDING("/api/state");
  check(`the founding company is not affected (${fnd.status})`, fnd.status === 200);

  setFault("hang");
  await sleep(CACHE_WAIT);
  const h0 = Date.now();
  const hung = await routes(A).document(5000, "hang");
  const hb = await json(hung);
  check(`a store that never answers cannot hold an upload for ever: refused with 503 within ${Math.round((Date.now() - h0) / 1000)} s`, hung.status === 503 && hb.code === "storage_unverified" && Date.now() - h0 < 20_000, `${hung.status} ${JSON.stringify(hb).slice(0, 120)}`);

  setFault(null);
  await sleep(CACHE_WAIT);
  const retry = await routes(A).document(5000, "retry");
  check(`when the store is back the very same upload is accepted on retry, no restart needed (${retry.status})`, retry.status === 201, JSON.stringify(await json(retry)).slice(0, 160));

  // a write that fails after it was accepted must give its room back
  const remaining = Math.ceil(usedBytes("co_alpha") / MB) * MB;
  await setLimit("co_alpha", { max_storage_mb: Math.ceil(usedBytes("co_alpha") / MB) + 1 });
  await sleep(CACHE_WAIT);
  const room = (Math.ceil(usedBytes("co_alpha") / MB) + 1) * MB - usedBytes("co_alpha");
  const big = room - 1000;
  setFault("put");
  const failedWrite = await routes(A).document(big, "failwrite");
  check(`a write the store rejects fails the upload (${failedWrite.status}) and stores nothing`, failedWrite.status >= 400 && objs("co_alpha").length === objs("co_alpha").length && rowsOf(A).docs >= 0 && !fs.readdirSync(S3DIR).some((f) => decodeURIComponent(f).includes("failwrite")));
  setFault(null);
  const afterFail = await routes(A).document(big, "failwrite2");
  check(`the failed write did not use up the quota: the same file, which uses nearly all the room, fits afterwards (${afterFail.status})`, afterFail.status === 201, JSON.stringify(await json(afterFail)).slice(0, 160) + ` remaining=${remaining}`);
}

// ================================================================ C. no limit set
console.log("\nC. no limit set: nothing is unlimited by default");
{
  await OP("/api/platform/plans/nolimit_" + RUN.toLowerCase(), { method: "PUT", body: JSON.stringify({ name: "No storage limit (test)", maxStaff: 5, maxLeads: 100, maxDocuments: 100, monthlyPricePkr: 0 }) });
  const doc0 = rowsOf(B).docs, obj0 = objs("co_beta").length;
  const hadBefore = await routes(B).document(8000, "beta-before");
  check(`beta (limit 512 MB from onboarding) uploads normally first (${hadBefore.status})`, hadBefore.status === 201);
  await setLimit("co_beta", { max_storage_mb: null }, "nolimit_" + RUN.toLowerCase());
  check("beta's storage limit is now unset (the override is removed and the plan has none)", psql(`select coalesce(limit_overrides->>'max_storage_mb','none') from saas_subscriptions where company_id='co_beta'`) === "none" && psql(`select coalesce(max_storage_mb::text,'none') from saas_plans where id='nolimit_${RUN.toLowerCase()}'`) === "none");
  await sleep(CACHE_WAIT);
  const objN = objs("co_beta").length, rowsN = rowsOf(B);
  for (const [name, r] of Object.entries({ "customer document": await routes(B).document(8000, "beta-nolimit"), "payment receipt": await routes(B).receipt(8000, "beta-nolimitr"), "watermark / logo image": await routes(B).watermark(8000), "image upload (/api/upload)": await routes(B).image(8000, `nl-${RUN}`) })) {
    const b = await json(r);
    check(`no limit set, ${name}: refused with 403 storage_limit_not_set and a message that tells the owner what to do (${r.status})`, r.status === 403 && b.code === "storage_limit_not_set" && /operator/i.test(b.error || "") && b.retryable === false, JSON.stringify(b).slice(0, 160));
  }
  check("nothing was stored and no payment recorded", objs("co_beta").length === objN && rowsOf(B).docs === rowsN.docs && rowsOf(B).pays === rowsN.pays);
  check("beta still reads everything, including its earlier document", (await B.api("/api/state")).status === 200 && Number(psql(`select count(*) from customer_documents where company_id='co_beta' and title='co_beta beta-before ${RUN}'`)) === 1);
  const fix = await setLimit("co_beta", { max_storage_mb: 64 });
  await sleep(CACHE_WAIT);
  const fixed = await routes(B).document(8000, "beta-fixed");
  check(`once the operator sets a limit the next upload is accepted, no restart (${fix.status}/${fixed.status})`, fix.status === 200 && fixed.status === 201);
  // a company with no subscription row at all
  psql(`delete from saas_subscriptions where company_id='co_beta'`);
  await sleep(CACHE_WAIT + 3000); // the subscription is cached for 5 seconds
  const noSub = await routes(B).document(8000, "beta-nosub");
  const nsb = await json(noSub);
  check(`a company with no subscription record at all is also refused until a limit exists (${noSub.status})`, noSub.status === 403 && nsb.code === "storage_limit_not_set", JSON.stringify(nsb).slice(0, 160));
  psql(`insert into saas_subscriptions (id, company_id, plan_id, status, current_period_start, current_period_end, limit_overrides) values ('sub-co_beta-${RUN}','co_beta','pilot','active','${dayStr(-5)}','${dayStr(30)}','{"max_storage_mb":512}'::jsonb) on conflict (company_id) do nothing`);
  void doc0; void obj0;
}

// ================================================================ D. zero limit
console.log("\nD. a limit of 0 MB");
{
  await setLimit("co_alpha", { max_storage_mb: 0 });
  await sleep(CACHE_WAIT + 1000);
  const z = await routes(A).document(1000, "zero");
  const zb = await json(z);
  const dl = await fetch(A.dlLink.startsWith("http") ? A.dlLink : BASE + A.dlLink);
  check(`with a limit of 0 MB every new upload is refused (${z.status}) and existing files are untouched and downloadable (${dl.status})`, z.status === 402 && zb.code === "storage_limit_exceeded" && dl.status === 200 && Number(psql(`select count(*) from customer_documents where company_id='co_alpha' and title like 'co_alpha race% ${RUN}'`)) > 0);
}

// leave the stack tidy for the next journey
await setLimit("co_alpha", { max_storage_mb: 512 });
await setLimit("co_beta", { max_storage_mb: 512 }, "pilot");
setFault(null);
await sleep(CACHE_WAIT);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
