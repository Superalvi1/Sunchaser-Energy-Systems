-- Expand role constraint for RBAC v2 (run after user-registration-schema.sql)

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'Super Admin',
  'Director',
  'Technical CEO',
  'Admin',
  'Accounts Manager',
  'Sales Manager',
  'Sales Executive',
  'Sales Advisor',
  'Survey Engineer',
  'Technician',
  'Service Technician',
  'Installation Team',
  'Inventory Manager',
  'Support Agent',
  'Customer'
));
