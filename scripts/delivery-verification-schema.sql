-- Phase 24 FINAL — QR + WhatsApp public delivery verification
-- Run after scripts/delivery-management-schema.sql

alter table public.delivery_challans add column if not exists verification_token text;
alter table public.delivery_challans add column if not exists token_expires_at timestamptz;
alter table public.delivery_challans add column if not exists public_verification_status text default 'pending';
alter table public.delivery_challans add column if not exists verified_at timestamptz;
alter table public.delivery_challans add column if not exists verified_ip text;
alter table public.delivery_challans add column if not exists verified_user_agent text;
alter table public.delivery_challans add column if not exists dispute_details jsonb default '{}'::jsonb;
alter table public.delivery_challans add column if not exists signed_by_name text;
alter table public.delivery_challans add column if not exists signed_by_phone text;
alter table public.delivery_challans add column if not exists signed_relation text;

create unique index if not exists idx_delivery_challans_verification_token
  on public.delivery_challans (verification_token)
  where verification_token is not null;

NOTIFY pgrst, 'reload schema';
