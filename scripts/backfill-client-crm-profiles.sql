-- Backfill CRM customer + lead rows for Customer-role users missing from CRM Clients.
update public.users u
set customer_id = c.id
from public.customers c
where u.role = 'Customer'
  and (u.customer_id is null or u.customer_id = '')
  and lower(c.email) = lower(u.email)
  and (c.user_id is null or c.user_id = u.id);

insert into public.customers (id, name, email, phone, address, user_id)
select
  coalesce(nullif(u.customer_id, ''), 'cust-' || replace(u.id, 'u-', '')),
  coalesce(nullif(u.name, ''), u.username),
  coalesce(nullif(u.email, ''), u.username || '@clients.sunchaser.local'),
  null,
  null,
  u.id
from public.users u
where u.role = 'Customer'
  and not exists (
    select 1 from public.customers c
    where c.id = coalesce(nullif(u.customer_id, ''), 'cust-' || replace(u.id, 'u-', ''))
       or c.user_id = u.id
  );

update public.users u
set customer_id = c.id
from public.customers c
where u.role = 'Customer'
  and c.user_id = u.id
  and (u.customer_id is null or u.customer_id = '' or u.customer_id <> c.id);

update public.customers c
set user_id = u.id
from public.users u
where u.role = 'Customer'
  and u.customer_id = c.id
  and (c.user_id is null or c.user_id = u.id);

insert into public.leads (
  id, customer_id, name, email, phone, address, status,
  monthly_bill, monthly_units, sanctioned_load, roof_space, shading, rating,
  assigned_salesperson, notes, lead_source, engagement_level,
  conversion_probability, conversion_score
)
select
  'lead-' || replace(c.id, 'cust-', ''),
  c.id,
  c.name,
  c.email,
  coalesce(nullif(c.phone, ''), 'Pending'),
  coalesce(nullif(c.address, ''), 'Pending'),
  'New',
  0, 0, 0, 0, 'None', 3,
  '',
  'Created automatically from client portal registration.',
  'Client Registration',
  'Medium',
  50,
  50
from public.customers c
join public.users u on u.customer_id = c.id and u.role = 'Customer'
where not exists (
  select 1 from public.leads l
  where l.customer_id = c.id
);

select u.id as user_id, u.username, u.name, u.email, u.customer_id, c.user_id as customer_user_id, l.id as lead_id
from public.users u
left join public.customers c on c.id = u.customer_id
left join public.leads l on l.customer_id = c.id
where u.role = 'Customer'
order by u.created_at desc nulls last;
