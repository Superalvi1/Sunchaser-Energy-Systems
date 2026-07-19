-- WhatsApp Shared Inbox — PR 2 schema foundation (additive, manual apply only)
-- Architecture: PR 2 Revision 3
-- Do NOT auto-apply. Run in Supabase SQL Editor when ready.
--
-- Forward-only migration. No rollback companion. No drops of PR 1 tables/columns.
-- company_id defaults to 'sunchaser' as a placeholder scope (same as PR 1).
-- This is NOT an active multi-tenant isolation boundary yet.
--
-- SECURITY / RLS:
-- Tables are backend-only. Browser clients (anon / authenticated) must NOT
-- receive direct table grants. Access WhatsApp data only through authenticated
-- Sunchaser API routes. The Node backend uses SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. RLS is enabled with NO permissive policies.

-- -----------------------------------------------------------------------------
-- 1. Additive columns on PR 1 whatsapp_conversations
-- -----------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists assigned_user_id text;

alter table public.whatsapp_conversations
  add column if not exists assigned_at timestamptz;

alter table public.whatsapp_conversations
  add column if not exists assigned_by text;

alter table public.whatsapp_conversations
  add column if not exists lock_version integer not null default 1;

alter table public.whatsapp_conversations
  add column if not exists has_failed_message boolean not null default false;

-- Canonical 4-state workflow (Revision 3). Existing PR 1 rows are status='open'.
-- Drop+re-add keeps re-runs idempotent without touching row data.
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_status_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_status_check
  check (status in ('open', 'pending', 'resolved', 'archived')) not valid;

alter table public.whatsapp_conversations
  validate constraint whatsapp_conversations_status_check;

-- -----------------------------------------------------------------------------
-- 2. Conversation indexes (activity sort vs delta poll — independent keys)
-- -----------------------------------------------------------------------------
-- Primary list ordering: messaging activity only (assignment/status never reorder).
create index if not exists whatsapp_conversations_activity_idx
  on public.whatsapp_conversations (
    company_id,
    (coalesce(last_message_at, created_at)) desc,
    id
  );

-- Delta/reconciliation key for incremental polling (ASC for forward keyset).
-- Replace any earlier DESC form so the index matches monotonic page traversal.
drop index if exists public.whatsapp_conversations_delta_idx;
create index if not exists whatsapp_conversations_delta_idx
  on public.whatsapp_conversations (company_id, updated_at asc, id);

create index if not exists whatsapp_conversations_assigned_idx
  on public.whatsapp_conversations (assigned_user_id)
  where assigned_user_id is not null;

create index if not exists whatsapp_conversations_failed_idx
  on public.whatsapp_conversations (company_id)
  where has_failed_message = true;

-- -----------------------------------------------------------------------------
-- 3. Additive indexes on PR 1 whatsapp_messages
-- -----------------------------------------------------------------------------
-- Free-form 24h window: latest inbound by Meta occurred_at.
create index if not exists whatsapp_messages_conversation_inbound_idx
  on public.whatsapp_messages (conversation_id, occurred_at desc)
  where direction = 'inbound';

-- Inbound-only unread / watermark resolution by (created_at, id).
create index if not exists whatsapp_messages_inbound_created_idx
  on public.whatsapp_messages (conversation_id, created_at desc, id desc)
  where direction = 'inbound';

-- -----------------------------------------------------------------------------
-- 4. Assignment events (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_conversation_assignment_events (
  id text primary key,
  company_id text not null default 'sunchaser',
  conversation_id text not null references public.whatsapp_conversations (id) on delete cascade,
  assigned_user_id text,
  assigned_by text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_assignment_events_conv_idx
  on public.whatsapp_conversation_assignment_events (conversation_id, created_at desc);

create index if not exists whatsapp_assignment_events_company_idx
  on public.whatsapp_conversation_assignment_events (company_id);

-- -----------------------------------------------------------------------------
-- 5. Conversation status events (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_conversation_status_events (
  id text primary key,
  company_id text not null default 'sunchaser',
  conversation_id text not null references public.whatsapp_conversations (id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('open', 'pending', 'resolved', 'archived')),
  changed_by_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_status_events_conv_idx
  on public.whatsapp_conversation_status_events (conversation_id, created_at desc);

create index if not exists whatsapp_status_events_company_idx
  on public.whatsapp_conversation_status_events (company_id);

-- -----------------------------------------------------------------------------
-- 6. Per-user inbound read watermarks
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_read_watermarks (
  company_id text not null default 'sunchaser',
  conversation_id text not null references public.whatsapp_conversations (id) on delete cascade,
  user_id text not null,
  last_read_inbound_message_id text,
  last_read_inbound_message_created_at timestamptz,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (conversation_id, user_id)
);

create index if not exists whatsapp_read_watermarks_user_idx
  on public.whatsapp_read_watermarks (user_id);

create index if not exists whatsapp_read_watermarks_company_idx
  on public.whatsapp_read_watermarks (company_id);

-- -----------------------------------------------------------------------------
-- 7. CRM links (one active typed link per conversation)
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_conversation_crm_links (
  conversation_id text primary key references public.whatsapp_conversations (id) on delete cascade,
  company_id text not null default 'sunchaser',
  linked_entity_type text not null check (linked_entity_type in ('lead', 'customer')),
  linked_entity_id text not null,
  linked_by_user_id text not null,
  linked_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_crm_links_company_idx
  on public.whatsapp_conversation_crm_links (company_id);

create index if not exists whatsapp_crm_links_entity_idx
  on public.whatsapp_conversation_crm_links (linked_entity_type, linked_entity_id);

-- -----------------------------------------------------------------------------
-- 8. Outbound send idempotency keys (atomic claim + state machine)
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_outbound_idempotency_keys (
  idempotency_key text primary key,
  company_id text not null default 'sunchaser',
  conversation_id text not null references public.whatsapp_conversations (id) on delete cascade,
  state text not null default 'processing'
    check (state in ('processing', 'completed', 'failed_known', 'outcome_unknown')),
  message_id text,
  error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  completed_at timestamptz
);

create index if not exists whatsapp_idempotency_conversation_idx
  on public.whatsapp_outbound_idempotency_keys (conversation_id);

create index if not exists whatsapp_idempotency_company_idx
  on public.whatsapp_outbound_idempotency_keys (company_id);

create index if not exists whatsapp_idempotency_created_idx
  on public.whatsapp_outbound_idempotency_keys (created_at);

-- -----------------------------------------------------------------------------
-- 9. RLS lockdown (backend service-role bypass only)
-- -----------------------------------------------------------------------------
alter table public.whatsapp_conversation_assignment_events enable row level security;
alter table public.whatsapp_conversation_status_events enable row level security;
alter table public.whatsapp_read_watermarks enable row level security;
alter table public.whatsapp_conversation_crm_links enable row level security;
alter table public.whatsapp_outbound_idempotency_keys enable row level security;

revoke all on table public.whatsapp_conversation_assignment_events from anon, authenticated;
revoke all on table public.whatsapp_conversation_status_events from anon, authenticated;
revoke all on table public.whatsapp_read_watermarks from anon, authenticated;
revoke all on table public.whatsapp_conversation_crm_links from anon, authenticated;
revoke all on table public.whatsapp_outbound_idempotency_keys from anon, authenticated;

comment on table public.whatsapp_conversation_assignment_events is
  'Append-only assignment audit for the shared WhatsApp inbox. Backend-only.';
comment on table public.whatsapp_conversation_status_events is
  'Append-only conversation status transitions. metadata.trigger records system reopen source. Backend-only.';
comment on table public.whatsapp_read_watermarks is
  'Per-user inbound read watermarks (created_at, message_id) tuples. Backend-only.';
comment on table public.whatsapp_conversation_crm_links is
  'Explicit CRM lead/customer link for a conversation. Backend-only.';
comment on table public.whatsapp_outbound_idempotency_keys is
  'Outbound send idempotency claim/state machine. Primary key is the Idempotency-Key. Backend-only.';
comment on column public.whatsapp_conversations.has_failed_message is
  'Denormalized failure badge for list filters/delta poll. Maintained by PR 2 write paths.';
comment on column public.whatsapp_conversations.lock_version is
  'Optimistic concurrency token for assignment/status mutations.';

-- -----------------------------------------------------------------------------
-- 10. Activity list RPC (Revision 3 keyset — SQL-only ordering/pagination)
-- Uses whatsapp_conversations_activity_idx:
--   (company_id, coalesce(last_message_at, created_at) desc, id)
-- PostgREST cannot ORDER BY coalesce(); the backend calls this RPC instead.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_inbox_list_conversations_by_activity(
  p_company_id text,
  p_limit integer,
  p_cursor_at timestamptz default null,
  p_cursor_id text default null,
  p_status text default null,
  p_assigned_to text default null,
  p_channel_id text default null,
  p_has_failed_message boolean default null
)
returns setof public.whatsapp_conversations
language sql
stable
as $$
  select c.*
  from public.whatsapp_conversations as c
  where c.company_id = p_company_id
    and (p_status is null or c.status = p_status)
    and (p_channel_id is null or c.channel_id = p_channel_id)
    and (
      p_has_failed_message is null
      or c.has_failed_message = p_has_failed_message
    )
    and (
      p_assigned_to is null
      or (
        p_assigned_to = 'unassigned'
        and c.assigned_user_id is null
      )
      or (
        p_assigned_to is distinct from 'unassigned'
        and c.assigned_user_id = p_assigned_to
      )
    )
    and (
      p_cursor_at is null
      or coalesce(c.last_message_at, c.created_at) < p_cursor_at
      or (
        coalesce(c.last_message_at, c.created_at) = p_cursor_at
        and p_cursor_id is not null
        and c.id < p_cursor_id
      )
    )
  order by
    coalesce(c.last_message_at, c.created_at) desc,
    c.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 101));
$$;

revoke all on function public.whatsapp_inbox_list_conversations_by_activity(
  text, integer, timestamptz, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.whatsapp_inbox_list_conversations_by_activity(
  text, integer, timestamptz, text, text, text, text, boolean
) to service_role;

comment on function public.whatsapp_inbox_list_conversations_by_activity is
  'PR2 inbox activity keyset page. Ordered by coalesce(last_message_at, created_at) desc, id desc. Backend/service_role only.';

-- -----------------------------------------------------------------------------
-- 11. Delta list RPC (Revision 3 — monotonic ASC keyset on updated_at, id)
-- Uses whatsapp_conversations_delta_idx (company_id, updated_at asc, id).
-- Forward traversal: (updated_at, id) > since cursor. No DESC page loops.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_inbox_list_conversations_delta(
  p_company_id text,
  p_limit integer,
  p_since_at timestamptz,
  p_since_id text,
  p_status text default null,
  p_assigned_to text default null,
  p_channel_id text default null,
  p_has_failed_message boolean default null
)
returns setof public.whatsapp_conversations
language sql
stable
as $$
  select c.*
  from public.whatsapp_conversations as c
  where c.company_id = p_company_id
    and (p_status is null or c.status = p_status)
    and (p_channel_id is null or c.channel_id = p_channel_id)
    and (
      p_has_failed_message is null
      or c.has_failed_message = p_has_failed_message
    )
    and (
      p_assigned_to is null
      or (
        p_assigned_to = 'unassigned'
        and c.assigned_user_id is null
      )
      or (
        p_assigned_to is distinct from 'unassigned'
        and c.assigned_user_id = p_assigned_to
      )
    )
    and (
      c.updated_at > p_since_at
      or (
        c.updated_at = p_since_at
        and c.id > coalesce(p_since_id, '')
      )
    )
  order by
    c.updated_at asc,
    c.id asc
  limit greatest(1, least(coalesce(p_limit, 50), 101));
$$;

revoke all on function public.whatsapp_inbox_list_conversations_delta(
  text, integer, timestamptz, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.whatsapp_inbox_list_conversations_delta(
  text, integer, timestamptz, text, text, text, text, boolean
) to service_role;

comment on function public.whatsapp_inbox_list_conversations_delta is
  'PR2 inbox delta keyset page. Ordered by updated_at asc, id asc after exclusive since cursor. Backend/service_role only.';

notify pgrst, 'reload schema';