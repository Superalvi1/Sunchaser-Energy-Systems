-- Marketplace WS1 — additive catalogue metadata (manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT apply to staging without separate owner authorization.
-- *****************************************************************************
--
-- Adds non-price product metadata required for storefront parity:
--   mp_products.specifications  jsonb NOT NULL DEFAULT '{}'::jsonb
--   mp_products.warranty        text NULL
--
-- Follows WS0 ownership: service_role only; RLS forced; anon/authenticated revoked.
-- Safely repeatable (IF NOT EXISTS / guarded constraint creation).

-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.mp_products
  add column if not exists specifications jsonb not null default '{}'::jsonb;

alter table public.mp_products
  add column if not exists warranty text;

alter table public.mp_products
  alter column specifications set default '{}'::jsonb;

update public.mp_products
set specifications = '{}'::jsonb
where specifications is null;

alter table public.mp_products
  alter column specifications set not null;

-- =============================================================================
-- 2. JSON object validation
-- =============================================================================
do $ws1$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mp_products_specifications_object_ck'
      and conrelid = 'public.mp_products'::regclass
  ) then
    alter table public.mp_products
      add constraint mp_products_specifications_object_ck
      check (jsonb_typeof(specifications) = 'object');
  end if;
end $ws1$;

-- =============================================================================
-- 3. Reaffirm table privileges (do not weaken RLS)
-- =============================================================================
alter table public.mp_products enable row level security;
alter table public.mp_products force row level security;

revoke all on table public.mp_products from public;
do $ws1$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mp_products from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mp_products from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.mp_products to service_role;
  end if;
end $ws1$;
