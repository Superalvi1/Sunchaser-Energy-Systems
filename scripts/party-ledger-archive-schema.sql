-- Party Ledger archive — soft-hide parties from active ledger (invoices/payments unchanged)
-- Run in Supabase SQL Editor before using Archive Party in Accounts Receivable

create table if not exists public.party_ledger_archives (
  party_key text primary key,
  customer_id text,
  party_name text,
  party_phone text,
  archived_at timestamptz not null default timezone('utc'::text, now()),
  archived_by text not null
);

create index if not exists party_ledger_archives_archived_at_idx
  on public.party_ledger_archives(archived_at desc);

notify pgrst, 'reload schema';
