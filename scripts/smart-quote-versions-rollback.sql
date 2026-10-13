-- Rollback for scripts/smart-quote-versions-schema.sql.
--
-- Copies EVERY current quotation version into public.smart_quote_versions_rollback_backup first, checks the copy, and only then drops
-- the feature. The backup table is append-only: each rollback adds one batch (identified by backed_up_at), so a later
-- apply -> use -> rollback cycle cannot lose the versions created in between. (The earlier script used CREATE TABLE IF NOT EXISTS ... AS
-- SELECT, which silently skipped the copy on the second rollback and then dropped the only copy of the new versions.)
--
-- The backup table holds client names and phone numbers: it is locked down (row level security on, no privileges for PUBLIC, anon,
-- authenticated or service_role - only the owner role that runs this script can read it). Export it and drop it once no longer needed.
--
-- Run:  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/smart-quote-versions-rollback.sql
--
-- Locks: DROP TABLE removes the foreign-key triggers from public.leads and public.customers, which takes ACCESS EXCLUSIVE on both for
-- a few milliseconds - reads AND writes of those tables wait during that time. lock_timeout = 5 s makes the rollback give up (changing
-- nothing) instead of freezing the CRM behind a long-running query; re-run it a minute later.
--
-- What the application does afterwards: until the table is gone from PostgREST's schema cache it answers 404/PGRST205 and the server
-- treats that as "version history not installed"; Smart Quote then falls back to the previous behaviour (one lead per generated quote,
-- quotation kept in the lead notes only). Leads keep their "Version: N" note lines. Redeploying older code is NOT required, but the
-- fallback re-creates the old duplicate-lead behaviour for repeat clients until the migration is re-applied.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  expected bigint;
  copied bigint;
begin
  if to_regclass('public.smart_quote_versions') is null then
    raise notice 'public.smart_quote_versions does not exist - nothing to roll back';
    return;
  end if;

  create table if not exists public.smart_quote_versions_rollback_backup (
    backed_up_at timestamptz not null,
    like public.smart_quote_versions
  );
  alter table public.smart_quote_versions_rollback_backup enable row level security;
  revoke all on public.smart_quote_versions_rollback_backup from public, anon, authenticated, service_role;

  select count(*) into expected from public.smart_quote_versions;
  insert into public.smart_quote_versions_rollback_backup
    (backed_up_at, id, quote_number, lead_id, customer_id, version_number, source, client_name, client_phone, client_city, system_capacity_kw,
     panel, inverter, battery, structure, lines, subtotal_pkr, discount_pkr, total_pkr, payload_sha256, generated_at, created_at,
     pdf_file_name, pdf_file_url, pdf_storage_path, pdf_sha256, pdf_size_bytes, pdf_saved_at)
  select now(), v.id, v.quote_number, v.lead_id, v.customer_id, v.version_number, v.source, v.client_name, v.client_phone, v.client_city, v.system_capacity_kw,
         v.panel, v.inverter, v.battery, v.structure, v.lines, v.subtotal_pkr, v.discount_pkr, v.total_pkr, v.payload_sha256, v.generated_at, v.created_at,
         v.pdf_file_name, v.pdf_file_url, v.pdf_storage_path, v.pdf_sha256, v.pdf_size_bytes, v.pdf_saved_at
  from public.smart_quote_versions v;

  select count(*) into copied from public.smart_quote_versions_rollback_backup where backed_up_at = now();
  if copied <> expected then
    raise exception 'rollback aborted: % versions in the live table but % copied to the backup; nothing was dropped', expected, copied;
  end if;
  raise notice 'backed up % quotation version(s) to public.smart_quote_versions_rollback_backup (batch %)', copied, now();

  drop trigger if exists smart_quote_versions_immutable on public.smart_quote_versions;
  drop table public.smart_quote_versions;
  drop function if exists public.smart_quote_versions_immutable();
end
$$;

-- Tell PostgREST the table is gone (delivered on commit).
notify pgrst, 'reload schema';

commit;
