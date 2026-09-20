-- Backfill CRM customer + lead rows for Customer-role users missing from CRM Clients.
-- Additive and idempotent. Does not delete or overwrite payments, proposals, warranties,
-- invoices, or existing portal data.
-- Never attaches a customer already linked to another portal user.

-- 1. If a Customer user has no customer_id, attach an unlinked customer with the same email.
--    One customer is claimed by at most one Customer user.
with ranked as (
  select
    u.id as user_id,
    c.id as customer_id,
    row_number() over (
      partition by c.id
      order by u.created_at asc nulls last, u.id
    ) as rn
  from public.users u
  join public.customers c
    on lower(c.email) = lower(u.email)
  where u.role = 'Customer'
    and (u.customer_id is null or u.customer_id = '')
    and (c.user_id is null or c.user_id = u.id)
    and not exists (
      select 1
      from public.users o
      where o.id <> u.id
        and o.role = 'Customer'
        and o.customer_id = c.id
    )
)
update public.users u
set customer_id = ranked.customer_id
from ranked
where u.id = ranked.user_id
  and ranked.rn = 1;

-- 2. Create a customers row for remaining Customer users that still have none.
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
  )
  and (
    u.customer_id is null
    or u.customer_id = ''
    or not exists (
      select 1 from public.customers taken
      where taken.id = u.customer_id
        and taken.user_id is not null
        and taken.user_id <> u.id
    )
  );

-- 3. Point users.customer_id at the customer owned by this user.
update public.users u
set customer_id = c.id
from public.customers c
where u.role = 'Customer'
  and c.user_id = u.id
  and (u.customer_id is null or u.customer_id = '' or u.customer_id <> c.id);

-- 4. Point customers.user_id at the matching Customer user, never overwriting another owner.
update public.customers c
set user_id = u.id
from public.users u
where u.role = 'Customer'
  and u.customer_id = c.id
  and (c.user_id is null or c.user_id = u.id);

-- 5. Create a CRM lead so the user appears under Clients / Target Clients.
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
     or l.id = 'lead-' || replace(c.id, 'cust-', '')
);

select u.id as user_id, u.username, u.name, u.email, u.customer_id, c.user_id as customer_user_id, l.id as lead_id
from public.users u
left join public.customers c on c.id = u.customer_id
left join public.leads l on l.customer_id = c.id
where u.role = 'Customer'
order by u.created_at desc nulls last;
