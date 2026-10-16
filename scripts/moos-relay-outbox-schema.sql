-- Moos WhatsApp agent — durable inbound relay outbox.
--
-- The WhatsApp webhook enqueues normalized inbound events here (unique wamid)
-- and a periodic drain delivers them to the Moos worker with bounded
-- retry/backoff. Dead-lettered rows are surfaced to staff via the
-- MOOS_RELAY_DEAD_LETTER audit event (see server/moos/moosRelayOutbox.ts).
--
-- Apply once per Supabase project before enabling MOOS_RELAY_ENABLED=true.

create table if not exists moos_relay_outbox (
  wamid text primary key,
  company_id text not null default 'sunchaser',
  conversation_id text not null,
  phone text not null,
  phone_number_id text not null,
  type text not null default 'text',
  text text not null default '',
  sent_at bigint not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'delivered', 'suppressed', 'dead_letter')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists moos_relay_outbox_due_idx
  on moos_relay_outbox (status, next_attempt_at)
  where status = 'queued';

create index if not exists moos_relay_outbox_conversation_idx
  on moos_relay_outbox (company_id, conversation_id);

-- Customer messages and phone numbers are confidential. Supabase service-role
-- access for the CRM backend is preserved; browser anon/auth roles get none.
-- RLS protects the table if default grants or policies change later.
alter table public.moos_relay_outbox enable row level security;
revoke all on table public.moos_relay_outbox from anon, authenticated;
