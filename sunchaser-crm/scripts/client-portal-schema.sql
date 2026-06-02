-- Phase 1: Client Portal — additive schema only (run in Supabase SQL Editor)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS customer_id text REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS user_id text REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_customer_id_idx ON public.users(customer_id);
CREATE INDEX IF NOT EXISTS customers_user_id_idx ON public.customers(user_id);
