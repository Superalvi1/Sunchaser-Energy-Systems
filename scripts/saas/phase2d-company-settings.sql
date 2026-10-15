-- Phase 2d: company-scoped settings keys. Additive. Idempotent. Rollback: phase2d-company-settings-rollback.sql.
-- Needs: the company foundation (scripts/saas/phase2-company-foundation.sql). Not run in production.
--
-- Why: settings and website_content are keyed by `key` alone ("global", "company_branding", ...). With two companies both would write
-- the same key and the second company's save would collide with (or be refused because of) the first company's row. The application now
-- stores every company other than the founding one under "<company>:<key>". This migration makes the database enforce that rule, so a
-- code mistake produces an error instead of a collision. The founding company keeps its keys unchanged and no row is rewritten.
-- Existing rows all belong to the founding company (constant column default), so the constraints validate immediately.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.companies') is null or to_regprocedure('app.default_company_id()') is null then
    raise exception 'apply scripts/saas/phase2-company-foundation.sql first';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'company_id') is false then
    raise exception 'public.settings has no company_id: the company foundation is not applied';
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings', 'website_content'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_company_key_scope');
    execute format(
      'alter table public.%I add constraint %I check (company_id = %L or left(key, length(company_id) + 1) = company_id || %L)',
      t, t || '_company_key_scope', 'sunchaser', ':');
  end loop;
end $$;

commit;
