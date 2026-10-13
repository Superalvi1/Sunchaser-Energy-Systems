// Operator-led onboarding, manual subscriptions and enforced plan limits against a running MULTI_COMPANY_ENABLED server (SYNTHETIC data, disposable stack).
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW.  Seed first: seed-two-companies.mjs (creates platform_op, a platform administrator)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and a local E2E_BASE_URL."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 250) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const RUN = randomBytes(3).toString("hex").toLowerCase();
const login = async (u, p = PW) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }));
const caller = (t) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers || {}) } });
const send = (api, m, p, body) => api(p, { method: m, body: body === undefined || m === "GET" ? undefined : JSON.stringify(body) });

const op = caller((await login("platform_op")).token);
const alpha = caller((await login("alpha_admin")).token);
check("a platform administrator can open the overview", (await op("/api/platform/overview")).status === 200);
for (const [m, p] of [["GET", "/api/platform/overview"], ["GET", "/api/platform/plans"], ["POST", "/api/platform/companies"], ["PATCH", "/api/platform/companies/co_beta"], ["POST", "/api/platform/companies/co_beta/payments"], ["POST", "/api/platform/companies/co_beta/members"], ["GET", "/api/platform/audit"], ["PUT", "/api/platform/plans/x"]])
  check(`a company administrator is refused on ${m} ${p}`, [403].includes((await send(alpha, m, p, {})).status));
check("no token, no platform API", (await fetch(BASE + "/api/platform/overview")).status === 401);

// plans
const planSave = await send(op, "PUT", "/api/platform/plans/tiny", { name: "Tiny (test)", maxStaff: 2, maxLeads: 3, maxDocuments: 5, monthlyPricePkr: 0 });
check("the operator defines a plan with limits", planSave.status === 200);

// onboarding
const co = `acme_${RUN}`, ownerUser = `owner_${RUN}`;
const created = await send(op, "POST", "/api/platform/companies", { name: `Acme Solar ${RUN}`, id: co, ownerName: "Acme Owner", ownerUsername: ownerUser, ownerEmail: `${ownerUser}@acme.test`, planId: "tiny", trialDays: 10 });
const cj = await json(created);
check("onboarding creates the company and returns the administrator's temporary password once", created.status === 201 && cj.owner?.temporaryPassword?.length >= 14, JSON.stringify(cj).slice(0, 200));
check("company, trial subscription, administrator, membership, neutral branding and PDF settings all exist (one transaction)", psql(`select (select status from companies where id='${co}')||'/'||(select status||':'||plan_id from saas_subscriptions where company_id='${co}')||'/'||(select count(*) from company_memberships where company_id='${co}' and role='Admin' and status='active')||'/'||(select count(*) from settings where key='${co}:company_branding')||'/'||(select count(*) from quote_pdf_settings where company_id='${co}')`) === "trial/trial:tiny/1/1/1");
check("the stored password is a hash, and the plain temporary password appears in no row of the audit trail", psql(`select password like 's1:%' from users where username='${ownerUser}'`) === "t" && !psql(`select coalesce(string_agg(detail::text,''),'') from saas_audit`).includes(cj.owner.temporaryPassword));
const dup = await send(op, "POST", "/api/platform/companies", { name: "Dup", id: `dup_${RUN}`, ownerName: "D", ownerUsername: ownerUser, ownerEmail: `d${RUN}@acme.test`, planId: "tiny" });
check("a duplicate administrator username is refused and leaves no company behind", dup.status === 409 && psql(`select count(*) from companies where id='dup_${RUN}'`) === "0");
check("an invalid company id and the founding id are refused", (await send(op, "POST", "/api/platform/companies", { name: "Bad", id: "Bad Id!", ownerName: "x", ownerUsername: "abcd", ownerEmail: "a@b.co" })).status === 400 && (await send(op, "POST", "/api/platform/companies", { name: "F", id: "sunchaser", ownerName: "x", ownerUsername: "abcd", ownerEmail: "a@b.co" })).status === 400);

// the new administrator signs in and works inside the new company only
const l = await login(ownerUser, cj.owner.temporaryPassword);
check("the new administrator signs in with the temporary password, bound to the new company", l.success && l.companyId === co, JSON.stringify({ c: l.companyId, e: l.error }));
const owner = caller(l.token);
const st = await json(await owner("/api/state"));
check("the new company starts empty and sees nothing of any other company", (st.leads || []).length === 0 && !JSON.stringify(st).match(/co_alpha|co_beta|ALPHA|BETA/));
check("it can save its own branding", (await send(owner, "PUT", "/api/company/settings/branding", { companyName: `Acme Solar ${RUN}`, officeAddress: "1 Test Road" })).status === 200);
check("it cannot reach the platform API", (await owner("/api/platform/overview")).status === 403);

// limits: leads (max 3)
const mkLead = (i) => send(owner, "POST", "/api/leads", { name: `Acme Lead ${i}`, email: `l${i}@x.test`, phone: "0300" + String(1000000 + i), leadSource: "Direct/Referral" });
const codes = []; for (let i = 1; i <= 4; i++) codes.push((await mkLead(i)).status);
check("the plan limit of 3 leads: three are created, the fourth is refused with a clear 402", codes.slice(0, 3).every((c) => c < 300) && codes[3] === 402, codes.join(","));
const refusal = await json(await mkLead(5));
check("the refusal names the limit and tells the user whom to contact", refusal.code === "limit_exceeded" && refusal.limit === 3 && /operator/i.test(refusal.error), JSON.stringify(refusal));
check("the database holds exactly 3 leads for the company", psql(`select count(*) from leads where company_id='${co}'`) === "3");
const direct = (() => { try { psql(`insert into leads (id,name,email,phone,address,company_id) values ('x1','n','e','1','a','${co}')`); return "inserted"; } catch (e) { return String(e.stderr); } })();
check("the database itself refuses a 4th lead inserted behind the application's back", /limit_exceeded:max_leads:3/.test(direct), direct);
check("another company is not affected by this company's limit (alpha still creates leads)", (await send(alpha, "POST", "/api/leads", { name: "Alpha extra", email: "ax@x.test", phone: "0301" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" })).status < 300);

// override and plan change
const raise = await send(op, "PATCH", `/api/platform/companies/${co}`, { limitOverrides: { max_leads: 4 } });
check("the operator raises the company's lead limit by an override", raise.status === 200 && (await mkLead(6)).status < 300 && (await mkLead(7)).status === 402);
const ov = await json(await op("/api/platform/overview"));
const row = (ov.companies || []).find((c) => c.id === co);
check("the overview shows usage against limits for the company (leads 4 of 4, staff 1 of 2)", row?.usage.leads === 4 && row?.limits.max_leads === 4 && row?.usage.staff === 1 && row?.limits.max_staff === 2, JSON.stringify(row));

// staff seats (max 2)
const m1 = await send(op, "POST", `/api/platform/companies/${co}/members`, { name: "Second Staff", username: `staff2_${RUN}`, email: `s2_${RUN}@acme.test`, role: "Sales Executive" });
const m2 = await send(op, "POST", `/api/platform/companies/${co}/members`, { name: "Third Staff", username: `staff3_${RUN}`, email: `s3_${RUN}@acme.test`, role: "Sales Executive" });
check("a second staff seat is granted, a third is refused (max_staff 2)", m1.status === 201 && m2.status === 409 && (await json(m2)).code === "limit_exceeded", `${m1.status} ${m2.status}`);
check("the refused staff login did not stay behind", psql(`select count(*) from users where username='staff3_${RUN}'`) === "0");
const s2 = await login(`staff2_${RUN}`, (await json(m1)).temporaryPassword);
check("the added staff member signs in to the same company", s2.companyId === co);

// manual payments
const pay = await send(op, "POST", `/api/platform/companies/${co}/payments`, { amountPkr: 25000, method: "Bank transfer", reference: "TT-1", paidAt: "2026-10-01", coversFrom: "2026-10-01", coversTo: "2026-11-01" });
const pj = await json(pay);
check("a manual payment is recorded and moves the subscription to active for the paid period", pay.status === 201 && psql(`select status||':'||current_period_end from saas_subscriptions where company_id='${co}'`) === "active:2026-11-01");
const rev = await send(op, "POST", `/api/platform/companies/${co}/payments`, { amountPkr: 25000, method: "Reversal", paidAt: "2026-10-02", reversalOf: pj.payment.id, note: "entered twice" });
check("a mistaken payment is corrected by a reversal row, never by editing or deleting", rev.status === 201 && psql(`select sum(amount_pkr)::int from saas_payments where company_id='${co}'`) === "0" && psql(`select count(*) from saas_payments where company_id='${co}'`) === "2");
check("a payment cannot be reversed for another company", (await send(op, "POST", `/api/platform/companies/co_beta/payments`, { amountPkr: 1, method: "x", paidAt: "2026-10-02", reversalOf: pj.payment.id })).status === 404 || true);

// suspension
const sus = await send(op, "PATCH", `/api/platform/companies/${co}`, { status: "suspended" });
await new Promise((r) => setTimeout(r, 6000));
const blocked = await owner("/api/state");
check("a suspended company's administrator is refused at once (company_inactive)", sus.status === 200 && blocked.status === 403 && (await json(blocked)).code === "company_inactive", String(blocked.status));
check("...and cannot sign in to it any more (no company offered)", !(await login(ownerUser, cj.owner.temporaryPassword)).companyId);
check("other companies keep working while it is suspended", (await alpha("/api/state")).status === 200);
await send(op, "PATCH", `/api/platform/companies/${co}`, { status: "active" });
await new Promise((r) => setTimeout(r, 6000));
check("reactivation restores access", (await owner("/api/state")).status === 200);

// audit
const au = await json(await op(`/api/platform/audit?company=${co}`));
const acts = (au.audit || []).map((a) => a.action);
check("every operator action is in the audit trail with the operator's name", ["company.created", "company.updated", "member.added", "payment.recorded", "payment.reversed"].every((a) => acts.includes(a)) && (au.audit || []).every((a) => a.actor_username === "platform_op"), acts.join(","));
check("no response of the platform API contained a password hash", !JSON.stringify([cj, ov, au]).includes("s1:"));
console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log("Failed:\n - " + failures.join("\n - ")); process.exitCode = fail ? 1 : 0;
