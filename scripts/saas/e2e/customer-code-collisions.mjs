// Customer-code collisions at INSERT time, on a real stack. The existence check and the insert are two steps; if another request takes the same random
// code in between, the insert fails with SQLSTATE 23505 on customers_customer_code_idx (an index that spans ALL companies). The application now draws a
// new code and retries, at most 5 attempts per insert.
// A natural collision needs two requests to draw the same one of 900 000 codes in the same instant, so this journey FORCES it in the DISPOSABLE database:
// a trigger rewrites the code of an incoming customer to a code another company already owns, but only for the first K attempts of a customer whose phone
// has a counter sequence (sequences are not rolled back, so the count survives the failed insert). Each request therefore gets a deterministic, real
// 23505 from PostgreSQL, also when 30 requests of two companies run at the same moment.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW.  Seed first: seed-two-companies.mjs.   Disposable stack only (refuses hosted URLs); removes its trigger and rows at the end.
import "./lib/fresh-connections.mjs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-v", "ON_ERROR_STOP=1", "-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 500) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const caller = (t) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(init.headers || {}) } });
const RUN = String(parseInt(randomBytes(3).toString("hex"), 16) % 9000 + 1000);   // four digits, part of every phone below
const VICTIM = "SES-424242";
const alpha = { id: "co_alpha", api: caller((await login("alpha_admin")).token) };
const beta = { id: "co_beta", api: caller((await login("beta_admin")).token) };

// ------------------------------------------------------------------ setup (superuser, disposable database)
const seqOf = (tag) => `tf_${tag}`;
const phoneOf = (tag) => `0399${RUN}${String(tag).padStart(3, "0")}`;   // 11 digits; the trigger keys on its last 7 digits
const key7 = (tag) => `${RUN}${String(tag).padStart(3, "0")}`.slice(-7);
const arm = (tag, forced) => { psql(`create sequence if not exists tf_${key7(tag)}`); psql(`select setval('tf_${key7(tag)}', 1, false)`); psql(`insert into tf_limits values ('${key7(tag)}', ${forced}) on conflict (key) do update set forced=${forced}`); };
const attemptsOf = (tag) => { const r = psql(`select case when is_called then last_value else 0 end from tf_${key7(tag)}`); return Number(r); };
psql(`create table if not exists tf_limits (key text primary key, forced int not null)`);
psql(`create or replace function tf_force_collision() returns trigger language plpgsql security definer set search_path = public as $$
declare s regclass; n bigint; k int;
begin
  s := to_regclass('public.tf_' || right(regexp_replace(coalesce(NEW.phone,''), '\\D', '', 'g'), 7));
  if s is null then return NEW; end if;
  n := nextval(s);
  select forced into k from tf_limits where key = right(regexp_replace(coalesce(NEW.phone,''), '\\D', '', 'g'), 7);
  if k is not null and n <= k then NEW.customer_code := '${VICTIM}'; end if;
  return NEW;
end $$`);
psql(`drop trigger if exists tf_force_collision on customers`);
psql(`create trigger tf_force_collision before insert on customers for each row execute function tf_force_collision()`);
// the code that is "already taken" belongs to ANOTHER company than the one inserting
psql(`delete from customers where customer_code='${VICTIM}'`);
psql(`set session_replication_role = replica; insert into customers (id, name, email, phone, customer_code, company_id) values ('cust-victim-${RUN}', 'Victim ${RUN}', 'victim${RUN}@example.test', '0300${RUN}000', '${VICTIM}', 'co_beta')`);
check("the setup holds: a co_beta customer owns the code that the trigger forces onto new customers", psql(`select count(*) from customers where customer_code='${VICTIM}'`) === "1");

const lead = (c, tag) => c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `Collide ${c.id} ${tag} ${RUN}`, email: `col${tag}${RUN}${c.id}@example.test`, phone: phoneOf(tag), leadSource: "Direct/Referral" }) });
const codeOfLeadCustomer = (tag) => psql(`select coalesce(customer_code,'') from customers where right(regexp_replace(coalesce(phone,''),'\\D','','g'),7)='${key7(tag)}' and id <> 'cust-victim-${RUN}'`);

try {
  // ---------------------------------------------------------------- 1. one forced collision, two, and the largest number the bound still absorbs
  for (const [tag, forced] of [[1, 1], [2, 2], [3, 4]]) {
    arm(tag, forced);
    const r = await lead(alpha, tag); const b = await json(r);
    const code = codeOfLeadCustomer(tag);
    check(`${forced} forced collision(s) on POST /api/leads: the lead is created (HTTP ${r.status}), the customer got a NEW code (${code})`, r.status < 300 && /^SES-\d{6}$/.test(code) && code !== VICTIM, `${r.status} ${JSON.stringify(b).slice(0, 200)}`);
    check(`...the database saw exactly ${forced + 1} insert attempts (${forced} refused by the unique index, one accepted)`, attemptsOf(tag) === forced + 1, `attempts=${attemptsOf(tag)}`);
  }
  // ---------------------------------------------------------------- 2. more collisions than the bound: a controlled failure, exactly 5 attempts, nothing half-created
  arm(4, 100);
  const bad = await lead(alpha, 4); const badBody = await json(bad);
  check(`more forced collisions than the bound: the request fails in a controlled way (HTTP ${bad.status}), not a hang or a crash`, bad.status >= 400 && bad.status < 600, bad.status);
  check("...after exactly 5 attempts (the bound), not endlessly", attemptsOf(4) === 5, `attempts=${attemptsOf(4)}`);
  check("...and no customer or lead row was left behind for it", codeOfLeadCustomer(4) === "" && psql(`select count(*) from leads where right(regexp_replace(coalesce(phone,''),'\\D','','g'),7)='${key7(4)}'`) === "0", JSON.stringify(badBody).slice(0, 200));
  check("...and the application is still healthy afterwards", (await fetch(`${BASE}/health`)).status === 200);

  // ---------------------------------------------------------------- 3. thirty requests of two companies at the same moment, each forced to collide 1-3 times
  const N = 30, tags = Array.from({ length: N }, (_, i) => 10 + i), forcedOf = (i) => 1 + (i % 3);
  tags.forEach((t, i) => arm(t, forcedOf(i)));
  const out = await Promise.all(tags.map(async (t, i) => { const c = i % 2 ? beta : alpha; const r = await lead(c, t); return { t, i, c, status: r.status, body: await json(r) }; }));
  const failed = out.filter((o) => o.status >= 300);
  for (const f of failed.slice(0, 4)) console.log("   COLLISION-FAILURE-RECORD " + JSON.stringify({ company: f.c.id, status: f.status, body: JSON.stringify(f.body).slice(0, 300) }));
  check(`${N} simultaneous creations (two companies), each forced to collide 1-3 times: all succeed (${failed.length} failed)`, failed.length === 0);
  const codes = tags.map((t) => codeOfLeadCustomer(t));
  check("...every customer holds a distinct, well-formed code, none is the taken one", new Set(codes).size === N && codes.every((c) => /^SES-\d{6}$/.test(c) && c !== VICTIM), `${new Set(codes).size} distinct of ${N}`);
  check("...every request made exactly (forced + 1) insert attempts", tags.every((t, i) => attemptsOf(t) === forcedOf(i) + 1), tags.map((t, i) => `${t}:${attemptsOf(t)}/${forcedOf(i) + 1}`).filter((s) => { const [a, b] = s.split(":")[1].split("/"); return a !== b; }).join(","));
  check("...each customer belongs to the company that made the request (the retry did not change the owner)", out.every((o) => psql(`select company_id from customers where right(regexp_replace(coalesce(phone,''),'\\D','','g'),7)='${key7(o.t)}' and id <> 'cust-victim-${RUN}'`) === o.c.id));

  // ---------------------------------------------------------------- 4. the invoice route creates its customer through a different code path
  const tag = 90; arm(tag, 2);
  const inv = await alpha.api("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `Collide invoice ${RUN}`, customerPhone: phoneOf(tag), items: [{ itemName: "x", description: "x", qty: 1, unit: "pcs", rate: 100, taxPercent: 0, discountAmount: 0 }] }) });
  const invBody = await json(inv);
  const icode = codeOfLeadCustomer(tag);
  check(`two forced collisions on the invoice route that creates its customer: the invoice is created (HTTP ${inv.status}) and the customer has a new code (${icode})`, inv.status < 300 && /^SES-\d{6}$/.test(icode) && icode !== VICTIM, `${inv.status} ${JSON.stringify(invBody).slice(0, 200)}`);
  check("...after exactly 3 insert attempts", attemptsOf(tag) === 3, `attempts=${attemptsOf(tag)}`);

  // ---------------------------------------------------------------- 5. the index still guards: nothing in the database holds the same code twice
  check("no customer code appears twice in the database after all of this", psql(`select count(*) from (select customer_code from customers where customer_code is not null group by 1 having count(*)>1) x`) === "0");
} finally {
  // cleanup: the trigger, its sequences and table, the victim and the rows this run created
  try {
    psql(`drop trigger if exists tf_force_collision on customers`);
    psql(`drop function if exists tf_force_collision()`);
    for (const r of psql(`select string_agg('tf_'||key, ' ') from tf_limits`).split(" ").filter(Boolean)) psql(`drop sequence if exists ${r}`);
    psql(`drop table if exists tf_limits`);
    psql(`set session_replication_role = replica; delete from customers where id='cust-victim-${RUN}' or phone like '0399${RUN}%'; delete from leads where phone like '0399${RUN}%'`);
  } catch (e) { console.log("cleanup problem: " + String(e).slice(0, 200)); }
}
check("cleanup: the forcing trigger is gone", psql(`select count(*) from pg_trigger where tgname='tf_force_collision'`) === "0");
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
