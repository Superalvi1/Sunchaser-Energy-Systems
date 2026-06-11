-- Phase 23 — Auto costing sheet extensions (run after internal-costing-investor-schema.sql)

alter table if exists public.internal_costing_sheets add column if not exists title text default '';
alter table if exists public.internal_costing_sheets add column if not exists project_id text;
alter table if exists public.internal_costing_sheets add column if not exists auto_created boolean default false not null;
alter table if exists public.internal_costing_sheets add column if not exists consume_inventory boolean default false not null;
alter table if exists public.internal_costing_sheets add column if not exists stock_reserved boolean default false not null;
alter table if exists public.internal_costing_sheets add column if not exists reserved_stock_value numeric not null default 0;
alter table if exists public.internal_costing_sheets add column if not exists consumed_stock_value numeric not null default 0;

create unique index if not exists idx_internal_costing_sheets_project
  on public.internal_costing_sheets (project_id)
  where project_id is not null;

NOTIFY pgrst, 'reload schema';
