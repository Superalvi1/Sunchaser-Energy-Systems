-- PROPOSED migration (NOT applied to production): invoice payment integrity guards.
-- Idempotent: safe to run twice. Reversible with invoice-payments-integrity-rollback.sql.
--
-- Why: the app records a payment as read-ledger -> check balance -> insert -> re-sum -> write invoice.
-- Those steps are separate PostgREST calls, so parallel requests can all pass the balance check
-- (5 parallel payments of 30,000 on a 100,000 invoice were all accepted: ledger 150,000) and a
-- stale invoice save can overwrite paid_amount with an older ledger sum. These triggers make the
-- database serialise per invoice (row lock on public.invoices) and enforce the same rules atomically.
--
-- Properties:
--   * No table rewrite, no new columns, no data change at apply time. Existing rows are not touched.
--   * Rules apply to NEW writes only. Legacy overpaid invoices stay editable (see section B).
--   * Escape hatch for admin backfills / repairs: in the same transaction run
--         set local app.skip_payment_guard = 'on';
--     (PostgREST callers cannot set this, so the app and any API client cannot bypass the guards).
--   * Errors use SQLSTATE PT4xx so PostgREST returns the matching HTTP status and a message that starts
--     with a stable tag (invoice_overpayment, invoice_total_below_payments, invoice_not_collectible,
--     invoice_has_payments, invoice_payment_invalid). The app maps them to friendly 4xx messages.
--
-- Sections:  A payments insert guard + totals sync   (fixes overpayment race, stale paid_amount)
--            B invoices update guard                  (fixes edit-vs-payment races)
--            C invoices delete guard                  (fixes delete-vs-payment loss)
--            Each section can be dropped independently (see rollback file).

begin;

-- Shared status derivation: identical to derivePaymentStatus() in src/lib/invoices.ts.
create or replace function public.invoice_ledger_status(grand numeric, paid numeric, due date)
returns text language sql stable as $$
  select case
    when round(grand - paid, 2) <= 0 and grand > 0 then 'Paid'
    when paid > 0 and round(grand - paid, 2) > 0 then
      case when due is not null and due < current_date then 'Overdue' else 'Partial' end
    when due is not null and due < current_date and grand > 0 then 'Overdue'
    else 'Unpaid'
  end
$$;

-- ---------------------------------------------------------------- A. payments
create or replace function public.invoice_payments_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv_total  numeric;
  inv_status text;
  ledger     numeric;
begin
  if coalesce(current_setting('app.skip_payment_guard', true), '') = 'on' then return NEW; end if;

  -- Serialise every writer of this invoice's money. A second payment waits here until the first commits,
  -- then (READ COMMITTED) sees the first payment in the sum below.
  select grand_total, invoice_status into inv_total, inv_status
    from public.invoices where id = NEW.invoice_id for update;
  if not found then return NEW; end if;            -- the foreign key reports the missing invoice

  -- A retry of an already stored payment must reach the primary key and be reported as a duplicate id (23505),
  -- not be rejected here because the first copy already used up the balance.
  if exists (select 1 from public.invoice_payments where id = NEW.id) then return NEW; end if;

  if NEW.amount is null or NEW.amount <= 0 then
    raise exception 'invoice_payment_invalid: payment amount must be positive' using errcode = 'PT400';
  end if;

  -- Opening-balance row written for legacy invoices that carry a paid amount but no ledger rows.
  if NEW.id like 'pay-init-%' then return NEW; end if;

  if inv_status in ('void', 'duplicate', 'test') then
    raise exception 'invoice_not_collectible: invoice is marked % and cannot take payments', inv_status
      using errcode = 'PT409';
  end if;

  select coalesce(sum(amount), 0) into ledger from public.invoice_payments where invoice_id = NEW.invoice_id;
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

-- After any ledger change, touch the invoice: the BEFORE UPDATE trigger of section B recomputes
-- paid_amount / balance_due / payment_status from the ledger inside the same transaction.
create or replace function public.invoice_payments_after_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.skip_payment_guard', true), '') = 'on' then return null; end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    update public.invoices set updated_at = timezone('utc'::text, now()) where id = NEW.invoice_id;
  end if;
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and OLD.invoice_id is distinct from NEW.invoice_id) then
    update public.invoices set updated_at = timezone('utc'::text, now()) where id = OLD.invoice_id;
  end if;
  return null;
end $$;

drop trigger if exists invoice_payments_after_change_sync on public.invoice_payments;
create trigger invoice_payments_after_change_sync
  after insert or update or delete on public.invoice_payments
  for each row execute function public.invoice_payments_after_change();

-- ---------------------------------------------------------------- B. invoices update
create or replace function public.invoices_before_update_ledger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n bigint;
  s numeric;
begin
  if coalesce(current_setting('app.skip_payment_guard', true), '') = 'on' then return NEW; end if;
  select count(*), coalesce(sum(amount), 0) into n, s from public.invoice_payments where invoice_id = NEW.id;
  if n = 0 then return NEW; end if;                 -- legacy invoice without ledger rows: leave the header alone

  -- Only an edit that LOWERS the total below what was paid is refused; legacy overpaid invoices stay editable.
  if NEW.grand_total is distinct from OLD.grand_total and NEW.grand_total < OLD.grand_total and NEW.grand_total < s then
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
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.skip_payment_guard', true), '') = 'on' then return OLD; end if;
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

commit;
