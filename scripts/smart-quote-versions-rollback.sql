-- Rollback for scripts/smart-quote-versions-schema.sql.
-- Copies the version history to a dated backup table first, so no client quotation is lost.
-- The application falls back to its previous lead-notes behaviour when the table is absent.

begin;

create table if not exists public.smart_quote_versions_rollback_backup as
  select now() as backed_up_at, v.* from public.smart_quote_versions v;

drop trigger if exists smart_quote_versions_immutable on public.smart_quote_versions;
drop function if exists public.smart_quote_versions_immutable();
drop table if exists public.smart_quote_versions;

commit;

notify pgrst, 'reload schema';
