-- Design Sessions (RC-1.1) — one draft design session per CRM lead
-- Additive, idempotent. Run in Supabase SQL Editor after supabase-schema.sql.
-- Stores Design Studio workspace payload (geometry, calibration, layout, settings).
-- Engine outputs (electrical / simulation / proposal) are cached in payload and
-- recomputed on restore via existing engines — no duplicate formulas.

create table if not exists public.design_sessions (
  id text primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  concurrent_edit_detected boolean not null default false,
  last_modified_by text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint design_sessions_lead_id_unique unique (lead_id)
);

create index if not exists design_sessions_lead_id_idx
  on public.design_sessions(lead_id);

create index if not exists design_sessions_updated_at_idx
  on public.design_sessions(updated_at desc);

comment on table public.design_sessions is
  'One Design Studio session per lead. Versioned draft payload; engines recompute on restore.';
