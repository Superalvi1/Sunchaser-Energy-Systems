-- WhatsApp Web durable sync job results (SYNC-8)
-- Additive, idempotent, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application.
--
-- Access model: backend service_role only.
-- No anon / authenticated browser policies.

create table if not exists public.whatsapp_web_sync_jobs (
  company_id text primary key,
  job_id text not null,
  status text not null,
  outcome text,
  started_at timestamptz,
  completed_at timestamptz,
  contacts_discovered integer not null default 0,
  contacts_created integer not null default 0,
  contacts_updated integer not null default 0,
  contacts_skipped integer not null default 0,
  messages_discovered integer not null default 0,
  messages_imported integer not null default 0,
  messages_skipped integer not null default 0,
  duplicates_skipped integer not null default 0,
  failed_chats integer not null default 0,
  chats_inspected integer not null default 0,
  conversations_created integer not null default 0,
  conversations_updated integer not null default 0,
  history_coverage text not null default 'unknown',
  history_availability text not null default 'unknown',
  history_source_ready boolean not null default false,
  history_provider_event_observed boolean not null default false,
  history_on_demand_supported boolean not null default false,
  history_oldest_available_at timestamptz,
  history_newest_available_at timestamptz,
  window_days integer not null default 7,
  error_summary text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_web_sync_jobs_status_check check (
    status in ('idle', 'starting', 'running', 'completed', 'failed')
  ),
  constraint whatsapp_web_sync_jobs_outcome_check check (
    outcome is null
    or outcome in (
      'completed_with_imports',
      'completed_no_changes',
      'history_not_available',
      'partial',
      'failed'
    )
  )
);

comment on table public.whatsapp_web_sync_jobs is
  'Latest WhatsApp Web contact/history sync result per company. Non-PII operational fields only. Backend/service_role.';

alter table public.whatsapp_web_sync_jobs enable row level security;

-- Intentionally no anon/authenticated policies — service_role bypasses RLS.

revoke all on table public.whatsapp_web_sync_jobs from public;
revoke all on table public.whatsapp_web_sync_jobs from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.whatsapp_web_sync_jobs to service_role;
  else
    raise notice 'service_role missing — skip table grant (local/non-Supabase)';
  end if;
end $$;
