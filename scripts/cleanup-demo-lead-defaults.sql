-- Clear demo placeholder location/advisor values written by legacy lead creation defaults.
-- Safe to run multiple times. Review affected rows before running in production.

-- Preview affected rows:
-- select id, name, location, assigned_salesperson, address
-- from public.leads
-- where lower(trim(coalesce(location, ''))) = 'springfield'
--    or lower(trim(coalesce(assigned_salesperson, ''))) = 'sarah connor';

update public.leads
set location = null
where lower(trim(coalesce(location, ''))) in ('springfield', 'shelbyville', 'capital district', 'westwood');

update public.leads
set assigned_salesperson = null
where lower(trim(coalesce(assigned_salesperson, ''))) in ('sarah connor', 'michael scott', 'alex admin');

notify pgrst, 'reload schema';
