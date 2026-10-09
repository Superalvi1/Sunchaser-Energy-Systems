-- Server-side session revocation (additive, idempotent). Rollback: scripts/session-revocation-rollback.sql
-- Read-only check first: scripts/session-revocation-preflight.sql
--
--  * public.revoked_sessions   one row per revoked token id (jti). POST /api/auth/logout inserts the caller's token;
--                              refresh rotation inserts the OLD token with revoked_at slightly in the future (grace).
--                              Rows are only needed until expires_at (the token's own expiry) and are purged after.
--  * public.users.session_epoch  integer, 0 by default. "Sign out of all devices", suspend/reject/pending and the admin
--                              "revoke sessions" action increment it; tokens carry the epoch they were minted under.
--
-- Safe to apply before OR after the application is deployed: without these objects the app behaves exactly as before
-- and reports sessionRevocationActive=false on /health; tokens issued earlier keep working until they expire.

begin;

alter table public.users add column if not exists session_epoch integer not null default 0;
comment on column public.users.session_epoch is
  'Incremented to revoke every JWT issued earlier (sign out everywhere, suspension, admin revoke). 0 = never revoked.';

create table if not exists public.revoked_sessions (
  jti text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now(),
  replaced_by text
);
comment on table public.revoked_sessions is
  'Revoked JWT ids. revoked_at in the future = refresh-rotation grace. Purge rows where expires_at < now().';

create index if not exists revoked_sessions_expires_at_idx on public.revoked_sessions (expires_at);
create index if not exists revoked_sessions_user_id_idx on public.revoked_sessions (user_id);

-- Server-only table: the CRM backend uses the service role; no anonymous or customer access.
alter table public.revoked_sessions enable row level security;
drop policy if exists revoked_sessions_service_role on public.revoked_sessions;
create policy revoked_sessions_service_role on public.revoked_sessions
  for all to service_role using (true) with check (true);
revoke all on public.revoked_sessions from anon, authenticated;
grant select, insert, update, delete on public.revoked_sessions to service_role;

commit;

-- PostgREST must see the new table and column before the application can use them.
notify pgrst, 'reload schema';
