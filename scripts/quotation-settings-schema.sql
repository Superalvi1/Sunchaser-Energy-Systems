-- Quotation PDF settings module (additive, idempotent)
-- Tables referenced by dbManager.ts / server.ts for quotation template configuration,
-- PDF content (bank accounts, terms, CEO messages, structures), and admin persistence.
-- Run in Supabase SQL Editor after supabase-schema.sql.

-- -----------------------------------------------------------------------------
-- 1. Quote templates (parent)
-- -----------------------------------------------------------------------------
create table if not exists public.quote_templates (
  id text primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 2. Quote template pages (child of quote_templates)
-- -----------------------------------------------------------------------------
create table if not exists public.quote_template_pages (
  id text primary key,
  template_id text not null references public.quote_templates(id) on delete cascade,
  page_type text not null,
  title text,
  body_text text default '',
  image_url text default '',
  bg_image_url text default '',
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists quote_template_pages_template_id_idx
  on public.quote_template_pages(template_id);

create index if not exists quote_template_pages_sort_order_idx
  on public.quote_template_pages(template_id, sort_order);

-- -----------------------------------------------------------------------------
-- 3. Bank accounts (quotation PDF payment page)
-- -----------------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id text primary key,
  bank_name text not null,
  account_title text,
  account_number text,
  iban text default '',
  branch_code text default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists bank_accounts_sort_order_idx
  on public.bank_accounts(sort_order);

-- -----------------------------------------------------------------------------
-- 4. Company terms / legal clauses (quotation PDF terms pages)
-- -----------------------------------------------------------------------------
create table if not exists public.company_terms (
  id text primary key,
  term_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists company_terms_sort_order_idx
  on public.company_terms(sort_order);

-- -----------------------------------------------------------------------------
-- 5. CEO messages (quotation PDF executive assurances page)
-- -----------------------------------------------------------------------------
create table if not exists public.ceo_messages (
  id text primary key,
  name text not null,
  designation text,
  message text,
  signature_url text default '',
  photo_url text default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 6. Structure descriptions (quotation PDF mounting-structure pages)
-- -----------------------------------------------------------------------------
create table if not exists public.structure_descriptions (
  id text primary key,
  structure_type text not null,
  title text,
  description_en text,
  description_ur text,
  material_type text default '',
  weight text default '',
  wind_rating text default '',
  warranty text default '',
  image_url text default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists structure_descriptions_type_uidx
  on public.structure_descriptions(structure_type);

-- -----------------------------------------------------------------------------
-- 7. Quote PDF header/footer settings (admin Quotation Settings panel)
-- -----------------------------------------------------------------------------
create table if not exists public.quote_pdf_settings (
  id text primary key,
  company_name text,
  office_address text,
  hotline_phones text,
  billing_email text,
  website_url text,
  logo_url text default '',
  global_pdf_header jsonb,
  global_pdf_footer jsonb,
  use_default_company_content boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Additive columns for existing deployments
alter table if exists public.quote_pdf_settings
  add column if not exists global_pdf_header jsonb,
  add column if not exists global_pdf_footer jsonb,
  add column if not exists use_default_company_content boolean not null default false;

-- -----------------------------------------------------------------------------
-- 8. Social / portal links (QR page — synced but not yet consumed by PDF renderer)
-- -----------------------------------------------------------------------------
create table if not exists public.social_links (
  id text primary key,
  platform text not null,
  url text,
  qr_code_url text default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- RLS (match existing backend service-role pattern)
-- -----------------------------------------------------------------------------
alter table public.quote_templates enable row level security;
alter table public.quote_template_pages enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.company_terms enable row level security;
alter table public.ceo_messages enable row level security;
alter table public.structure_descriptions enable row level security;
alter table public.quote_pdf_settings enable row level security;
alter table public.social_links enable row level security;

drop policy if exists "Enable full access for authenticated backend" on public.quote_templates;
create policy "Enable full access for authenticated backend" on public.quote_templates for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.quote_template_pages;
create policy "Enable full access for authenticated backend" on public.quote_template_pages for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.bank_accounts;
create policy "Enable full access for authenticated backend" on public.bank_accounts for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.company_terms;
create policy "Enable full access for authenticated backend" on public.company_terms for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.ceo_messages;
create policy "Enable full access for authenticated backend" on public.ceo_messages for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.structure_descriptions;
create policy "Enable full access for authenticated backend" on public.structure_descriptions for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.quote_pdf_settings;
create policy "Enable full access for authenticated backend" on public.quote_pdf_settings for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.social_links;
create policy "Enable full access for authenticated backend" on public.social_links for all using (true);

notify pgrst, 'reload schema';
