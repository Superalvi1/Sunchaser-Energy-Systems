-- Production users for Sunchaser CRM (run in Supabase SQL Editor)
-- Roles use values allowed by users_role_check (Sales Manager / Sales Executive map to app roles via API).

INSERT INTO public.users (id, username, password, name, email, role)
VALUES
  (
    'u-allauddin',
    'allauddin',
    '123',
    'Muhammad Allauddin',
    'allai1432009@gmail.com',
    'Super Admin'
  ),
  (
    'u-raza',
    'raza',
    '123',
    'Barrister Raza Khan Niazi',
    'raza@sunchaserenergy.co',
    'Sales Manager'
  ),
  (
    'u-sales',
    'sales',
    '123',
    'Sales Team',
    'sales@sunchaserenergy.co',
    'Sales Executive'
  )
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  name     = EXCLUDED.name,
  email    = EXCLUDED.email,
  role     = EXCLUDED.role;

-- Optional: verify rows
SELECT id, username, name, email, role, created_at
FROM public.users
WHERE username IN ('allauddin', 'raza', 'sales')
ORDER BY username;
