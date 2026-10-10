-- PROPOSED migration (NOT applied to production): invoice payment integrity guards.   Revision 2 (independent review).
-- Idempotent: safe to run twice. Reversible with invoice-payments-integrity-rollback.sql.
-- Run ONLY after scripts/invoice-payments-preflight.sql (read-only) came back clean, see docs/ops/payment-guard-review.md.
--
-- Why: the app records a payment as read-ledger -> check balance -> insert -> re-sum -> write invoice.
-- Those steps are separate PostgREST calls, so parallel requests (or two app instances) can all pass the balance check
-- (5 parallel payments of 30,000 on a 100,000 invoice were all accepted: ledger 150,000) and a stale invoice save can
-- overwrite paid_amount with an older ledger sum. These triggers make the database serialise per invoice (row lock on
-- public.invoices) and enforce the same rules atomically, inside the single transaction PostgREST opens per request.
--
-- Properties:
--   * No table rewrite, no new columns, no data change at apply time. Existing rows are not touched.
--   * Rules apply to NEW writes only. Legacy overpaid invoices stay viewable, printable, archivable and editable:
--     the header (paid_amount / balance_due / payment_status) is only recomputed from the ledger when a write changes
--     a money column (grand_total, paid_amount, balance_due, payment_status, due_date) or the ledger itself changes.
--     Archiving, renaming, re-linking a customer, attaching a PDF etc. never touch the money columns.
--   * Lock: one row lock per invoice (FOR NO KEY UPDATE, the same strength as an ordinary UPDATE, so child-row inserts
--     such as invoice_items are not blocked). Lock order is always invoice row -> nothing else, so payment, edit,
--     delete, archive and items replacement cannot deadlock with each other. A waiter gives up after 10 s with the
--     stable tag invoice_busy (HTTP 409) instead of hanging.
--   * Escape hatch for operator repairs / backfills, in the SAME transaction:   set local app.skip_payment_guard = 'on';
--     It is honoured only for database sessions that are not the PostgREST/API roles (authenticator, anon,
--     authenticated, service_role), so no API caller can switch the guard off, whatever GUC they manage to set.
--   * Errors use SQLSTATE PT4xx so PostgREST answers with the matching HTTP status and a message that starts with a stable
--     tag: invoice_overpayment, invoice_total_below_payments, invoice_not_collectible, invoice_has_payments,
--     invoice_payment_invalid, invoice_opening_balance_missing, invoice_busy. The app maps them to friendly 4xx messages.
--   * Trigger functions are SECURITY DEFINER with a pinned search_path and EXECUTE revoked from every API role.
--
-- Sections:  A payments insert guard + header sync       (fixes overpayment race, stale paid_amount)
--            B invoices update guard                      (fixes edit-vs-payment races)
--            C invoices delete guard                      (fixes delete-vs-payment loss)
--            D payments update guard                      (direct SQL edits of a payment amount / invoice)
--            Each section can be dropped independently (see rollback file).

begin;
-- Never queue behind a long transaction: a waiting CREATE TRIGGER blocks every later writer of the table. If this
-- times out nothing is applied; simply run the file again in a quieter moment.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------- helpers
create or replace function public.invoice_guard_skipped() returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(current_setting('app.skip_payment_guard', true), '') = 'on'
     and session_user not in ('authenticator', 'anon', 'authenticated', 'service_role')
$$;

-- Same derivation as derivePaymentStatus() in src/lib/invoices.ts.
create or replace function public.invoice_ledger_status(grand numeric, paid numeric, due date)
returns text language sql stable set search_path = pg_catalog, pg_temp as $$
  select case
    when round(grand - paid, 2) <= 0 and grand > 0 then 'Paid'
    when paid > 0 and round(grand - paid, 2) > 0 then
      case when due is not null and due < current_date then 'Overdue' else 'Partial' end
    when due is not null and due < current_date and grand > 0 then 'Overdue'
    else 'Unpaid'
  end
$$;

-- Rewrites the header of ONE invoice from its ledger. Callers already hold (or are about to take) the row lock.
create or replace function public.invoice_sync_header(p_invoice_id text) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s numeric;
begin
  select coalesce(sum(amount), 0) into s from public.invoice_payments where invoice_id = p_invoice_id;
  update public.invoices
     set paid_amount    = round(s, 2),
         balance_due    = greatest(0, round(grand_total - s, 2)),
         payment_status = public.invoice_ledger_status(grand_total, round(s, 2), due_date),
         updated_at     = timezone('utc'::text, now())
   where id = p_invoice_id;
end $$;

-- ---------------------------------------------------------------- A. payments
create or replace function public.invoice_payments_before_insert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp set lock_timeout = '10s' as $$
declare
  inv_total   numeric;
  inv_status  text;
  inv_paid    numeric;
  inv_found   boolean := false;
  ledger      numeric;
  ledger_rows bigint;
begin
  if public.invoice_guard_skipped() then return NEW; end if;

  -- Serialise every writer of this invoice's money. A second payment waits here until the first commits,
  -- then (READ COMMITTED) sees the first payment in the sums below.
  begin
    select true, grand_total, invoice_status, paid_amount into inv_found, inv_total, inv_status, inv_paid
      from public.invoices where id = NEW.invoice_id for no key update;
  exception when lock_not_available then
    raise exception 'invoice_busy: this invoice is being updated by someone else, try again in a moment' using errcode = 'PT409';
  end;
  if not inv_found then return NEW; end if;        -- the foreign key reports the missing invoice

  -- A retry of an already stored payment must reach the primary key and be reported as a duplicate id (23505),
  -- not be rejected here because the first copy already used up the balance.
  if exists (select 1 from public.invoice_payments where id = NEW.id) then return NEW; end if;

  if NEW.amount is null or NEW.amount <= 0 then
    raise exception 'invoice_payment_invalid: payment amount must be positive' using errcode = 'PT400';
  end if;

  select coalesce(sum(amount), 0), count(*) into ledger, ledger_rows from public.invoice_payments where invoice_id = NEW.invoice_id;

  -- Opening-balance row written for legacy invoices that carry a paid amount but no ledger rows (the app writes
  -- pay-init-<invoice>, scripts/backfill-invoice-payments.sql writes pay-backfill-<invoice>). It records money that
  -- was already received, so it is exempt from the balance and status rules, but only as the FIRST ledger row.
  if NEW.id like 'pay-init-%' or NEW.id like 'pay-backfill-%' then
    if ledger_rows > 0 then
      raise exception 'invoice_payment_invalid: an opening-balance row is only accepted on an invoice without payments'
        using errcode = 'PT409';
    end if;
    return NEW;
  end if;

  -- Without this a first payment would make the header equal to that payment and silently drop the legacy amount.
  if ledger_rows = 0 and coalesce(inv_paid, 0) > 0 then
    raise exception 'invoice_opening_balance_missing: invoice shows % paid but has no payment rows; record the opening balance first',
      round(inv_paid, 2) using errcode = 'PT409';
  end if;

  if inv_status in ('void', 'duplicate', 'test') then
    raise exception 'invoice_not_collectible: invoice is marked % and cannot take payments', inv_status
      using errcode = 'PT409';
  end if;

  if round(NEW.amount, 2) > round(inv_total - ledger, 2) then
    raise exception 'invoice_overpayment: payment % exceeds the balance due % (invoice total %, already paid %)',
      round(NEW.amount, 2), round(inv_total - ledger, 2), round(inv_total, 2), round(ledger, 2)
      using errcode = 'PT422';
  end if;
  return NEW;
end $$;

drop trigger if exists invoice_payments_before_insert_guard on public.invoice_payments;
create trigger invoice_payments_before_insert_guard
  before insert on public.invoice_payments
  for each row execute function public.invoice_payments_before_insert();

-- After any ledger change, recompute the header of the affected invoice(s) inside the same transaction.
create or replace function public.invoice_payments_after_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if public.invoice_guard_skipped() then return null; end if;
  if TG_OP in ('INSERT', 'UPDATE') then perform public.invoice_sync_header(NEW.invoice_id); end if;
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and OLD.invoice_id is distinct from NEW.invoice_id) then
    perform public.invoice_sync_header(OLD.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists invoice_payments_after_change_sync on public.invoice_payments;
create trigger invoice_payments_after_change_sync
  after insert or update or delete on public.invoice_payments
  for each row execute function public.invoice_payments_after_change();

-- ---------------------------------------------------------------- B. invoices update
create or replace function public.invoices_before_update_ledger() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  n bigint;
  s numeric;
begin
  if public.invoice_guard_skipped() then return NEW; end if;

  -- Cheap exit: a write that does not touch a money column (archive, customer link, PDF url, notes ...) is none of our
  -- business. Legacy headers that disagree with their ledger are therefore left alone until money really changes.
  if NEW.grand_total    is not distinct from OLD.grand_total
     and NEW.paid_amount    is not distinct from OLD.paid_amount
     and NEW.balance_due    is not distinct from OLD.balance_due
     and NEW.payment_status is not distinct from OLD.payment_status
     and NEW.due_date       is not distinct from OLD.due_date then
    return NEW;
  end if;

  -- The executor already holds this row's lock here, so the ledger read below sees every committed payment.
  select count(*), coalesce(sum(amount), 0) into n, s from public.invoice_payments where invoice_id = NEW.id;
  if n = 0 then return NEW; end if;                 -- legacy invoice without ledger rows: leave the header alone

  -- Only an edit that LOWERS the total below what was paid is refused; legacy overpaid invoices stay editable
  -- (raising the total, or changing it to a value that is still below the ledger but not lower than before, is fine).
  if NEW.grand_total < OLD.grand_total and round(NEW.grand_total, 2) < round(s, 2) then
    raise exception 'invoice_total_below_payments: invoice total % cannot be lower than payments already recorded %',
      round(NEW.grand_total, 2), round(s, 2) using errcode = 'PT422';
  end if;

  -- Payment rows are the source of truth: a stale writer can never leave the header disagreeing with the ledger.
  NEW.paid_amount    := round(s, 2);
  NEW.balance_due    := greatest(0, round(NEW.grand_total - s, 2));
  NEW.payment_status := public.invoice_ledger_status(NEW.grand_total, round(s, 2), NEW.due_date);
  return NEW;
end $$;

drop trigger if exists invoices_before_update_ledger_guard on public.invoices;
create trigger invoices_before_update_ledger_guard
  before update on public.invoices
  for each row execute function public.invoices_before_update_ledger();

-- ---------------------------------------------------------------- C. invoices delete
create or replace function public.invoices_before_delete_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if public.invoice_guard_skipped() then return OLD; end if;
  if exists (select 1 from public.invoice_payments where invoice_id = OLD.id) then
    raise exception 'invoice_has_payments: an invoice with recorded payments cannot be deleted; archive it instead'
      using errcode = 'PT409';
  end if;
  return OLD;
end $$;

drop trigger if exists invoices_before_delete_payment_guard on public.invoices;
create trigger invoices_before_delete_payment_guard
  before delete on public.invoices
  for each row execute function public.invoices_before_delete_guard();

-- ---------------------------------------------------------------- D. payments update
-- The application never updates a payment row. This covers operators repairing data by hand: a payment may not be made
-- larger (or moved to another invoice) in a way the insert guard would have refused. Shrinking or editing text stays free.
create or replace function public.invoice_payments_before_update() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp set lock_timeout = '10s' as $$
declare
  inv_total numeric;
  others    numeric;
  inv_found boolean := false;
begin
  if public.invoice_guard_skipped() then return NEW; end if;
  if NEW.amount is not distinct from OLD.amount and NEW.invoice_id is not distinct from OLD.invoice_id then return NEW; end if;
  if NEW.amount is distinct from OLD.amount and (NEW.amount is null or NEW.amount <= 0) then
    raise exception 'invoice_payment_invalid: payment amount must be positive' using errcode = 'PT400';
  end if;
  if NEW.invoice_id is not distinct from OLD.invoice_id and NEW.amount <= OLD.amount then return NEW; end if;
  begin
    select true, grand_total into inv_found, inv_total from public.invoices where id = NEW.invoice_id for no key update;
  exception when lock_not_available then
    raise exception 'invoice_busy: this invoice is being updated by someone else, try again in a moment' using errcode = 'PT409';
  end;
  if not inv_found then return NEW; end if;
  select coalesce(sum(amount), 0) into others from public.invoice_payments where invoice_id = NEW.invoice_id and id <> OLD.id;
  if round(NEW.amount, 2) > round(inv_total - others, 2) then
    raise exception 'invoice_overpayment: payment % exceeds the balance due % (invoice total %, already paid %)',
      round(NEW.amount, 2), round(inv_total - others, 2), round(inv_total, 2), round(others, 2) using errcode = 'PT422';
  end if;
  return NEW;
end $$;

drop trigger if exists invoice_payments_before_update_guard on public.invoice_payments;
create trigger invoice_payments_before_update_guard
  before update on public.invoice_payments
  for each row execute function public.invoice_payments_before_update();

-- ---------------------------------------------------------------- privileges
-- Supabase-style default privileges hand EXECUTE on new public functions to the API roles, which would expose the pure
-- helper at /rpc/invoice_ledger_status and let a caller probe the others. Nothing needs EXECUTE: triggers do not check it
-- when they fire and the functions call each other as their owner.
revoke all on function public.invoice_guard_skipped() from public;
revoke all on function public.invoice_ledger_status(numeric, numeric, date) from public;
revoke all on function public.invoice_sync_header(text) from public;
revoke all on function public.invoice_payments_before_insert() from public;
revoke all on function public.invoice_payments_after_change() from public;
revoke all on function public.invoices_before_update_ledger() from public;
revoke all on function public.invoices_before_delete_guard() from public;
revoke all on function public.invoice_payments_before_update() from public;
do $$
declare r text; f text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array[
        'public.invoice_guard_skipped()', 'public.invoice_ledger_status(numeric, numeric, date)', 'public.invoice_sync_header(text)',
        'public.invoice_payments_before_insert()', 'public.invoice_payments_after_change()', 'public.invoices_before_update_ledger()',
        'public.invoices_before_delete_guard()', 'public.invoice_payments_before_update()'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;

commit;
