-- =============================================================================
-- Sunchaser: User registration & RBAC — full migration (idempotent, safe)
-- Run once in Supabase SQL Editor. Does NOT delete or truncate users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Registration / status / verification / reset / approval columns
-- -----------------------------------------------------------------------------
alter table public.users add column if not exists account_status text;
alter table public.users add column if not exists email_verified boolean;
alter table public.users add column if not exists verification_token text;
alter table public.users add column if not exists verification_token_expires_at timestamptz;
alter table public.users add column if not exists reset_token text;
alter table public.users add column if not exists reset_token_expires_at timestamptz;
alter table public.users add column if not exists approved_at timestamptz;
alter table public.users add column if not exists approved_by text;
alter table public.users add column if not exists rejected_reason text;
alter table public.users add column if not exists updated_at timestamptz;

-- Backfill NULLs before NOT NULL defaults (safe for re-runs)
update public.users
set account_status = 'Approved'
where account_status is null;

update public.users
set email_verified = true
where email_verified is null;

update public.users
set updated_at = coalesce(updated_at, timezone('utc'::text, now()))
where updated_at is null;

-- Defaults for new rows (idempotent: only set if column has no default yet)
do $$
begin
  if not exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'users' and a.attname = 'account_status'
  ) then
    alter table public.users alter column account_status set default 'Approved';
  end if;
  if not exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'users' and a.attname = 'email_verified'
  ) then
    alter table public.users alter column email_verified set default false;
  end if;
  if not exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'users' and a.attname = 'updated_at'
  ) then
    alter table public.users alter column updated_at set default timezone('utc'::text, now());
  end if;
end $$;

-- Optional NOT NULL (only if no nulls remain — safe after backfill above)
do $$
begin
  if not exists (
    select 1 from public.users where account_status is null limit 1
  ) then
    alter table public.users alter column account_status set not null;
  end if;
exception when others then
  raise notice 'account_status NOT NULL skipped: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Account status constraint (Pending | Approved | Suspended | Rejected)
-- -----------------------------------------------------------------------------
alter table public.users drop constraint if exists users_account_status_check;
alter table public.users add constraint users_account_status_check check (
  account_status in ('Pending', 'Approved', 'Suspended', 'Rejected')
);

-- -----------------------------------------------------------------------------
-- 3. Existing users: approved + verified (never removes rows)
-- -----------------------------------------------------------------------------
update public.users
set
  account_status = coalesce(nullif(trim(account_status), ''), 'Approved'),
  email_verified = coalesce(email_verified, true),
  approved_at = coalesce(approved_at, timezone('utc'::text, now()))
where
  account_status is null
  or trim(account_status) = ''
  or email_verified is false
  or email_verified is null
  or approved_at is null;

-- Staff/seed accounts that were already active should stay Approved
update public.users
set account_status = 'Approved'
where account_status not in ('Pending', 'Approved', 'Suspended', 'Rejected');

-- -----------------------------------------------------------------------------
-- 4. Role constraint (RBAC v2 + legacy roles still in DB)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
create index if not exists users_account_status_idx on public.users(account_status);
create index if not exists users_email_idx on public.users(lower(email));
create index if not exists users_username_idx on public.users(lower(username));

-- -----------------------------------------------------------------------------
-- Done. Verify (optional):
-- select id, username, role, account_status, email_verified from public.users limit 20;
-- =============================================================================
