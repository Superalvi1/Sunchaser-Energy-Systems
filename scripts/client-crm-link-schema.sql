-- Additive linking between auth users, CRM customers, and sales leads.
alter table public.users add column if not exists customer_id text;
alter table public.customers add column if not exists user_id text;
alter table public.customers add column if not exists customer_code text;
alter table public.leads add column if not exists customer_id text;
create index if not exists users_customer_id_idx on public.users(customer_id);
create index if not exists customers_user_id_idx on public.customers(user_id);
create index if not exists customers_email_lower_idx on public.customers((lower(email)));
create index if not exists leads_customer_id_idx on public.leads(customer_id);
create unique index if not exists customers_user_id_unique
  on public.customers(user_id)
  where user_id is not null;
