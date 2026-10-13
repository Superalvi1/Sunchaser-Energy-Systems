-- READ-ONLY pre-flight for invoice-payments-integrity.sql (revision 2). Run it against a RESTORED COPY first, then against
-- production in the same read-only way:  psql "$DATABASE_URL" -X -f scripts/invoice-payments-preflight.sql
-- It changes nothing (read-only transaction, rolled back). Section 1 is the verdict; sections 2+ list the rows behind it.
--
-- BLOCK  : do not apply until the count is 0 (or the owner has written down why it is acceptable).
-- REVIEW : legacy dirt. The migration does NOT touch these rows and does NOT refuse to apply. The count tells the owner how many
--          invoices will see their header (paid / balance / status) recomputed from the ledger the first time a MONEY field is
--          written (a payment, a total edit); archiving or renaming never does.
-- INFO   : context for the owner.
begin read only;
\pset null '(null)'
\echo '=== 1. VERDICT ==='
with
inv as (select count(*) n from public.invoices),
led as (select i.id, i.grand_total, i.paid_amount, i.invoice_status, count(p.id) n, coalesce(sum(p.amount), 0) s
          from public.invoices i left join public.invoice_payments p on p.invoice_id = i.id group by i.id),
checks(level, check_name, n, what_to_do) as (
 values
 ('BLOCK', 'prerequisite tables/columns missing',
    (select 4 - (select count(*) from (select to_regclass('public.invoices') is not null as ok union all select to_regclass('public.invoice_payments') is not null
                  union all select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_status')
                  union all select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'balance_due')) t where ok)),
    'run the invoice module / status / archive schema scripts first'),
 ('REVIEW', 'orphan payment rows: the invoice does not exist (foreign key missing or bypassed in the past)',
    (select count(*) from public.invoice_payments p where not exists (select 1 from public.invoices i where i.id = p.invoice_id)),
    'untouched by the migration; investigate why the foreign key did not hold, and decide whether the money belongs to a deleted invoice'),
 ('BLOCK', 'invoice_payments.invoice_id has no foreign key to invoices',
    (select case when exists (select 1 from pg_constraint where conrelid = 'public.invoice_payments'::regclass and contype = 'f' and confrelid = 'public.invoices'::regclass) then 0 else 1 end),
    'add the foreign key (not part of this migration)'),
 ('BLOCK', 'triggers already present on invoices / invoice_payments (not created by this migration)',
    (select count(*) from pg_trigger where tgrelid in ('public.invoices'::regclass, 'public.invoice_payments'::regclass) and not tgisinternal
        and tgname not in ('invoice_payments_before_insert_guard', 'invoice_payments_after_change_sync', 'invoice_payments_before_update_guard',
                           'invoices_before_update_ledger_guard', 'invoices_before_delete_payment_guard')),
    'read section 6; an existing trigger that writes money columns can fight the guard'),
 ('BLOCK', 'escape-hatch GUC app.skip_payment_guard set at role/database level',
    (select count(*) from pg_db_role_setting s, unnest(s.setconfig) c where c like 'app.skip_payment_guard%'),
    'ALTER ROLE/DATABASE ... RESET app.skip_payment_guard; a permanent setting would switch the guard off'),
 ('BLOCK', 'sessions idle in transaction for more than 1 minute (they hold locks the migration would queue behind)',
    (select count(*) from pg_stat_activity where datname = current_database() and state like 'idle in transaction%' and now() - state_change > interval '1 minute'),
    'wait for / end them; the migration uses lock_timeout 5s and aborts cleanly otherwise'),
 ('REVIEW', 'header paid_amount differs from the ledger sum (ledger has rows)',
    (select count(*) from led where n > 0 and round(paid_amount, 2) <> round(s, 2)),
    'ledger wins: on the first money write the header becomes the ledger sum. Decide per row (section 2) if the ledger or the header is right'),
 ('REVIEW', 'ledger sum above the invoice total (legacy overpaid)',
    (select count(*) from led where n > 0 and round(s, 2) > round(grand_total, 2)),
    'stay editable; new payments are refused; raise the total to fix'),
 ('REVIEW', 'paid_amount above the invoice total with NO ledger rows',
    (select count(*) from led where n = 0 and round(paid_amount, 2) > round(grand_total, 2)),
    'the app writes an opening row on the next edit; stays editable'),
 ('REVIEW', 'ledger sum below zero',
    (select count(*) from led where n > 0 and s < 0), 'refund rows exceed payments; check manually'),
 ('INFO', 'legacy opening balances: paid_amount > 0 and no ledger rows',
    (select count(*) from led where n = 0 and paid_amount > 0), 'the app writes pay-init-<id> on the next edit/payment (backfill script is optional)'),
 ('INFO', 'invoices with payments whose status is void / duplicate / test',
    (select count(*) from led where n > 0 and invoice_status in ('void', 'duplicate', 'test')), 'keep their history; new payments are refused (the app already refuses)'),
 ('INFO', 'zero or negative payment rows (stay as they are; new ones are refused)',
    (select count(*) from public.invoice_payments where amount <= 0), 'refunds recorded as negative rows keep working in sums'),
 ('INFO', 'payment amounts with more than 2 decimals (sums are rounded to paisa)',
    (select count(*) from public.invoice_payments where amount <> round(amount, 2)), 'harmless'),
 ('INFO', 'groups of identical payments (same invoice/amount/date/method/reference) with different ids',
    (select count(*) from (select 1 from public.invoice_payments group by invoice_id, amount, payment_date, payment_method, coalesce(reference_number, '') having count(*) > 1) g),
    'may be legitimate; the migration never merges or rejects duplicates'),
 ('INFO', 'invoices (total rows)', (select n from inv), 'sizing: the migration scans nothing and rewrites nothing'),
 ('INFO', 'payment rows (total)', (select count(*) from public.invoice_payments), 'sizing')
)
select level, check_name, n as count,
       case when level = 'BLOCK' and n > 0 then 'STOP' when level = 'REVIEW' and n > 0 then 'review' else 'ok' end as verdict, what_to_do
  from checks order by case level when 'BLOCK' then 1 when 'REVIEW' then 2 else 3 end, check_name;

\echo
\echo '=== 2. REVIEW: header disagrees with the ledger (first money write rewrites the header from the ledger) ==='
select i.id, i.invoice_number, i.invoice_status, i.grand_total, i.paid_amount as header_paid, i.balance_due as header_balance, i.payment_status as header_status,
       p.n as ledger_rows, p.s as ledger_sum
  from public.invoices i join (select invoice_id, count(*) n, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id
 where round(i.paid_amount, 2) <> round(p.s, 2) order by i.invoice_date desc limit 200;

\echo '=== 3. REVIEW: ledger above the invoice total ==='
select i.id, i.invoice_number, i.invoice_status, i.grand_total, p.s as ledger_sum, p.s - i.grand_total as excess
  from public.invoices i join (select invoice_id, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id
 where round(p.s, 2) > round(i.grand_total, 2) order by excess desc limit 200;

\echo '=== 4. INFO: zero / negative payment rows ==='
select id, invoice_id, amount, payment_date, payment_method from public.invoice_payments where amount <= 0 order by invoice_id limit 200;

\echo '=== 5. INFO: legacy opening balances (paid_amount > 0, no ledger rows) - first 50 ==='
select i.id, i.invoice_number, i.invoice_status, i.grand_total, i.paid_amount from public.invoices i
 where i.paid_amount > 0 and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id) order by i.invoice_date desc limit 50;

\echo '=== 6. triggers on the two tables (the five of this migration are expected only on a re-run) ==='
select tgrelid::regclass as tbl, tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
 where tgrelid in ('public.invoices'::regclass, 'public.invoice_payments'::regclass) and not tgisinternal order by 1, 2;

\echo '=== 7. who connects and who owns: confirm the API roles are in the escape-hatch exclusion list (authenticator, anon, authenticated, service_role) ==='
select usename, count(*) as sessions, string_agg(distinct application_name, ', ') as apps from pg_stat_activity where datname = current_database() group by usename order by 2 desc;
select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced, pg_size_pretty(pg_total_relation_size(c.oid)) as total_size, c.reltuples::bigint as approx_rows
  from pg_class c where c.oid in ('public.invoices'::regclass, 'public.invoice_payments'::regclass, 'public.invoice_items'::regclass);
select current_user as running_as, (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as can_bypass_rls, version();
select coalesce(r.rolname, '(all roles)') as role, s.setconfig from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole where s.setdatabase in (0, (select oid from pg_database where datname = current_database()));

\echo '=== 8. existing locks right now on the two tables (should be empty at the chosen window) ==='
select l.pid, l.mode, l.granted, a.state, now() - a.xact_start as xact_age, left(a.query, 80) as query
  from pg_locks l join pg_stat_activity a on a.pid = l.pid
 where l.relation in ('public.invoices'::regclass, 'public.invoice_payments'::regclass) and a.pid <> pg_backend_pid() order by xact_age desc nulls last;
rollback;
