-- Rollback for scripts/session-revocation-schema.sql.
-- Order does not matter for availability: a running new build notices the missing table (PostgREST PGRST205), logs one
-- INACTIVE warning, sets sessionRevocationActive=false on /health and carries on as before the migration.
-- Effects: every logged-out / rotated-out token that has not yet expired becomes valid again, and tokens revoked by
-- "sign out of all devices" likewise. If that matters, rotate JWT_SECRET (signs everyone out) instead of rolling back.

begin;
drop table if exists public.revoked_sessions;
alter table public.users drop column if exists session_epoch;
commit;

notify pgrst, 'reload schema';
