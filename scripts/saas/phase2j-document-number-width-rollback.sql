-- Restore the preceding formatter with a fail-closed overflow check.
-- Never reintroduce duplicate truncated numbers. A whole pre-pilot t1 rollback subsequently drops this function.
begin;
set local lock_timeout = '5s';
create or replace function public.next_document_number(p_kind text, p_prefix text, p_period text, p_width int default 4)
returns text language plpgsql security definer set search_path = pg_catalog, public, pg_temp set lock_timeout = '10s' as $$
declare
  v_company text := app.acting_company_id();
  v_next    bigint;
begin
  if v_company is null then
    raise exception 'company_context_required: this call does not say which company it acts for' using errcode = 'PT403';
  end if;
  if p_kind is distinct from 'invoice' then
    raise exception 'document_kind_unknown: %', p_kind using errcode = 'PT400';
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z][A-Z0-9]{0,9}$' or p_period is null or p_period !~ '^[0-9]{4}$' or p_width is null or p_width not between 1 and 9 then
    raise exception 'document_format_invalid: prefix must be 1-10 capitals/digits, period a 4-digit year, width 1-9' using errcode = 'PT400';
  end if;

  -- First use of a (company, kind, period): seed from the highest number the company already used, so history is never reissued.
  insert into public.document_counters (company_id, kind, period, last_value)
    select v_company, p_kind, p_period,
           coalesce(max(substring(i.invoice_number from '^' || p_prefix || '-' || p_period || '-([0-9]+)$')::bigint), 0)
      from public.invoices i
     where i.company_id = v_company and i.invoice_number ~ ('^' || p_prefix || '-' || p_period || '-[0-9]+$')
  on conflict (company_id, kind, period) do nothing;

  -- The row lock taken here is what makes concurrent callers get different numbers.
  perform 1 from public.document_counters where company_id = v_company and kind = p_kind and period = p_period for update;
  -- Numbers can also be issued OUTSIDE this counter: an older backend that is still running during a rolling deployment, or that was rolled back to and then
  -- left again, numbers invoices by counting. The counter therefore never trusts itself over the invoices: it starts from the higher of its own value and the
  -- highest number the company actually holds. (Without this, the next number after such a window would already exist and the save would fail.)
  update public.document_counters
     set last_value = greatest(last_value,
           (select coalesce(max(substring(i.invoice_number from '^' || p_prefix || '-' || p_period || '-([0-9]+)$')::bigint), 0)
              from public.invoices i
             where i.company_id = v_company and i.invoice_number ~ ('^' || p_prefix || '-' || p_period || '-[0-9]+$'))) + 1,
         updated_at = now()
   where company_id = v_company and kind = p_kind and period = p_period
   returning last_value into v_next;
  -- Fail closed instead of restoring the old truncation for already-large counters.
  if length(v_next::text) > p_width then
    raise exception 'document_number_width_requires_upgrade: re-apply t9 before issuing this number' using errcode = 'PT409';
  end if;
  return p_prefix || '-' || p_period || '-' || lpad(v_next::text, p_width, '0');
end $$;
commit;
notify pgrst, 'reload schema';
