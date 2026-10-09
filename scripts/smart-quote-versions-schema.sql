-- Smart Quote version history (additive, idempotent).
-- Each client quotation is stored once per quote number and linked to one CRM lead.
-- Quotation content is immutable after insert; only the archived PDF reference may be set.
-- Rollback: scripts/smart-quote-versions-rollback.sql

begin;

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

commit;

-- PostgREST must see the new table before the application can use it.
notify pgrst, 'reload schema';
