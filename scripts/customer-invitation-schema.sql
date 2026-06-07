-- Phase 14A: Customer invitation code for portal account linking
-- Run scripts/customer-invitation-schema.sql in Supabase SQL Editor
-- Do NOT auto-run this migration from application code.

-- customer_code is used for portal invitation / account linking.
-- Each code is permanently assigned to one customer; never reuse codes after assignment.

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS customer_code TEXT;

COMMENT ON COLUMN public.customers.customer_code IS
  'Unique SES-XXXXXX invitation code for customer portal registration and account linking. Never reuse.';

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_code_idx
ON public.customers(customer_code)
WHERE customer_code IS NOT NULL;

-- Collision-safe backfill for existing customers missing a code.
DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  attempts INT;
  max_attempts INT := 50;
BEGIN
  FOR rec IN
    SELECT id FROM public.customers
    WHERE customer_code IS NULL OR btrim(customer_code) = ''
    ORDER BY created_at NULLS LAST, id
  LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      IF attempts > max_attempts THEN
        RAISE EXCEPTION 'Could not assign unique customer_code for customer % after % attempts', rec.id, max_attempts;
      END IF;

      candidate := 'SES-' || lpad((floor(random() * 900000 + 100000))::int::text, 6, '0');

      IF NOT EXISTS (
        SELECT 1 FROM public.customers c WHERE c.customer_code = candidate
      ) THEN
        UPDATE public.customers
        SET customer_code = candidate
        WHERE id = rec.id
          AND (customer_code IS NULL OR btrim(customer_code) = '');
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Report: Run scripts/customer-invitation-schema.sql in Supabase SQL Editor
