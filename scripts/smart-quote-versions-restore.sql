-- Re-imports quotation versions from public.smart_quote_versions_rollback_backup after a rollback AND a re-apply.
--
-- Why this exists: scripts/smart-quote-versions-schema.sql creates an EMPTY table. A rollback keeps the history only in the backup table,
-- so after re-applying, returning clients would look like first-time clients (their old notes-only summary would become "version 1" again
-- and the numbering would restart). Run this once after re-applying to bring the history back.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/smart-quote-versions-restore.sql
--
-- Safe to run more than once. A backup row is skipped (and counted) when
--   * a version with the same id, quote number or (lead, version number) slot already exists, or
--   * its lead no longer exists (the foreign key would be violated).
-- A customer that no longer exists is replaced by NULL (same as ON DELETE SET NULL). The backup table is left untouched.
-- Locks: plain INSERTs (ROW EXCLUSIVE on the new table, ROW SHARE on leads/customers for the foreign-key checks); it waits at most 5 s.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  total bigint;
  inserted bigint;
  orphaned bigint;
begin
  if to_regclass('public.smart_quote_versions') is null then
    raise exception 'public.smart_quote_versions does not exist: apply scripts/smart-quote-versions-schema.sql first';
  end if;
  if to_regclass('public.smart_quote_versions_rollback_backup') is null then
    raise exception 'public.smart_quote_versions_rollback_backup does not exist: there is nothing to restore';
  end if;

  select count(distinct id) into total from public.smart_quote_versions_rollback_backup;
  select count(distinct b.id) into orphaned from public.smart_quote_versions_rollback_backup b where not exists (select 1 from public.leads l where l.id = b.lead_id);

  insert into public.smart_quote_versions
    (id, quote_number, lead_id, customer_id, version_number, source, client_name, client_phone, client_city, system_capacity_kw,
     panel, inverter, battery, structure, lines, subtotal_pkr, discount_pkr, total_pkr, payload_sha256, generated_at, created_at,
     pdf_file_name, pdf_file_url, pdf_storage_path, pdf_sha256, pdf_size_bytes, pdf_saved_at)
  select distinct on (b.id)
         b.id, b.quote_number, b.lead_id, (select c.id from public.customers c where c.id = b.customer_id), b.version_number, b.source, b.client_name, b.client_phone,
         b.client_city, b.system_capacity_kw, b.panel, b.inverter, b.battery, b.structure, b.lines, b.subtotal_pkr, b.discount_pkr, b.total_pkr,
         b.payload_sha256, b.generated_at, b.created_at, b.pdf_file_name, b.pdf_file_url, b.pdf_storage_path, b.pdf_sha256, b.pdf_size_bytes, b.pdf_saved_at
  from public.smart_quote_versions_rollback_backup b
  where exists (select 1 from public.leads l where l.id = b.lead_id)
  order by b.id, b.backed_up_at desc
  on conflict do nothing;
  get diagnostics inserted = row_count;

  raise notice 'restored % of % distinct backed-up versions; % skipped because they already exist or collide, % because their lead is gone',
    inserted, total, total - inserted - orphaned, orphaned;
end
$$;

commit;
