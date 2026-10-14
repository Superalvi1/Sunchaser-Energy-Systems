-- Phase 2c: atomic, per-company document numbers (invoice numbers). Additive. Idempotent. Rollback: phase2c-document-numbering-rollback.sql.
-- Needs: the company foundation (scripts/saas/phase2-company-foundation.sql). Not run in production.
--
-- Why: the application numbered an invoice as INV-<year>-<number of invoices that year + 1>. That repeats a number after a deletion or an
-- accounts reset, can hand the same number to two concurrent requests, and knows nothing of companies. Here a counter row per
-- (company, kind, period) is advanced by one UPDATE inside a SECURITY DEFINER function, so two callers always get different numbers and a
-- number is never given out twice, whatever is deleted afterwards. A counter never moves down.
--
-- History is preserved: a counter is seeded from the highest number already used in that company and period; for the founding company
-- the migration REFUSES to run when it has no invoice number for the current year and no floor was set, so the first number after an
-- accounts reset cannot silently be 0001. Set the floor (the last number ever issued this year, an owner decision) first:
--     insert into app.config (key, value) values ('document_floor.sunchaser.invoice.2026', '<last number issued>');
-- Format stays INV-<year>-<4 digits> for the founding company. Numbers may have gaps (a number is consumed when asked for, even if the
-- invoice is then not saved); they never repeat.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regprocedure('app.default_company_id()') is null or to_regclass('public.companies') is null then
    raise exception 'apply scripts/saas/phase2-company-foundation.sql first';
  end if;
  if to_regprocedure('app.acting_company_id()') is null then
    raise exception 'apply scripts/saas/phase2b-ownership.sql first (app.acting_company_id is missing)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'company_id') then
    raise exception 'public.invoices has no company_id: the company foundation is not applied';
  end if;
end $$;

create table if not exists public.document_counters (
  company_id text not null references public.companies(id),
  kind       text not null check (kind ~ '^[a-z_]{2,30}$'),
  period     text not null check (period ~ '^[0-9A-Za-z_-]{0,12}$'),
  last_value bigint not null check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, kind, period));
comment on table public.document_counters is
  'Last document number issued per company, kind and period. Written only by next_document_number() / document_counter_set_floor(); the tenant role has no privilege on it.';
alter table public.document_counters enable row level security;
revoke all on public.document_counters from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.document_counters from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.document_counters from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then revoke all on public.document_counters from crm_tenant; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select, insert, update on public.document_counters to service_role; end if;
end $$;

-- A previous rollback kept the counters in app_rollback_backup: bring them back, so re-applying never reissues a number.
do $$ begin
  if to_regclass('app_rollback_backup.document_counters') is not null then
    insert into public.document_counters (company_id, kind, period, last_value, updated_at)
      select b.company_id, b.kind, b.period, b.last_value, b.updated_at from app_rollback_backup.document_counters b
       where exists (select 1 from public.companies c where c.id = b.company_id)
    on conflict (company_id, kind, period) do update set last_value = greatest(public.document_counters.last_value, excluded.last_value);
  end if;
end $$;

-- Invoice numbers are unique PER COMPANY (two companies may both have INV-2026-0001). Remember the dropped global key for rollback.
do $$
declare c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
     where con.conrelid = 'public.invoices'::regclass and con.contype = 'u'
       and (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any (con.conkey)) = array['invoice_number']
  loop
    insert into app.original_state (kind, name, value) values ('dropped_unique', 'invoices.' || c.conname, c.def) on conflict do nothing;
    execute format('alter table public.invoices drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'invoices_company_invoice_number_key' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_company_invoice_number_key unique (company_id, invoice_number);
    insert into app.original_state (kind, name, value) values ('created_unique', 'invoices', 'invoices_company_invoice_number_key') on conflict do nothing;
  end if;
end $$;

-- The next number for the calling company. Only kind 'invoice' exists; the prefix and width are the company's format settings.
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
  return p_prefix || '-' || p_period || '-' || lpad(v_next::text, p_width, '0');
end $$;

-- Operator tool (not callable by the application's tenant role): raise a counter to at least p_floor, never lower it.
create or replace function public.document_counter_set_floor(p_company text, p_kind text, p_period text, p_floor bigint)
returns bigint language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v bigint;
begin
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'unknown company %', p_company using errcode = 'PT404'; end if;
  if p_floor is null or p_floor < 0 then raise exception 'floor must be zero or more' using errcode = 'PT400'; end if;
  insert into public.document_counters (company_id, kind, period, last_value) values (p_company, p_kind, p_period, p_floor)
  on conflict (company_id, kind, period) do update set last_value = greatest(public.document_counters.last_value, excluded.last_value), updated_at = now()
  returning last_value into v;
  return v;
end $$;

revoke all on function public.next_document_number(text, text, text, int) from public;
revoke all on function public.document_counter_set_floor(text, text, text, bigint) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.next_document_number(text, text, text, int) from anon;
    revoke all on function public.document_counter_set_floor(text, text, text, bigint) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.next_document_number(text, text, text, int) from authenticated;
    revoke all on function public.document_counter_set_floor(text, text, text, bigint) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.next_document_number(text, text, text, int) to service_role;
    grant execute on function public.document_counter_set_floor(text, text, text, bigint) to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then
    grant execute on function public.next_document_number(text, text, text, int) to crm_tenant;
    revoke all on function public.document_counter_set_floor(text, text, text, bigint) from crm_tenant; end if;
end $$;

-- Founding company: seed this year's invoice counter from its history and the owner's floor; refuse to start from 0001 by accident.
do $$
declare
  yr text := to_char(now() at time zone 'utc', 'YYYY');
  mx bigint; fl bigint; floor_txt text;
begin
  if not exists (select 1 from public.companies where id = 'sunchaser') then return; end if;
  select coalesce(max(substring(invoice_number from '^INV-' || yr || '-([0-9]+)$')::bigint), 0) into mx
    from public.invoices where company_id = 'sunchaser' and invoice_number ~ ('^INV-' || yr || '-[0-9]+$');
  select value into floor_txt from app.config where key = 'document_floor.sunchaser.invoice.' || yr;
  if floor_txt is not null and floor_txt !~ '^[0-9]+$' then
    raise exception 'app.config document_floor.sunchaser.invoice.% must be a whole number, got "%"', yr, floor_txt;
  end if;
  fl := floor_txt::bigint;
  if mx = 0 and fl is null and not exists (select 1 from public.document_counters where company_id = 'sunchaser' and kind = 'invoice' and period = yr) then
    raise exception 'sunchaser has no INV-%-nnnn invoice and no floor: numbering would restart at 0001. Set the last number ever issued: insert into app.config (key, value) values (''document_floor.sunchaser.invoice.%'', ''<last number>'');', yr, yr;
  end if;
  insert into public.document_counters (company_id, kind, period, last_value) values ('sunchaser', 'invoice', yr, greatest(mx, coalesce(fl, 0)))
  on conflict (company_id, kind, period) do update set last_value = greatest(public.document_counters.last_value, excluded.last_value), updated_at = now();
end $$;

commit;
notify pgrst, 'reload schema';
