// Drives the REAL application (HTTP) through: table absent -> migrate -> migrate again -> rollback -> re-apply, on a scratch database,
// and checks what customers/staff would see in each state. Synthetic data only.
// env: E2E_BASE_URL (app on the scratch DB), TEST_PW, E2E_PSQL (psql args for that DB), MIG_DIR (directory with the migration files)
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL, PSQL = process.env.E2E_PSQL.split(" "), MIG = process.env.MIG_DIR;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("local only");
const sql = (q) => execFileSync("psql", [...PSQL, "-tAc", q]).toString().trim();
const file = (f) => { try { execFileSync("psql", [...PSQL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", `${MIG}/${f}`], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
let bad = 0;
const check = (name, ok, detail = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " - " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (u) => (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: process.env.TEST_PW }) })).json()).token;
const admin = await login("t_admin");
let n = 0;
const quote = async (phone, name, kw = 8) => {
  n++;
  const quoteNumber = `SES-20261009-${String(7000 + n).padStart(4, "0")}`;
  const lines = [{ category: "Equipment", description: "Panel", specification: "645W", unit: "pcs", quantity: 10, unitPricePkr: 27735, totalPkr: 277350 }];
  const body = { name, phone, city: "Lahore", quoteNumber, systemCapacityKw: kw, estimatedTotalPkr: 900000 + n * 1000, panel: "10 x Synthetic 645W", inverter: "1 x Synthetic", battery: "Not included", structure: "L2", generatedAt: new Date().toISOString(), snapshot: { lines, subtotalPkr: 277350, discountPkr: 0 } };
  const r = await fetch(`${BASE}/api/public/smart-quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j, quoteNumber };
};
const versions = async (leadId) => (await (await fetch(`${BASE}/api/leads/${leadId}/smart-quote-versions`, { headers: { authorization: `Bearer ${admin}` } })).json());
const leadsFor = (canonical) => Number(sql(`select count(*) from leads where phone = '${canonical}' and deleted_at is null`));
const customersFor = (canonical) => Number(sql(`select count(*) from customers where phone = '${canonical}'`));

console.log("== A. migration NOT applied (new application code, old database) ==");
check("version history reported as not installed", (await versions("lead-leg-1")).available === false);
let a1 = await quote("03019990001", "Phase A Client"); let a2 = await quote("03019990001", "Phase A Client", 10);
check("legacy fallback still accepts quotations", [a1.status, a2.status].every((s) => s === 201), `${a1.status}/${a2.status}`);
check("legacy behaviour: the same phone produced 2 leads and 2 customers (old duplicate bug returns without the table)", leadsFor("923019990001") === 2 && customersFor("923019990001") === 2, `leads=${leadsFor("923019990001")} customers=${customersFor("923019990001")}`);
const legacyNotes = sql("select (notes like 'SMART_QUOTE_V1%')::text from leads where id = 'lead-leg-1'");
check("existing lead keeps its notes-only quotation untouched", legacyNotes === "true");

console.log("== B. apply migration while the app is running ==");
check("migration applies (exit 0)", file("smart-quote-versions-schema.sql") === 0);
await sleep(1500);
const v0 = await versions("lead-leg-1");
check("PostgREST schema cache reloaded by NOTIFY (no restart): history now available", v0.available === true, `available=${v0.available}`);
const b1 = await quote("03015550001", "Legacy Client One");           // lead-leg-1 has a notes-only quotation SES-20260920-1001 with a PDF archive
check("quote for a client whose earlier quotation lives only in notes is accepted (201)", b1.status === 201 && b1.leadId === "lead-leg-1", `${b1.status} lead=${b1.leadId}`);
const v1 = await versions("lead-leg-1");
check("the notes-only quotation was preserved as version 1 and the new one is version 2", v1.versions.map((v) => v.versionNumber).join() === "2,1" && v1.versions[1].quoteNumber === "SES-20260920-1001", v1.versions.map((v) => `${v.versionNumber}:${v.quoteNumber}`).join(" "));
check("version 1 kept its archived PDF reference", Boolean(v1.versions[1].pdf?.fileUrl), `pdf=${v1.versions[1].pdf?.fileName}`);
check("no duplicate lead for that phone", leadsFor("923015550001") === 1);
const b2 = await quote("03015550006", "Legacy Client Six");           // two ACTIVE legacy leads share this phone
const target = sql("select lead_id from smart_quote_versions where quote_number = '" + b2.quoteNumber + "'");
check("two legacy leads share one phone: the quote attaches to exactly one of them, the other is untouched", ["lead-leg-6", "lead-leg-7"].includes(target) && Number(sql("select count(distinct lead_id) from smart_quote_versions where lead_id in ('lead-leg-6','lead-leg-7')")) === 1, `attached to ${target}`);
check("the other duplicate lead still has only its notes (no version rows)", Number(sql(`select count(*) from smart_quote_versions where lead_id = '${target === "lead-leg-7" ? "lead-leg-6" : "lead-leg-7"}'`)) === 0);
const b3 = await quote("03015550005", "Previously deleted client"); // only a soft-deleted lead has this phone
check("a soft-deleted lead is not reused: a new lead is created", b3.status === 201 && b3.leadId !== "lead-leg-5", `lead=${b3.leadId}`);
const b4 = await quote("03015550001", "Legacy Client One"); const b4r = await fetch(`${BASE}/api/public/smart-quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Legacy Client One", phone: "03015550001", city: "Lahore", quoteNumber: b4.quoteNumber, systemCapacityKw: 8, estimatedTotalPkr: 900000 + n * 1000, panel: "10 x Synthetic 645W", inverter: "1 x Synthetic", battery: "Not included", structure: "L2", generatedAt: new Date().toISOString(), snapshot: { lines: [{ category: "Equipment", description: "Panel", specification: "645W", unit: "pcs", quantity: 10, unitPricePkr: 27735, totalPkr: 277350 }], subtotalPkr: 277350, discountPkr: 0 } }) });
check("retrying the same quote number is a replay (200), not a new version", b4r.status === 200, String(b4r.status));
check("version numbers stay contiguous", sql("select count(*) from (select lead_id from smart_quote_versions group by lead_id having max(version_number) <> count(*)) s") === "0");

console.log("== C. apply the migration a second time while in use ==");
check("second apply exits 0", file("smart-quote-versions-schema.sql") === 0);
const c1 = await quote("03015550001", "Legacy Client One");
check("quotations keep working after the second apply", c1.status === 201 && c1.versionNumber === 4, `${c1.status} v${c1.versionNumber}`);

console.log("== D. roll back while the app is running ==");
const before = Number(sql("select count(*) from smart_quote_versions"));
check("rollback exits 0", file("smart-quote-versions-rollback.sql") === 0);
await sleep(1500);
check("all versions copied to the backup table", Number(sql("select count(*) from smart_quote_versions_rollback_backup")) === before, `${before}`);
check("API reports history not installed again (fallback, no 500s)", (await versions("lead-leg-1")).available === false);
const d1 = await quote("03015550001", "Legacy Client One");
check("quotations are still accepted after the rollback (old behaviour: a NEW lead for a returning client)", d1.status === 201 && d1.leadId !== "lead-leg-1", `${d1.status} lead=${d1.leadId}`);
check("leads kept their 'Version: N' note lines", Number(sql("select count(*) from leads where notes like '%Version: %'")) > 0);

console.log("== E. re-apply after a rollback ==");
check("re-apply exits 0", file("smart-quote-versions-schema.sql") === 0);
await sleep(1500);
const e1 = await quote("03015550001", "Legacy Client One");
check("history works again; the returning client's newest lead takes the new version", e1.status === 201 && (await versions(e1.leadId)).available === true, `lead=${e1.leadId} v${e1.versionNumber}`);
check("duplicate leads created during the fallback window remain (manual merge needed)", leadsFor("923015550001") >= 2, `leads for that phone=${leadsFor("923015550001")}`);
console.log("== F. restore the history from the rollback backup ==");
const preRestore = Number(sql("select count(*) from smart_quote_versions"));
check("before the restore the original lead's history is empty (the re-applied table starts empty)", Number(sql("select count(*) from smart_quote_versions where lead_id = 'lead-leg-1'")) === 0);
check("restore script exits 0", file("smart-quote-versions-restore.sql") === 0);
check("the original lead's four versions are back (1..4), numbering consistent", sql("select string_agg(version_number::text, ',' order by version_number) from smart_quote_versions where lead_id = 'lead-leg-1'") === "1,2,3,4", sql("select string_agg(version_number::text, ',' order by version_number) from smart_quote_versions where lead_id = 'lead-leg-1'"));
const afterFirst = Number(sql("select count(*) from smart_quote_versions"));
check("restore is repeatable (second run adds nothing)", file("smart-quote-versions-restore.sql") === 0 && Number(sql("select count(*) from smart_quote_versions")) === afterFirst && afterFirst > preRestore, `${preRestore} -> ${afterFirst}`);
console.log(bad ? `${bad} FAILED` : "ALL PASSED");
process.exit(bad ? 1 : 0);
