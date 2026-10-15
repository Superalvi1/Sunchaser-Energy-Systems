// Generates scripts/saas/phase2b-ownership.sql (+ its rollback) from the RELEASE scripts, so the company-aware functions are the
// released functions plus a small, reviewable set of exact edits. A rollback that is copied from the release scripts cannot drift.
// Run: node scripts/saas/generate-phase2b-sql.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const pay = read("scripts/invoice-payments-integrity.sql");
const save = read("scripts/invoice-save-atomic.sql");

function fn(src, name) {
  const m = src.match(new RegExp(`create or replace function public\\.${name}\\(.*?\\n(?:end \\$\\$;|\\$\\$;)`, "s"));
  if (!m) throw new Error(`function ${name} not found in the release script`);
  return m[0];
}
function edit(text, label, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one match, found ${n}`);
  return text.replace(from, to);
}

// ---- M3 payment triggers: look the invoice up INSIDE the payment's own company, so another company's invoice is invisible
let before = fn(pay, "invoice_payments_before_insert");
before = edit(before, "before_insert lookup", "from public.invoices where id = NEW.invoice_id for no key update;",
  "from public.invoices where id = NEW.invoice_id and company_id = NEW.company_id for no key update;");
before = edit(before, "before_insert missing", "if not inv_found then return NEW; end if;        -- the foreign key reports the missing invoice",
  "if not inv_found then return NEW; end if;        -- missing OR another company's invoice: the same-company trigger / foreign key report it, identically");
before = edit(before, "before_insert ledger", "into ledger, ledger_rows from public.invoice_payments where invoice_id = NEW.invoice_id;",
  "into ledger, ledger_rows from public.invoice_payments where invoice_id = NEW.invoice_id and company_id = NEW.company_id;");
let upd = fn(pay, "invoice_payments_before_update");
upd = edit(upd, "before_update lookup", "from public.invoices where id = NEW.invoice_id for no key update;",
  "from public.invoices where id = NEW.invoice_id and company_id = NEW.company_id for no key update;");
upd = edit(upd, "before_update others", "from public.invoice_payments where invoice_id = NEW.invoice_id and id <> OLD.id;",
  "from public.invoice_payments where invoice_id = NEW.invoice_id and company_id = NEW.company_id and id <> OLD.id;");

// ---- M4 atomic save: the call acts for ONE company (request header, or the founding company in single-company mode)
let sv = fn(save, "invoice_save_atomic");
sv = edit(sv, "declare", "  cur        public.invoices;\n", "  cur        public.invoices;\n  v_company  text;\n");
sv = edit(sv, "company", "  begin\n    select * into cur from public.invoices where id = p_invoice_id for no key update;",
  "  v_company := app.acting_company_id();\n  if v_company is null then\n    raise exception 'company_context_required: this call does not say which company it acts for' using errcode = 'PT403';\n  end if;\n\n  begin\n    select * into cur from public.invoices where id = p_invoice_id and company_id = v_company for no key update;");
sv = edit(sv, "item conflict", "where id = any(keep_ids) and invoice_id <> p_invoice_id)", "where id = any(keep_ids) and (invoice_id <> p_invoice_id or company_id <> v_company))");
sv = edit(sv, "item cols", "tax_percent, discount_amount, line_total, product_id, notes)\n    select x.id,", "tax_percent, discount_amount, line_total, product_id, notes, company_id)\n    select x.id,");
sv = edit(sv, "item values", "coalesce(x.discount_amount, 0), coalesce(x.line_total, 0), x.product_id, x.notes\n", "coalesce(x.discount_amount, 0), coalesce(x.line_total, 0), x.product_id, x.notes, v_company\n");
sv = edit(sv, "item upsert", "    where t.invoice_id = excluded.invoice_id;", "    where t.invoice_id = excluded.invoice_id and t.company_id = excluded.company_id;");
sv = edit(sv, "header update", "execute format('update public.invoices set %s where id = $1', set_list) using p_invoice_id, merged;",
  "execute format('update public.invoices set %s where id = $1 and company_id = $3', set_list) using p_invoice_id, merged, v_company;");
sv = edit(sv, "ledger", "coalesce(sum(amount), 0) into ledger_n, ledger_sum from public.invoice_payments where invoice_id = p_invoice_id;",
  "coalesce(sum(amount), 0) into ledger_n, ledger_sum from public.invoice_payments where invoice_id = p_invoice_id and company_id = v_company;");
sv = edit(sv, "reload", "  select * into cur from public.invoices where id = p_invoice_id;\n", "  select * into cur from public.invoices where id = p_invoice_id and company_id = v_company;\n");
sv = edit(sv, "money update", "    where id = p_invoice_id\n    returning * into cur;", "    where id = p_invoice_id and company_id = v_company\n    returning * into cur;");

// ---- same-company reference trigger: report a foreign parent exactly like a missing parent (no existence oracle)
const refTrigger = `create or replace function app.assert_same_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $f$
declare i int := 0; col text; ptab text; pcol text; ptype text; v text; pc text; hit boolean; nv jsonb := to_jsonb(NEW); cname text;
        caller text; show_key boolean;
begin
  while i < TG_NARGS loop
    col := TG_ARGV[i]; ptab := TG_ARGV[i + 1]; pcol := TG_ARGV[i + 2]; ptype := TG_ARGV[i + 3]; i := i + 4;
    v := nv ->> col;
    if v is null then continue; end if;
    -- EXECUTE ... INTO does not set FOUND, so the query returns its own "row exists" flag.
    hit := null; pc := null;
    execute format('select company_id, true from public.%I where %I = $1::%s', ptab, pcol, ptype) into pc, hit using v;
    if hit and pc is not null and pc is distinct from NEW.company_id then
      -- Answer exactly as the foreign key does for a parent that does not exist, so a caller cannot tell "another company's"
      -- from "no such row" (an existence oracle for ids).
      -- PostgreSQL prints the offending key only to a caller who may read the row and is not subject to row-level security.
      caller := coalesce(nullif(current_setting('role', true), 'none'), session_user);
      select has_table_privilege(caller, TG_RELID, 'select')
             and (not (select relrowsecurity from pg_class where oid = TG_RELID)
                  or coalesce((select rolbypassrls or rolsuper from pg_roles where rolname = caller), false))
        into show_key;
      select c.conname into cname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = TG_RELID and c.contype = 'f' and a.attname = col and c.confrelid = ('public.' || ptab)::regclass limit 1;
      raise exception using errcode = '23503',
        message = format('insert or update on table "%s" violates foreign key constraint "%s"', TG_TABLE_NAME, coalesce(cname, TG_TABLE_NAME || '_' || col || '_fkey')),
        detail = case when show_key then format('Key (%s)=(%s) is not present in table "%s".', col, v, ptab)
                      else format('Key is not present in table "%s".', ptab) end,
        schema = 'public', table = TG_TABLE_NAME, constraint = coalesce(cname, TG_TABLE_NAME || '_' || col || '_fkey');
    end if;
  end loop;
  return NEW;
end $f$;`;

// The company a privileged (SECURITY DEFINER) function acts for. The tenant role MUST name its company in the request header; a tenant
// call without one is refused rather than treated as the founding company. The service role, which has no header in single-company
// mode, acts for the founding company (app.default_company_id) unless strict_company is on.
const actingFn = `create or replace function app.acting_company_id() returns text
language plpgsql stable set search_path = pg_catalog, public, pg_temp as $f$
declare c text := app.request_company_id();
begin
  if c is not null then return c; end if;
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) = 'crm_tenant' then return null; end if;
  return app.default_company_id();
end $f$;
revoke all on function app.acting_company_id() from public;
grant execute on function app.acting_company_id() to service_role;`;
const foundation = read("scripts/saas/phase2-company-foundation.sql");
const refOrig = foundation.match(/create or replace function app\.assert_same_company\(\).*?end \$f\$;/s)[0];

const grants = `
revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) to service_role; end if;
  -- The function decides the company itself (request header), so the tenant role may call it; the foundation had closed it.
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then grant execute on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) to crm_tenant; end if;
end $$;`;
const guard = (what) => `do $$ begin
  if to_regprocedure('app.default_company_id()') is null then
    raise exception 'apply scripts/saas/phase2-company-foundation.sql first (app.default_company_id is missing)';
  end if;
  if to_regprocedure('public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)') is null
     or to_regprocedure('public.invoice_payments_before_insert()') is null then
    raise exception 'apply the release migrations first (invoice-payments-integrity.sql, invoice-save-atomic.sql)';
  end if;
end $$;`;

export function renderUp() {
  return `-- Phase 2b: company ownership inside the SECURITY DEFINER invoice paths. GENERATED by scripts/saas/generate-phase2b-sql.mjs from the
-- release scripts (invoice-payments-integrity.sql, invoice-save-atomic.sql) plus the exact edits listed there. Do not edit by hand.
-- Not run in production. Needs: the release migrations M1-M4 and scripts/saas/phase2-company-foundation.sql. Idempotent. Rollback:
-- scripts/saas/phase2b-ownership-rollback.sql.
--
-- Why: the released payment triggers and invoice_save_atomic run as the table owner, so row-level security does not apply inside them.
--  * a payment of company B naming company A's invoice made the trigger lock A's invoice, wait for A's row lock ("invoice_busy"), and
--    quote A's total, balance and paid amount in the overpayment message;
--  * invoice_save_atomic had no notion of a company: any caller allowed to execute it could edit any invoice.
-- After this script: every lookup inside those functions is limited to the caller's company, a foreign id is indistinguishable from a
-- missing one, lines written by the function always carry the invoice's company, and the tenant role may call invoice_save_atomic.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

${guard()}

${refTrigger}
revoke all on function app.assert_same_company() from public;

${actingFn}

${before}

${upd}

${sv}
${grants}

commit;
notify pgrst, 'reload schema';
`;
}
export function renderDown() {
  return `-- Rollback of scripts/saas/phase2b-ownership.sql: restores the functions exactly as released (copied from the release scripts by
-- scripts/saas/generate-phase2b-sql.mjs) and closes invoice_save_atomic to the tenant role again. Changes no table and no row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

${refOrig}
revoke all on function app.assert_same_company() from public;

${fn(pay, "invoice_payments_before_insert")}

${fn(pay, "invoice_payments_before_update")}

${fn(save, "invoice_save_atomic")}

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then
    revoke execute on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from crm_tenant; end if;
end $$;
drop function if exists app.acting_company_id();

commit;
notify pgrst, 'reload schema';
`;
}

const files = [["scripts/saas/phase2b-ownership.sql", renderUp()], ["scripts/saas/phase2b-ownership-rollback.sql", renderDown()]];
if (process.argv.includes("--check")) {
  const stale = files.filter(([p, c]) => !fs.existsSync(path.join(root, p)) || fs.readFileSync(path.join(root, p), "utf8") !== c);
  if (stale.length) { console.error("Stale generated SQL:\n" + stale.map(([p]) => p).join("\n") + "\nRun: node scripts/saas/generate-phase2b-sql.mjs"); process.exit(1); }
  console.log("Phase 2b SQL is up to date.");
} else {
  for (const [p, c] of files) fs.writeFileSync(path.join(root, p), c);
  console.log("Wrote " + files.map(([p]) => p).join(" and "));
}
