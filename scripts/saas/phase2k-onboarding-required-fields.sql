-- t10: restored production schemas require these four contact columns and have no defaults.
-- Change only future company creation. Never back-fill or copy founding-company details.
begin;
set local lock_timeout = '5s';
create or replace function public.saas_create_company(p_id text, p_name text, p_plan text, p_trial_days integer, p_user jsonb, p_actor jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $f$
declare sub_id text := 'sub_' || replace(gen_random_uuid()::text, '-', '');
begin
  if p_id !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'invalid company id' using errcode = '22023'; end if;
  if p_id = 'sunchaser' then raise exception 'the founding company id cannot be used' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'company name is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.saas_plans where id = p_plan and active) then raise exception 'unknown or inactive plan %', p_plan using errcode = '22023'; end if;
  insert into public.companies (id, slug, name, status) values (p_id, replace(p_id, '_', '-'), trim(p_name), 'trial');
  insert into public.saas_subscriptions (id, company_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (sub_id, p_id, p_plan, 'trial', now() + make_interval(days => greatest(p_trial_days, 0)), current_date, current_date + greatest(p_trial_days, 0));
  insert into public.users (id, username, password, name, email, role, account_status, email_verified, onboarding_completed, approved_at, approved_by)
    values (p_user ->> 'id', lower(p_user ->> 'username'), p_user ->> 'password_hash', p_user ->> 'name', lower(p_user ->> 'email'), 'Admin', 'Approved', true, false, now(), p_actor ->> 'username');
  insert into public.company_memberships (id, company_id, user_id, role, status)
    values ('mem_' || replace(gen_random_uuid()::text, '-', ''), p_id, p_user ->> 'id', 'Admin', 'active');
  insert into public.settings (key, value, company_id) values (p_id || ':company_branding', jsonb_build_object('companyName', trim(p_name), 'legacyDefaults', false), p_id);
  -- Explicit neutral contact fields also satisfy older strict production schemas.
  insert into public.quote_pdf_settings (id, company_name, office_address, hotline_phones, billing_email, website_url, use_default_company_content, company_id)
    values (p_id || '_pdf_settings', trim(p_name), '', '', '', '', false, p_id);
  insert into public.saas_audit (actor_user_id, actor_username, action, company_id, detail)
    values (p_actor ->> 'id', p_actor ->> 'username', 'company.created', p_id, jsonb_build_object('name', trim(p_name), 'plan', p_plan, 'trial_days', p_trial_days, 'owner_username', lower(p_user ->> 'username')));
  return jsonb_build_object('company_id', p_id, 'subscription_id', sub_id, 'owner_user_id', p_user ->> 'id');
end $f$;
commit;
notify pgrst, 'reload schema';
