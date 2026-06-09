-- Phase 21 — Solar Package Library schema extensions
-- Run against Supabase when upgrading from base supabase-schema.sql

alter table if exists public.solar_packages add column if not exists system_size_kw numeric;
alter table if exists public.solar_packages add column if not exists equipment_tier text default 'budgeted';
alter table if exists public.solar_packages add column if not exists boq_rows jsonb default '[]'::jsonb;
alter table if exists public.solar_packages add column if not exists archived boolean default false not null;
alter table if exists public.solar_packages add column if not exists discount_type text default 'fixed';
alter table if exists public.solar_packages add column if not exists discount_value numeric default 0;

NOTIFY pgrst, 'reload schema';
