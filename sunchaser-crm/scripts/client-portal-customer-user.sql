-- Phase 1: Portal customer login (run after client-portal-schema.sql)
-- Links a new portal user to an existing customer row by email when possible.
-- Do not reuse legacy demo customer accounts.

INSERT INTO public.users (id, username, password, name, email, role, customer_id)
SELECT
  'u-portal-client',
  'portalclient',
  '123',
  COALESCE(c.name, 'Sunchaser Client'),
  COALESCE(c.email, 'portalclient@sunchaserenergy.co'),
  'Customer',
  c.id
FROM public.customers c
ORDER BY c.created_at DESC
LIMIT 1
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  customer_id = EXCLUDED.customer_id;

UPDATE public.customers c
SET user_id = u.id
FROM public.users u
WHERE u.username = 'portalclient'
  AND c.id = u.customer_id
  AND (c.user_id IS NULL OR c.user_id = u.id);

SELECT id, username, name, email, role, customer_id
FROM public.users
WHERE username = 'portalclient';
