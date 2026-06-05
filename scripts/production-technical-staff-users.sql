-- Production technical staff users (Supabase SQL Editor)
-- Passwords are demo plain text "123" — change in production if required.
-- Prerequisite: scripts/client-portal-phase9-schema.sql (onboarding columns) optional but recommended.

-- Allow Service Technician role (Phase 9 field portal)
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in (
  'Super Admin', 'Technical CEO', 'Sales Advisor',
  'Admin', 'Sales Manager', 'Sales Executive',
  'Inventory Manager', 'Support Agent', 'Technician',
  'Service Technician',
  'Survey Engineer', 'Installation Team', 'Customer'
));

insert into public.users (id, username, password, name, email, role)
values
  (
    'u-4',
    'surveyor',
    '123',
    'Bob Surveyor',
    'bob@sunchaser.com',
    'Survey Engineer'
  ),
  (
    'u-5',
    'installer',
    '123',
    'Dave Installer',
    'dave@sunchaser.com',
    'Installation Team'
  ),
  (
    'u-10',
    'technician',
    '123',
    'Field Technician',
    'dave.tech@sunchaser.com',
    'Service Technician'
  )
on conflict (username) do update set
  password = excluded.password,
  name     = excluded.name,
  email    = excluded.email,
  role     = excluded.role;

-- Verify logins
select id, username, name, email, role, created_at
from public.users
where username in ('surveyor', 'installer', 'technician')
order by username;
