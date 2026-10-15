-- Rollback of scripts/saas/phase2b-ownership.sql: restores the functions exactly as released (copied from the release scripts by
-- scripts/saas/generate-phase2b-sql.mjs) and closes invoice_save_atomic to the tenant role again. Changes no table and no row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function app.assert_same_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $f$
declare i int := 0; col text; ptab text; pcol text; ptype text; v text; pc text; hit boolean; nv jsonb := to_jsonb(NEW);
begin
  while i < TG_NARGS loop
    col := TG_ARGV[i]; ptab := TG_ARGV[i + 1]; pcol := TG_ARGV[i + 2]; ptype := TG_ARGV[i + 3]; i := i + 4;
    v := nv ->> col;
    if v is null then continue; end if;
    -- EXECUTE ... INTO does not set FOUND, so the query returns its own "row exists" flag.
    hit := null; pc := null;
    execute format('select company_id, true from public.%I where %I = $1::%s', ptab, pcol, ptype) into pc, hit using v;
    if hit and pc is not null and pc is distinct from NEW.company_id then
      raise exception 'cross-company reference: %.% -> %.%', TG_TABLE_NAME, col, ptab, pcol using errcode = '42501';
    end if;
  end loop;
  return NEW;
end $f$;
revoke all on function app.assert_same_company() from public;

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

create or replace function public.invoice_save_atomic(
  p_invoice_id          text,
  p_expected_updated_at timestamptz,
  p_patch               jsonb,
  p_items               jsonb          -- null = keep the existing lines; array = the complete new set of lines
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp set lock_timeout = '10s' as $$
declare
  cur        public.invoices;
  merged     public.invoices;
  allowed    constant text[] := array[
    'updated_by', 'paid_amount', 'subtotal', 'discount_amount', 'tax_amount', 'grand_total', 'amount_in_words',
    'customer_id', 'invoice_date', 'invoice_time', 'due_date', 'po_number', 'po_date', 'payment_terms',
    'payment_mode', 'previous_balance', 'customer_name', 'customer_phone', 'customer_address', 'cnic_ntn',
    'lead_id', 'quotation_id', 'project_id', 'notes', 'terms', 'pdf_url'];
  set_list   text;
  keep_ids   text[];
  ledger_n   bigint;
  ledger_sum numeric;
  item_sum   numeric;
  bad_line   text;
  new_total  numeric;
  old_total  numeric;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invoice_patch_invalid: patch must be a JSON object' using errcode = 'PT400';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'invoice_patch_invalid: items must be a JSON array' using errcode = 'PT400';
  end if;

  begin
    select * into cur from public.invoices where id = p_invoice_id for no key update;
  exception when lock_not_available then
    raise exception 'invoice_busy: this invoice is being updated by someone else, try again in a moment' using errcode = 'PT409';
  end;
  if not found then
    raise exception 'invoice_not_found: no invoice %', p_invoice_id using errcode = 'PT404';
  end if;

  old_total := cur.grand_total;

  -- Millisecond comparison: a client that round-tripped the version through a JavaScript Date lost the microseconds.
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', cur.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'invoice_conflict: this invoice was changed by someone else after you opened it (now %, you had %)',
      cur.updated_at, p_expected_updated_at using errcode = 'PT409';
  end if;

  -- ---- lines
  if p_items is not null then
    select coalesce(array_agg(x.id), '{}') into keep_ids
      from jsonb_to_recordset(p_items) as x(id text);
    if exists (select 1 from jsonb_to_recordset(p_items) as x(id text) where x.id is null) then
      raise exception 'invoice_patch_invalid: every line needs an id' using errcode = 'PT400';
    end if;
    if cardinality(keep_ids) <> (select count(distinct k) from unnest(keep_ids) k) then
      raise exception 'invoice_patch_invalid: duplicate line ids in one request' using errcode = 'PT400';
    end if;
    if exists (select 1 from public.invoice_items where id = any(keep_ids) and invoice_id <> p_invoice_id) then
      raise exception 'invoice_item_id_conflict: a line id already belongs to another invoice' using errcode = 'PT409';
    end if;

    delete from public.invoice_items where invoice_id = p_invoice_id and id <> all(keep_ids);

    insert into public.invoice_items as t (id, invoice_id, sort_order, item_name, description, qty, unit, rate,
                                            tax_percent, discount_amount, line_total, product_id, notes)
    select x.id, p_invoice_id, coalesce(x.sort_order, 0), x.item_name, coalesce(x.description, x.item_name, 'Item'),
           coalesce(x.qty, 1), coalesce(x.unit, 'pcs'), coalesce(x.rate, 0), coalesce(x.tax_percent, 0),
           coalesce(x.discount_amount, 0), coalesce(x.line_total, 0), x.product_id, x.notes
      from jsonb_to_recordset(p_items) as x(id text, sort_order int, item_name text, description text, qty numeric,
           unit text, rate numeric, tax_percent numeric, discount_amount numeric, line_total numeric, product_id text, notes text)
    on conflict (id) do update set
      sort_order = excluded.sort_order, item_name = excluded.item_name, description = excluded.description,
      qty = excluded.qty, unit = excluded.unit, rate = excluded.rate, tax_percent = excluded.tax_percent,
      discount_amount = excluded.discount_amount, line_total = excluded.line_total,
      product_id = excluded.product_id, notes = excluded.notes
    where t.invoice_id = excluded.invoice_id;
  end if;

  -- ---- header: only whitelisted columns that exist in this database and are present in the patch
  merged := jsonb_populate_record(cur, p_patch);
  select string_agg(format('%I = ($2).%I', a.attname, a.attname), ', ' order by a.attnum)
    into set_list
    from pg_attribute a
   where a.attrelid = 'public.invoices'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname = any(allowed) and p_patch ? a.attname::text;
  if set_list is not null then
    execute format('update public.invoices set %s where id = $1', set_list) using p_invoice_id, merged;
  end if;

  -- ---- money follows the ledger, inside this transaction
  select count(*), coalesce(sum(amount), 0) into ledger_n, ledger_sum from public.invoice_payments where invoice_id = p_invoice_id;
  select * into cur from public.invoices where id = p_invoice_id;
  -- Same rule as the payment guard: an edit may not LOWER the total below what is already paid.
  if ledger_n > 0 and cur.grand_total < old_total and cur.grand_total < round(ledger_sum, 2) then
    raise exception 'invoice_total_below_payments: invoice total % cannot be lower than payments already recorded %',
      round(cur.grand_total, 2), round(ledger_sum, 2) using errcode = 'PT422';
  end if;

  update public.invoices set
      paid_amount    = case when ledger_n > 0 then round(ledger_sum, 2) else paid_amount end,
      balance_due    = greatest(0, round(grand_total - case when ledger_n > 0 then ledger_sum else paid_amount end, 2)),
      payment_status = public.invoice_ledger_status(grand_total,
                         round(case when ledger_n > 0 then ledger_sum else paid_amount end, 2), due_date),
      updated_at     = timezone('utc'::text, clock_timestamp())
    where id = p_invoice_id
    returning * into cur;

  -- ---- consistency of header and lines (only when this call replaced the lines)
  if p_items is not null then
    select coalesce(sum(qty * rate), 0) into item_sum from public.invoice_items where invoice_id = p_invoice_id;
    if round(item_sum, 2) <> round(cur.subtotal, 2) then
      raise exception 'invoice_totals_inconsistent: lines add up to % but the invoice subtotal is %',
        round(item_sum, 2), round(cur.subtotal, 2) using errcode = 'PT422';
    end if;
    new_total := greatest(0, round(item_sum - coalesce(cur.discount_amount, 0), 2));
    if new_total <> round(cur.grand_total, 2) then
      raise exception 'invoice_totals_inconsistent: lines and discount give a total of % but the invoice total is %',
        new_total, round(cur.grand_total, 2) using errcode = 'PT422';
    end if;
    select i.id into bad_line from public.invoice_items i
      where i.invoice_id = p_invoice_id
        and round(i.line_total, 2) <> round(greatest(0, i.qty * i.rate - coalesce(i.discount_amount, 0)), 2)
      limit 1;
    if bad_line is not null then
      raise exception 'invoice_totals_inconsistent: line % has a wrong line total', bad_line using errcode = 'PT422';
    end if;
  end if;

  return jsonb_build_object('id', cur.id, 'updated_at', cur.updated_at, 'grand_total', cur.grand_total,
                            'paid_amount', cur.paid_amount, 'balance_due', cur.balance_due, 'payment_status', cur.payment_status);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then
    revoke execute on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from crm_tenant; end if;
end $$;
drop function if exists app.acting_company_id();

commit;
notify pgrst, 'reload schema';
