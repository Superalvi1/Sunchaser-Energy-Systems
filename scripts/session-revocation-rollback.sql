-- Rollback for scripts/session-revocation-schema.sql.
-- Roll the APPLICATION back first (or set SESSION_REVOCATION_DISABLED=1 and restart): while the app is running with
-- revocation active, dropping the table makes revocation checks fail closed (503) until it is restarted.
-- Effects: every logged-out / rotated-out token that has not yet expired becomes valid again, and tokens revoked by
-- "sign out of all devices" likewise. If that matters, rotate JWT_SECRET (signs everyone out) instead of rolling back.

begin;
drop table if exists public.revoked_sessions;
alter table public.users drop column if exists session_epoch;
commit;

notify pgrst, 'reload schema';
