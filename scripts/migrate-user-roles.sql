-- Run once in Supabase SQL editor (or via psql) to allow production roles.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'Super Admin', 'Technical CEO', 'Sales Advisor',
  'Admin', 'Sales Manager', 'Sales Executive',
  'Inventory Manager', 'Support Agent', 'Technician',
  'Survey Engineer', 'Installation Team', 'Customer'
));
