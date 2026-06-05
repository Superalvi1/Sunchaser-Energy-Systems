-- Invoice PDF: Sunchaser bank accounts — show_on_invoice + verified seed (idempotent)
-- Run in Supabase SQL Editor after scripts/invoice-bank-accounts-update.sql

alter table public.bank_accounts
  add column if not exists show_on_invoice boolean not null default false;

alter table public.bank_accounts
  add column if not exists is_active boolean not null default true;

-- Hide non-Sunchaser accounts from invoice PDF unless explicitly enabled
update public.bank_accounts
  set show_on_invoice = false
  where account_title not ilike '%sunchaser%';

-- Verified Sunchaser accounts (invoice last page)
insert into public.bank_accounts (
  id, bank_name, account_title, account_number, iban, branch_code,
  is_active, show_on_invoice, sort_order, created_at, updated_at
) values
  (
    'bank-sun-allied',
    'Allied Bank',
    'SUNCHASER ENERGY',
    '04190010112276940012',
    'PK81ABPA0010112276940012',
    '',
    true, true, 1, timezone('utc'::text, now()), timezone('utc'::text, now())
  ),
  (
    'bank-sun-askari',
    'Askari Bank',
    'SUNCHASER ENERGY',
    '03860200001296',
    'PK03ASCM0003860200001296',
    '',
    true, true, 2, timezone('utc'::text, now()), timezone('utc'::text, now())
  ),
  (
    'bank-sun-islamic',
    'Bank Islamic',
    'SUNCHASER ENERGY',
    '201139501310001',
    'N/A',
    '',
    true, true, 3, timezone('utc'::text, now()), timezone('utc'::text, now())
  )
on conflict (id) do update set
  bank_name = excluded.bank_name,
  account_title = excluded.account_title,
  account_number = excluded.account_number,
  iban = excluded.iban,
  is_active = true,
  show_on_invoice = true,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc'::text, now());

-- Legacy Allied row (bank-1) — align if present
update public.bank_accounts
  set show_on_invoice = true,
      is_active = true,
      account_title = 'SUNCHASER ENERGY',
      bank_name = 'Allied Bank',
      account_number = '04190010112276940012',
      iban = 'PK81ABPA0010112276940012',
      sort_order = 1,
      updated_at = timezone('utc'::text, now())
where id = 'bank-1'
   or (account_number = '04190010112276940012' and account_title ilike '%sunchaser%');

notify pgrst, 'reload schema';
