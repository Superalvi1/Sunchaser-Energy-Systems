-- Controlled failure-atomicity probe for normalized messaging DDL.
-- Runs in a single explicit transaction: create one messaging table, then fail.
-- With ON_ERROR_STOP, the aborted transaction must leave no messaging_* objects.
--
-- Expected: psql exits non-zero; catalog shows zero messaging_* tables afterward.

BEGIN;

CREATE TABLE public.messaging_contacts (
  id text primary key,
  organization_id text not null default 'sunchaser'
);

-- Force failure AFTER schema creation has begun.
DO $$
BEGIN
  RAISE EXCEPTION 'controlled_failure_atomicity_test'
    USING ERRCODE = 'P0001';
END
$$;

COMMIT;
