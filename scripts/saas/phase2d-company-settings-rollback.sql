-- Rollback of phase2d-company-settings.sql: removes the key-scope constraints. Rows are not touched. Settings stored by other companies under
-- "<company>:<key>" stay where they are (harmless; the application of this release ignores them).
begin;
set local lock_timeout = '5s';
alter table if exists public.settings drop constraint if exists settings_company_key_scope;
alter table if exists public.website_content drop constraint if exists website_content_company_key_scope;
commit;
