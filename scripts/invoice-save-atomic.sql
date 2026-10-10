-- invoice_save_atomic: save an invoice edit (header fields + replacement line items) in ONE transaction.
-- Additive: creates one function. Changes no table and no row. Rollback: scripts/invoice-save-atomic-rollback.sql.
--
-- Why: the edit used to be several separate PostgREST requests (upsert lines, delete old lines, update header,
-- re-read ledger). Two edits from different app instances could interleave, leaving one edit's lines under the
-- other edit's header. A database function runs as a single transaction, so either every part is saved or none.
--
-- What it guarantees
--   * Serialisation: takes the invoice row lock (FOR NO KEY UPDATE, the same lock the payment guard takes), so
--     edits, payments, archive and delete of one invoice queue behind each other. A waiter gives up after 10 s (PT409).
--   * Conflict detection: when the caller passes p_expected_updated_at (the version its form loaded) and the row
--     has changed since, nothing is written and the function raises invoice_conflict (PT409).
--   * Consistency check inside the transaction: after the lines are replaced, the stored lines must reproduce the
--     header (subtotal = sum(qty*rate), grand_total = max(0, subtotal - discount), each line_total correct);
--     otherwise the whole transaction is rolled back (invoice_totals_inconsistent, PT422).
--   * Line-id safety: a line id that already belongs to ANOTHER invoice is refused instead of being taken over.
--   * Money: when the invoice has payment rows, paid/balance/status are recomputed from the ledger in the same
--     transaction (the payment guard, if installed, does the same; this function does not depend on it).
--
-- Order: apply AFTER scripts/invoice-payments-integrity.sql (it reuses public.invoice_ledger_status). The application
-- falls back to its previous, non-atomic path when this function does not exist.
-- Run as the database owner. Idempotent.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regprocedure('public.invoice_ledger_status(numeric,numeric,date)') is null then
    raise exception 'apply scripts/invoice-payments-integrity.sql first (public.invoice_ledger_status is missing)';
  end if;
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

-- Only the application's service role may call it; PostgREST exposes functions in `public` to anon/authenticated otherwise.
revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.invoice_save_atomic(text, timestamptz, jsonb, jsonb) to service_role; end if;
end $$;

commit;
notify pgrst, 'reload schema';
