-- Invoice PDF: Sunchaser bank accounts — idempotent seed (production-safe)
-- Run in Supabase SQL Editor. Does not assume created_at / updated_at exist.
--
-- Baseline columns (quotation-settings-schema.sql):
--   id, bank_name, account_title, account_number, iban, branch_code,
--   is_active, sort_order
-- Optional (added below if missing):
--   show_on_invoice

-- -----------------------------------------------------------------------------
-- 1. Ensure optional columns exist (no-op if already present)
-- -----------------------------------------------------------------------------
alter table public.bank_accounts
  add column if not exists branch_code text default '';

alter table public.bank_accounts
  add column if not exists iban text default '';

alter table public.bank_accounts
  add column if not exists account_number text;

alter table public.bank_accounts
  add column if not exists account_title text;

alter table public.bank_accounts
  add column if not exists sort_order integer not null default 0;

alter table public.bank_accounts
  add column if not exists is_active boolean not null default true;

alter table public.bank_accounts
  add column if not exists show_on_invoice boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Hide non-Sunchaser / partner accounts from invoice PDF
-- -----------------------------------------------------------------------------
update public.bank_accounts
  set show_on_invoice = false
  where coalesce(account_title, '') not ilike '%sunchaser%';

update public.bank_accounts
  set show_on_invoice = false
  where account_title ilike '%helios%'
     or account_title ilike '%al adam%'
     or account_title ilike '%signals%';

-- -----------------------------------------------------------------------------
-- 3. Allied Bank — SUNCHASER ENERGY
-- -----------------------------------------------------------------------------
update public.bank_accounts
  set bank_name = 'Allied Bank',
      account_title = 'SUNCHASER ENERGY',
      account_number = '04190010112276940012',
      iban = 'PK81ABPA0010112276940012',
      branch_code = coalesce(branch_code, ''),
      is_active = true,
      show_on_invoice = true,
      sort_order = 1
  where id in ('bank-sun-allied', 'bank-1')
     or account_number = '04190010112276940012';

insert into public.bank_accounts (
  id, bank_name, account_title, account_number, iban, branch_code,
  is_active, show_on_invoice, sort_order
)
select
  'bank-sun-allied',
  'Allied Bank',
  'SUNCHASER ENERGY',
  '04190010112276940012',
  'PK81ABPA0010112276940012',
  '',
  true,
  true,
  1
where not exists (
  select 1 from public.bank_accounts
  where id = 'bank-sun-allied'
     or account_number = '04190010112276940012'
);

-- -----------------------------------------------------------------------------
-- 4. Askari Bank — SUNCHASER ENERGY
-- -----------------------------------------------------------------------------
update public.bank_accounts
  set bank_name = 'Askari Bank',
      account_title = 'SUNCHASER ENERGY',
      account_number = '03860200001296',
      iban = 'PK03ASCM0003860200001296',
      branch_code = coalesce(branch_code, ''),
      is_active = true,
      show_on_invoice = true,
      sort_order = 2
  where id = 'bank-sun-askari'
     or account_number = '03860200001296';

insert into public.bank_accounts (
  id, bank_name, account_title, account_number, iban, branch_code,
  is_active, show_on_invoice, sort_order
)
select
  'bank-sun-askari',
  'Askari Bank',
  'SUNCHASER ENERGY',
  '03860200001296',
  'PK03ASCM0003860200001296',
  '',
  true,
  true,
  2
where not exists (
  select 1 from public.bank_accounts
  where id = 'bank-sun-askari'
     or account_number = '03860200001296'
);

-- -----------------------------------------------------------------------------
-- 5. Bank Islamic — SUNCHASER ENERGY
-- -----------------------------------------------------------------------------
update public.bank_accounts
  set bank_name = 'Bank Islamic',
      account_title = 'SUNCHASER ENERGY',
      account_number = '201139501310001',
      iban = 'N/A',
      branch_code = coalesce(branch_code, ''),
      is_active = true,
      show_on_invoice = true,
      sort_order = 3
  where id = 'bank-sun-islamic'
     or account_number = '201139501310001';

insert into public.bank_accounts (
  id, bank_name, account_title, account_number, iban, branch_code,
  is_active, show_on_invoice, sort_order
)
select
  'bank-sun-islamic',
  'Bank Islamic',
  'SUNCHASER ENERGY',
  '201139501310001',
  'N/A',
  '',
  true,
  true,
  3
where not exists (
  select 1 from public.bank_accounts
  where id = 'bank-sun-islamic'
     or account_number = '201139501310001'
);

notify pgrst, 'reload schema';
