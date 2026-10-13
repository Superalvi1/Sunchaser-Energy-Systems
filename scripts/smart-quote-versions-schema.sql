-- Smart Quote version history (additive, idempotent).
-- Each client quotation is stored once per quote number and linked to one CRM lead.
-- Quotation content is immutable after insert; only the archived PDF reference may be set.
-- Rollback: scripts/smart-quote-versions-rollback.sql
-- Pre-flight (read-only): scripts/smart-quote-versions-preflight.sql   Post-check (read-only): scripts/smart-quote-versions-verify.sql
--
-- Run exactly like this, so that the first error stops the script and gives a non-zero exit status:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/smart-quote-versions-schema.sql
--
-- Locks: creating the two foreign keys takes SHARE ROW EXCLUSIVE on public.leads and public.customers for the few milliseconds the
-- transaction lasts (reads continue, writes wait). If another transaction already holds a write lock on those tables the migration
-- must not queue behind it - every later write to leads/customers would queue behind the migration - so it gives up after 5 s with
-- "canceling statement due to lock timeout" and changes nothing. Just run it again a minute later.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.smart_quote_versions (
  id text primary key,
  quote_number text not null unique check (quote_number ~ '^SES-[0-9]{8}-[0-9]{4}$'),
  lead_id text not null references public.leads(id) on delete restrict,
  customer_id text references public.customers(id) on delete set null,
  version_number integer not null check (version_number > 0),
  source text not null default 'Smart Quote',
  client_name text not null,
  client_phone text not null,
  client_city text,
  system_capacity_kw numeric not null,
  panel text not null,
  inverter text not null,
  battery text not null,
  structure text not null,
  lines jsonb,
  subtotal_pkr numeric,
  discount_pkr numeric,
  total_pkr numeric not null check (total_pkr >= 0),
  payload_sha256 text not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  pdf_file_name text,
  pdf_file_url text,
  pdf_storage_path text,
  pdf_sha256 text,
  pdf_size_bytes integer,
  pdf_saved_at timestamptz,
  constraint smart_quote_versions_lead_version_key unique (lead_id, version_number)
);

create index if not exists smart_quote_versions_lead_created_idx
  on public.smart_quote_versions (lead_id, created_at desc);

create or replace function public.smart_quote_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.quote_number, new.lead_id, new.version_number, new.source, new.client_name,
      new.client_phone, new.client_city, new.system_capacity_kw, new.panel, new.inverter,
      new.battery, new.structure, new.lines, new.subtotal_pkr, new.discount_pkr, new.total_pkr,
      new.payload_sha256, new.generated_at, new.created_at)
     is distinct from
     (old.id, old.quote_number, old.lead_id, old.version_number, old.source, old.client_name,
      old.client_phone, old.client_city, old.system_capacity_kw, old.panel, old.inverter,
      old.battery, old.structure, old.lines, old.subtotal_pkr, old.discount_pkr, old.total_pkr,
      old.payload_sha256, old.generated_at, old.created_at) then
    raise exception 'smart_quote_versions rows are immutable; create a new version instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists smart_quote_versions_immutable on public.smart_quote_versions;
create trigger smart_quote_versions_immutable
  before update on public.smart_quote_versions
  for each row execute function public.smart_quote_versions_immutable();

-- Server-only table: the CRM backend uses the service role; no anonymous or customer access.
alter table public.smart_quote_versions enable row level security;
drop policy if exists smart_quote_versions_service_role on public.smart_quote_versions;
create policy smart_quote_versions_service_role on public.smart_quote_versions
  for all to service_role using (true) with check (true);
revoke all on public.smart_quote_versions from anon, authenticated;
grant select, insert, update on public.smart_quote_versions to service_role;

-- `create table if not exists` silently keeps a pre-existing table of the same name. Fail loudly (and roll everything back) if that
-- table does not have the shape the application and the trigger above rely on.
do $$
declare
  problems text;
begin
  select string_agg(e.col || ' ' || e.typ || case when e.not_null then ' not null' else '' end, ', ' order by e.ord) into problems
  from (values
    (1,'id','text',true),(2,'quote_number','text',true),(3,'lead_id','text',true),(4,'customer_id','text',false),(5,'version_number','integer',true),
    (6,'source','text',true),(7,'client_name','text',true),(8,'client_phone','text',true),(9,'client_city','text',false),(10,'system_capacity_kw','numeric',true),
    (11,'panel','text',true),(12,'inverter','text',true),(13,'battery','text',true),(14,'structure','text',true),(15,'lines','jsonb',false),
    (16,'subtotal_pkr','numeric',false),(17,'discount_pkr','numeric',false),(18,'total_pkr','numeric',true),(19,'payload_sha256','text',true),
    (20,'generated_at','timestamp with time zone',true),(21,'created_at','timestamp with time zone',true),(22,'pdf_file_name','text',false),
    (23,'pdf_file_url','text',false),(24,'pdf_storage_path','text',false),(25,'pdf_sha256','text',false),(26,'pdf_size_bytes','integer',false),
    (27,'pdf_saved_at','timestamp with time zone',false)
  ) e(ord, col, typ, not_null)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'smart_quote_versions' and c.column_name = e.col and c.data_type = e.typ
      and (c.is_nullable = 'NO') = e.not_null);
  if problems is not null then
    raise exception 'public.smart_quote_versions already exists with a different shape; missing or mismatched columns: %', problems;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.smart_quote_versions'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.smart_quote_versions'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (quote_number)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.smart_quote_versions'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (lead_id, version_number)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.smart_quote_versions'::regclass and contype = 'f' and confrelid = 'public.leads'::regclass and confdeltype = 'r')
     or not exists (select 1 from pg_constraint where conrelid = 'public.smart_quote_versions'::regclass and contype = 'f' and confrelid = 'public.customers'::regclass and confdeltype = 'n') then
    raise exception 'public.smart_quote_versions already exists without the expected key constraints (primary key, unique quote_number, unique lead/version, foreign keys to leads and customers)';
  end if;
end
$$;

-- PostgREST must see the new table before the application can use it. NOTIFY inside the transaction is delivered on commit, i.e.
-- only after the table is visible (and not at all if anything above failed). If PostgREST sits behind a pooler or has
-- db-channel-enabled=false, restart that service instead.
notify pgrst, 'reload schema';

commit;
