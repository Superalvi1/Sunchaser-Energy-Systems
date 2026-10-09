// Journey 10: Smart Quote link tokens (finding P4-03). A public quotation never attaches to an existing lead on name + phone;
// only a staff-issued link (or the logged-in portal customer's own session) can. Disposable stack only (synthetic data).
//   source "$E2E_ENV_FILE"; E2E_STATE_DIR=/tmp/sunchaser-e2e node scripts/e2e-crm-repair/j10-smartquote-link.mjs
import { createHmac, randomBytes } from "node:crypto";
import { BASE, SHOTS, STATE, sql, launch, staffLogin, apiLogin, check, save, randomPhone, canonical } from "./lib.mjs";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET of the disposable stack is required (to mint forged/expired tokens).");
if (/sunchaserenergy|railway\.app/.test(BASE)) throw new Error("Refusing to run against a non-local base URL.");

const day = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10).replaceAll("-", "");
let seq = Math.floor(Math.random() * 6000);
function quoteNumber() {
  for (;;) {
    const n = `SES-${day}-${String(seq++ % 10000).padStart(4, "0")}`;
    if (sql(`select count(*) from smart_quote_versions where quote_number='${n}'`) === "0") return n;
  }
}
let xff = 0;
const ip = () => `10.77.${(xff >> 8) & 255}.${(xff++ & 255) || 1}`; // the public rate limit is per client IP; a unique address per request keeps the load test under it
const body = (over = {}) => {
  const total = over.estimatedTotalPkr ?? 900000;
  return {
    name: "Link Client", phone: "03000000001", city: "Lahore", quoteNumber: over.quoteNumber ?? quoteNumber(), systemCapacityKw: 8, estimatedTotalPkr: total,
    panel: "14 × Test 585W", inverter: "1 × Test 8kW", battery: "Not included", structure: "Standard L2", generatedAt: new Date().toISOString(),
    snapshot: { lines: [{ category: "Equipment", description: "Panels", specification: "585W", unit: "pcs", quantity: 14, unitPricePkr: total / 14, totalPkr: total }], subtotalPkr: total, discountPkr: 0 },
    ...over,
  };
};
const post = async (b, headers = {}) => {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/public/smart-quotes`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers }, body: JSON.stringify(b) });
  const ms = performance.now() - t0;
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, ms };
};
const shape = (r) => JSON.stringify({ status: r.status, keys: Object.keys(r.json).sort(), ok: r.json.ok, success: r.json.success, versionNumber: r.json.versionNumber, message: r.json.message, upload: typeof r.json.pdfUploadToken });
const leadDigest = (id) => sql(`select md5(row(id,name,phone,notes,customer_id,status,email,address,created_at)::text) from leads where id='${id}'`);
const versionsOf = (id) => sql(`select string_agg(version_number||':'||quote_number, ',' order by version_number) from smart_quote_versions where lead_id='${id}'`);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Forging helpers: mint tokens the way the server does, from the stack's own secret (only this disposable stack's).
const linkKey = createHmac("sha256", process.env.JWT_SECRET.trim()).update("smart-quote-link-key-v1").digest();
function mint({ leadId, phone, issuedAt = Math.floor(Date.now() / 1000), ttl = 3600, secretKey = linkKey, purpose = "smart-quote-link" }) {
  const payload = { p: purpose, l: leadId, i: issuedAt, e: issuedAt + ttl, n: randomBytes(6).toString("hex"), ...(phone ? { ph: phone } : {}) };
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${b}.${createHmac("sha256", secretKey).update(`smart-quote-link\n${b}`).digest("base64url")}`;
}

const admin = await apiLogin("t_admin");
const sales = await apiLogin("t_sales");
const A = (path, init = {}) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${admin}`, ...(init.headers || {}) } });

// ---------- 1. Client A quotes anonymously; a retry replays ----------
const phoneA = randomPhone("0306");
const nameA = "Link Client Alpha";
const q1 = quoteNumber();
const a1 = await post(body({ name: nameA, phone: phoneA, quoteNumber: q1 }));
const leadA = a1.json.leadId;
check("S1 client A's first anonymous quotation creates a lead", a1.status === 201 && leadA && a1.json.versionNumber === 1, `${a1.status} ${a1.text.slice(0, 120)}`);
check("S1 lead A's id is the deterministic id for its quote number", /^lead-[0-9a-f-]{36}$/.test(leadA));
const a1retry = await post(body({ name: nameA, phone: phoneA, quoteNumber: q1, generatedAt: new Date(Date.now() + 5000).toISOString() }));
check("S1 retry with the same quote number replays the same lead (200)", a1retry.status === 200 && a1retry.json.leadId === leadA && a1retry.json.versionNumber === 1, `${a1retry.status}`);
check("S1 one lead, one customer, one version after the retry", sql(`select count(*) from leads where phone='${canonical(phoneA)}'`) === "1" && sql(`select count(*) from customers where phone='${canonical(phoneA)}'`) === "1" && versionsOf(leadA) === `1:${q1}`);
const conflict = await post(body({ name: nameA, phone: phoneA, quoteNumber: q1, estimatedTotalPkr: 1 }));
check("S1 a different quotation reusing the number is a 409, not a merge", conflict.status === 409, String(conflict.status));

// ---------- 2. A's own anonymous revision is its own lead ----------
const digestA = leadDigest(leadA);
const q2 = quoteNumber();
const a2 = await post(body({ name: nameA, phone: phoneA, quoteNumber: q2, estimatedTotalPkr: 950000, systemCapacityKw: 10 }));
check("S2 A's anonymous revision gets its OWN lead (no attachment by name+phone)", a2.status === 201 && a2.json.leadId && a2.json.leadId !== leadA && a2.json.versionNumber === 1, `${a2.status} ${a2.text.slice(0, 100)}`);
check("S2 lead A is byte-identical and still has exactly one version", leadDigest(leadA) === digestA && versionsOf(leadA) === `1:${q1}`);
const revNotes = sql(`select notes from leads where id='${a2.json.leadId}'`);
check("S2 the revision lead carries a visible 'possible existing client' note naming lead A, marked unverified", new RegExp(`Possible existing client: ${leadA} \\(${nameA}\\), unverified`).test(revNotes), revNotes.split("\n").filter((l) => /Possible/.test(l)).join(" | "));
check("S2 the note is human text on its own line and the quotation block is intact", /^SMART_QUOTE_V1$/m.test(revNotes) && new RegExp(`^Quote: ${q2}$`, "m").test(revNotes));
const replayRev = await post(body({ name: nameA, phone: phoneA, quoteNumber: q2, estimatedTotalPkr: 950000, systemCapacityKw: 10 }));
check("S2 retrying the revision replays its own lead", replayRev.status === 200 && replayRev.json.leadId === a2.json.leadId);

// ---------- 3. Attacker with A's exact name + phone ----------
const qAtk = quoteNumber();
// A far-future client timestamp is what would push a lead to the top of the staff list; it is one day ahead here (distinct values) so shared journeys that sort by it stay deterministic.
const attackStamp = new Date(Date.now() + 86400000 + Math.floor(Math.random() * 1e7)).toISOString();
const attack = await post(body({ name: nameA, phone: phoneA, quoteNumber: qAtk, estimatedTotalPkr: 1000, generatedAt: attackStamp }));
check("S3 attacker (A's exact name+phone) gets a new separate lead", attack.status === 201 && attack.json.leadId && ![leadA, a2.json.leadId].includes(attack.json.leadId), `${attack.status}`);
check("S3 A's lead row is unchanged (name, phone, notes incl. Generated sort key, customer, status)", leadDigest(leadA) === digestA && !sql(`select notes from leads where id='${leadA}'`).includes(attackStamp) && !/Generated: 2099/.test(sql(`select notes from leads where id='${leadA}'`)));
check("S3 A's version list is unchanged", versionsOf(leadA) === `1:${q1}`);
check("S3 the response never mentions A's lead id or name", !attack.text.includes(leadA) && !attack.text.includes("Alpha"), attack.text.slice(0, 160));
check("S3 attack and a brand-new-number control are indistinguishable by status and body shape", shape(attack) === shape(await post(body({ name: nameA, phone: randomPhone("0307"), estimatedTotalPkr: 1000, generatedAt: new Date(Date.now() + 86400000 + Math.floor(Math.random() * 1e7)).toISOString() }))), shape(attack));
check("S3 attacker's lead is flagged for staff, not merged", /Possible existing client:/.test(sql(`select notes from leads where id='${attack.json.leadId}'`)));

// ---------- 4. Shared phone, different names ----------
const qB = quoteNumber();
const b1 = await post(body({ name: "Sana Malik Beta", phone: phoneA, quoteNumber: qB }));
check("S4 a different name on the same phone gets a separate lead", b1.status === 201 && b1.json.leadId && ![leadA, a2.json.leadId, attack.json.leadId].includes(b1.json.leadId));
const bNotes = sql(`select notes from leads where id='${b1.json.leadId}'`);
check("S4 it is flagged with the weaker 'shared phone' note (and not 'possible existing client' for a different name)", /^Shared phone number:/m.test(bNotes) && !/Possible existing client: lead-[^\n]*\(Sana/.test(bNotes) && !/Alpha/.test(bNotes.split("\n").filter((l) => /^Shared phone/.test(l)).join()));
check("S4 lead A still untouched", leadDigest(leadA) === digestA);

// ---------- 5. Staff issues a link; the link adds A's next quotation as a version ----------
const noAuth = await fetch(`${BASE}/api/leads/${leadA}/smart-quote-link`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("S5 issuing a link without a staff session is refused (401)", noAuth.status === 401, String(noAuth.status));
const issueRes = await A(`/api/leads/${leadA}/smart-quote-link`, { method: "POST", body: JSON.stringify({}) });
const issued = await issueRes.json().catch(() => ({}));
check("S5 staff can issue a link for lead A", issueRes.status === 200 && issued.url && issued.token && issued.leadId === leadA, `${issueRes.status} ${Object.keys(issued)}`);
const linkUrl = new URL(issued.url);
check("S5 the URL is the public Smart Quote URL with ?link=<token>", linkUrl.pathname === "/quote" && linkUrl.searchParams.get("link") === issued.token, `${linkUrl.origin}${linkUrl.pathname}`);
const expDays = (Date.parse(issued.expiresAt) - Date.now()) / 86400000;
check("S5 the token lifetime is <= 30 days (default about 14)", expDays > 13 && expDays <= 30, expDays.toFixed(2));
check("S5 days > 30 is refused", (await A(`/api/leads/${leadA}/smart-quote-link`, { method: "POST", body: JSON.stringify({ days: 31 }) })).status === 400);
check("S5 an unknown lead id is a 404", (await A(`/api/leads/lead-nope/smart-quote-link`, { method: "POST", body: "{}" })).status === 404);
const salesTry = await fetch(`${BASE}/api/leads/${leadA}/smart-quote-link`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sales}` }, body: "{}" });
check("S5 the sales ownership guard applies (a salesperson who does not own lead A is refused)", [403, 404].includes(salesTry.status), String(salesTry.status));
const qJoin = quoteNumber();
const joined = await post(body({ name: "A. Alpha (typed differently)", phone: phoneA, quoteNumber: qJoin, estimatedTotalPkr: 990000, systemCapacityKw: 12 }), { "x-smart-quote-link": issued.token });
check("S5 a quotation carrying the token joins lead A as version 2", joined.status === 201 && joined.json.leadId === leadA && joined.json.versionNumber === 2, `${joined.status} ${joined.text.slice(0, 100)}`);
check("S5 lead A now lists versions 1 and 2; its name was not overwritten", versionsOf(leadA) === `1:${q1},2:${qJoin}` && sql(`select name from leads where id='${leadA}'`) === nameA);
check("S5 lead A's latest-quote summary points at the new quotation; staff notes preserved", new RegExp(`^Quote: ${qJoin}$`, "m").test(sql(`select notes from leads where id='${leadA}'`)));
const joinedReplay = await post(body({ name: "A. Alpha (typed differently)", phone: phoneA, quoteNumber: qJoin, estimatedTotalPkr: 990000, systemCapacityKw: 12 }));
check("S5 retrying that quotation (even without the header) replays version 2", joinedReplay.status === 200 && joinedReplay.json.leadId === leadA && joinedReplay.json.versionNumber === 2);
check("S5 the staff activity log records the issuance without the token", sql(`select count(*) from activity_logs where action='Smart Quote Link Issued' and details like '%${leadA}%'`) !== "0" && sql(`select count(*) from activity_logs where details like '%${issued.token.slice(10, 40)}%'`) === "0");

// ---------- 6. Forged / expired / other-lead / wrong-phone tokens behave as anonymous ----------
const digest6 = leadDigest(leadA);
const versions6 = versionsOf(leadA);
const canonA = canonical(phoneA);
const otherLead = b1.json.leadId; // lead B shares A's phone number
const leadC = (await post(body({ name: "Unrelated Gamma", phone: randomPhone("0315") }))).json.leadId; // a lead on a different number
const cases = [
  ["forged signature", issued.token.slice(0, -5) + (issued.token.endsWith("AAAAA") ? "BBBBB" : "AAAAA")],
  ["signed with another secret", mint({ leadId: leadA, phone: canonA, secretKey: createHmac("sha256", "another-secret-another-secret-another-secret").update("smart-quote-link-key-v1").digest() })],
  ["expired an hour ago", mint({ leadId: leadA, phone: canonA, issuedAt: Math.floor(Date.now() / 1000) - 7200, ttl: 3600 })],
  ["lifetime over 30 days", mint({ leadId: leadA, phone: canonA, ttl: 31 * 86400 })],
  ["wrong purpose", mint({ leadId: leadA, phone: canonA, purpose: "pdf-upload" })],
  ["token naming lead C (a different number) used with A's phone", mint({ leadId: leadC, phone: canonA })],
  ["token naming lead C with C's own phone, used with A's phone", mint({ leadId: leadC, phone: sql(`select phone from leads where id='${leadC}'`) })],
  ["token naming a lead that does not exist", mint({ leadId: "lead-00000000-0000-0000-0000-000000000000", phone: canonA })],
  ["token issued for a different phone", mint({ leadId: leadA, phone: canonical("0399" + "1234567") })],
  ["garbage", "not-a-token"],
];
const controlShape = shape(await post(body({ name: nameA, phone: randomPhone("0308") })));
for (const [label, token] of cases) {
  const r = await post(body({ name: nameA, phone: phoneA }), { "x-smart-quote-link": token });
  check(`S6 ${label} -> treated as anonymous (new lead, version 1, same response shape)`, r.status === 201 && r.json.leadId !== leadA && r.json.versionNumber === 1 && shape(r) === controlShape, `${r.status} ${r.text.slice(0, 80)}`);
}
check("S6 none of them touched lead A", leadDigest(leadA) === digest6 && versionsOf(leadA) === versions6);
// A token for lead B (phone = shared phone) must attach only to B, never to A, even though both leads share the number and the name matches A's.
const tokB = (await (await A(`/api/leads/${otherLead}/smart-quote-link`, { method: "POST", body: "{}" })).json()).token;
const viaB = await post(body({ name: nameA, phone: phoneA }), { "x-smart-quote-link": tokB });
check("S6 a token names exactly one lead: B's token (same phone as A) joins B, not A, even though the quote name equals A's", viaB.status === 201 && viaB.json.leadId === otherLead && viaB.json.versionNumber === 2 && versionsOf(leadA) === versions6, `${viaB.status} ${viaB.json.leadId} v${viaB.json.versionNumber}`);

// Phone changes after issuance: the old token can no longer be replayed against the lead.
sql(`update leads set phone='${canonical("0309" + "7654321")}' where id='${leadA}'`);
const stale = await post(body({ name: nameA, phone: phoneA }), { "x-smart-quote-link": issued.token });
const staleNew = await post(body({ name: nameA, phone: "0309" + "7654321" }), { "x-smart-quote-link": issued.token });
check("S6 lead phone changed after issuance: the token no longer joins (old phone)", stale.status === 201 && stale.json.leadId !== leadA && stale.json.versionNumber === 1, `${stale.status} ${stale.json.leadId}`);
check("S6 ...nor with the lead's new phone (the token was issued for the old number)", staleNew.status === 201 && staleNew.json.leadId !== leadA && staleNew.json.versionNumber === 1);
sql(`update leads set phone='${canonA}' where id='${leadA}'`);
// A deleted lead is not a target.
sql(`update leads set deleted_at=now() where id='${leadA}'`);
const del = await post(body({ name: nameA, phone: phoneA }), { "x-smart-quote-link": issued.token });
check("S6 a soft-deleted lead is not a target (quote behaves as anonymous)", del.status === 201 && del.json.leadId !== leadA && del.json.versionNumber === 1);
sql(`update leads set deleted_at=null where id='${leadA}'`);
check("S6 lead A restored to its pre-test state", leadDigest(leadA) === digest6);

// ---------- 7. Portal customer's own session ----------
const portalA = await apiLogin("t_portal_a");
const portalB = await apiLogin("t_portal_b");
check("S7 synthetic portal customers can sign in", Boolean(portalA) && Boolean(portalB));
const custA = sql(`select customer_id from leads where id='${leadA}'`);
sql(`update users set customer_id='${custA}' where username='t_portal_a'`);
const qp = quoteNumber();
const portalJoin = await post(body({ name: nameA, phone: phoneA, quoteNumber: qp, estimatedTotalPkr: 1010000 }), { authorization: `Bearer ${portalA}` });
check("S7 the logged-in portal customer's own quotation joins their lead as the next version", portalJoin.status === 201 && portalJoin.json.leadId === leadA && portalJoin.json.versionNumber === 3, `${portalJoin.status} ${portalJoin.text.slice(0, 100)}`);
const portalOtherPhone = await post(body({ name: nameA, phone: randomPhone("0310") }), { authorization: `Bearer ${portalA}` });
check("S7 the same session with a different phone number does not attach (anonymous)", portalOtherPhone.status === 201 && portalOtherPhone.json.leadId !== leadA && portalOtherPhone.json.versionNumber === 1);
const portalBTry = await post(body({ name: nameA, phone: phoneA }), { authorization: `Bearer ${portalB}` });
check("S7 another portal customer (not linked to lead A) cannot attach to it", portalBTry.status === 201 && portalBTry.json.leadId !== leadA && portalBTry.json.versionNumber === 1);
const staffSess = await post(body({ name: nameA, phone: phoneA }), { authorization: `Bearer ${admin}` });
check("S7 a staff session on the public endpoint is not a portal identity (anonymous)", staffSess.status === 201 && staffSess.json.leadId !== leadA && staffSess.json.versionNumber === 1);
const badBearer = await post(body({ name: nameA, phone: phoneA }), { authorization: "Bearer garbage.garbage.garbage" });
check("S7 an invalid bearer token never breaks anonymous quoting", badBearer.status === 201 && badBearer.json.leadId !== leadA);
sql(`update users set customer_id=null where username='t_portal_a'`);

// ---------- 8. Concurrency ----------
const tokenC = (await (await A(`/api/leads/${leadA}/smart-quote-link`, { method: "POST", body: "{}" })).json()).token;
const parallel = await Promise.all(Array.from({ length: 8 }, (_, i) => post(body({ name: nameA, phone: phoneA, estimatedTotalPkr: 1100000 + i }), { "x-smart-quote-link": tokenC })));
const nums = sql(`select string_agg(version_number::text, ',' order by version_number) from smart_quote_versions where lead_id='${leadA}'`);
check("S8 8 parallel quotations with the same token all join lead A", parallel.every((r) => r.status === 201 && r.json.leadId === leadA), parallel.map((r) => r.status).join(","));
check("S8 version numbers stay unique and gapless (1..11)", nums === "1,2,3,4,5,6,7,8,9,10,11", nums);
const sameQ = quoteNumber();
const sameBody = body({ name: nameA, phone: phoneA, quoteNumber: sameQ, estimatedTotalPkr: 1200000 });
const dupes = await Promise.all(Array.from({ length: 10 }, () => post(sameBody, { "x-smart-quote-link": tokenC })));
check("S8 10 simultaneous identical submissions create exactly one version on one lead", dupes.every((r) => [200, 201].includes(r.status) && r.json.leadId === leadA) && sql(`select count(*) from smart_quote_versions where quote_number='${sameQ}'`) === "1", dupes.map((r) => r.status).join(","));
const anonQ = quoteNumber();
const anonBody = body({ name: "Anonymous Racer", phone: randomPhone("0311"), quoteNumber: anonQ });
const anonRace = await Promise.all(Array.from({ length: 10 }, () => post(anonBody)));
check("S8 10 simultaneous anonymous submissions of one quotation converge on one lead/customer/version", new Set(anonRace.map((r) => r.json.leadId)).size === 1 && anonRace.every((r) => [200, 201].includes(r.status)) && sql(`select count(*) from smart_quote_versions where quote_number='${anonQ}'`) === "1" && sql(`select count(*) from leads where phone='${canonical(anonBody.phone)}'`) === "1" && sql(`select count(*) from customers where phone='${canonical(anonBody.phone)}'`) === "1", anonRace.map((r) => r.status).join(","));

// ---------- 9. Response / timing parity ----------
const phoneP = randomPhone("0312");
await post(body({ name: "Parity Client", phone: phoneP }));
const matchRes = [], freshRes = [];
for (let i = 0; i < 30; i++) {
  matchRes.push(await post(body({ name: "Parity Client", phone: phoneP })));
  freshRes.push(await post(body({ name: "Parity Client", phone: randomPhone("0313") })));
}
const shapes = new Set([...matchRes, ...freshRes].map(shape));
check("S9 60 requests (30 matching name+phone, 30 not): identical status and body shape", shapes.size === 1, [...shapes].join(" / ").slice(0, 200));
const mm = median(matchRes.map((r) => r.ms)), mf = median(freshRes.map((r) => r.ms));
const meanM = matchRes.reduce((s, r) => s + r.ms, 0) / 30, meanF = freshRes.reduce((s, r) => s + r.ms, 0) / 30;
console.log(`TIMING: match median=${mm.toFixed(1)}ms mean=${meanM.toFixed(1)}ms | no-match median=${mf.toFixed(1)}ms mean=${meanF.toFixed(1)}ms`);
check("S9 timing is not obviously different (medians within 1.5x or 40 ms)", Math.abs(mm - mf) < 40 || Math.max(mm, mf) / Math.min(mm, mf) < 1.5, `${mm.toFixed(1)} vs ${mf.toFixed(1)} ms`);
check("S9 the parity run left the original 'Parity Client' lead untouched (one version)", sql(`select count(*) from smart_quote_versions where client_phone='${canonical(phoneP)}' and lead_id=(select id from leads where phone='${canonical(phoneP)}' order by created_at limit 1)`) === "1");

// ---------- 10. Browser: the Smart Quote page passes ?link= through; anonymous still works; staff CRM shows versions and the note ----------
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const seen = [];
page.on("request", (req) => { if (req.url().includes("/api/public/smart-quotes")) seen.push(req.headers()["x-smart-quote-link"] || ""); });
await page.goto(`${BASE}/quote${linkUrl.search}`, { waitUntil: "networkidle" });
await page.locator("#smart-quote-client-name").fill(nameA);
await page.locator("#smart-quote-client-phone").fill(phoneA);
await page.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
check("S10 the page sent the link token from the URL as a header", seen.length === 1 && seen[0] === issued.token, `${seen.length} request(s)`);
const maxV = Number(sql(`select max(version_number) from smart_quote_versions where lead_id='${leadA}'`));
check("S10 the quotation made in the browser joined lead A as the next version", maxV === 13 && sql(`select count(*) from smart_quote_versions where lead_id='${leadA}'`) === "13", String(maxV));
await page.screenshot({ path: `${SHOTS}/j10-01-linked-quote.png` });
const anonPhone = randomPhone("0314");
const page2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const seen2 = [];
page2.on("request", (req) => { if (req.url().includes("/api/public/smart-quotes")) seen2.push(req.headers()["x-smart-quote-link"] === undefined ? "none" : "present"); });
await page2.goto(`${BASE}/quote`, { waitUntil: "networkidle" });
await page2.locator("#smart-quote-client-name").fill("Plain Anonymous Visitor");
await page2.locator("#smart-quote-client-phone").fill(anonPhone);
await page2.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page2.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
check("S10 without ?link= the page still quotes anonymously and sends no link header", seen2.join() === "none" && sql(`select count(*) from leads where phone='${canonical(anonPhone)}'`) === "1");
const page3 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page3.goto(`${BASE}/quote?link=forged.not.valid`, { waitUntil: "networkidle" });
await page3.locator("#smart-quote-client-name").fill(nameA);
await page3.locator("#smart-quote-client-phone").fill(phoneA);
await page3.locator("aside").getByRole("button", { name: /Generate My Quote/ }).click();
await page3.getByText("Quotation and PDF saved to Sunchaser CRM").waitFor({ timeout: 30000 });
check("S10 a forged ?link= shows the normal success page and does not attach", sql(`select count(*) from smart_quote_versions where lead_id='${leadA}'`) === "13");

const staffPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await staffLogin(staffPage, "t_admin");
await staffPage.getByRole("button", { name: "CRM Database" }).first().click();
async function openProposals(leadId) {
  const badge = staffPage.getByTestId(`crm-lead-latest-quote-${leadId}`);
  await badge.waitFor({ timeout: 20000 });
  const row = badge.locator("xpath=ancestor::*[.//button[normalize-space()='View saved proposals']][1]");
  await row.getByRole("button", { name: "View saved proposals" }).first().click();
}
await openProposals(leadA);
await staffPage.getByTestId("smart-quote-version-13").waitFor({ timeout: 20000 });
const versionCards = await staffPage.locator("[data-testid^=smart-quote-version-]").count();
check("S10 staff CRM lists all of lead A's saved versions", versionCards === 13, String(versionCards));
const dupCards = await staffPage.getByTestId("smart-quote-possible-duplicate").count();
check("S10 lookalike leads (same phone and name) appear apart, labelled unverified, not among A's versions", dupCards >= 2, String(dupCards));
const dupText = await staffPage.getByTestId("smart-quote-possible-duplicate").first().innerText();
check("S10 the lookalike card says it was submitted without verification", /without verification/i.test(dupText), dupText.replace(/\n/g, " ").slice(0, 120));
await staffPage.getByTestId("smart-quote-possible-duplicate").first().scrollIntoViewIfNeeded();
await staffPage.screenshot({ path: `${SHOTS}/j10-02-staff-versions-and-lookalikes.png` });
await staffPage.getByRole("button", { name: "Create client Smart Quote link" }).click();
await staffPage.getByTestId("smart-quote-link-url").waitFor({ timeout: 15000 });
const shownUrl = await staffPage.getByTestId("smart-quote-link-url").innerText();
check("S10 staff can create the client link from the CRM", /\/quote\?link=v1\./.test(shownUrl), shownUrl.slice(0, 60));
await openProposals(a2.json.leadId).catch(async () => {
  await staffPage.goBack().catch(() => {});
});
const note = staffPage.getByTestId("smart-quote-review-note");
const noteVisible = await note.first().isVisible().catch(() => false);
check("S10 the revision lead shows the 'possible existing client' note to staff", noteVisible && /Possible existing client/.test(await note.first().innerText()), noteVisible ? "" : "banner not found");
await staffPage.screenshot({ path: `${SHOTS}/j10-03-staff-review-note.png` });
await browser.close();

save(`${STATE}/j10-results.json`);
