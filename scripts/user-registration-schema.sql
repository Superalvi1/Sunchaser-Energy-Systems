-- User registration & RBAC columns (run in Supabase SQL Editor)

alter table public.users add column if not exists account_status text not null default 'Approved';
alter table public.users add column if not exists email_verified boolean not null default false;
alter table public.users add column if not exists verification_token text;
alter table public.users add column if not exists verification_token_expires_at timestamptz;
alter table public.users add column if not exists reset_token text;
alter table public.users add column if not exists reset_token_expires_at timestamptz;
alter table public.users add column if not exists approved_at timestamptz;
alter table public.users add column if not exists approved_by text;
alter table public.users add column if not exists rejected_reason text;
alter table public.users add column if not exists updated_at timestamptz default timezone('utc'::text, now());

alter table public.users drop constraint if exists users_account_status_check;
alter table public.users add constraint users_account_status_check check (
  account_status in ('Pending', 'Approved', 'Suspended', 'Rejected')
);

-- Existing seed users: treat as approved + verified
update public.users
set
  account_status = coalesce(nullif(account_status, ''), 'Approved'),
  email_verified = true,
  approved_at = coalesce(approved_at, timezone('utc'::text, now()))
where account_status is null or email_verified = false;

create index if not exists users_account_status_idx on public.users(account_status);
create index if not exists users_email_idx on public.users(lower(email));
