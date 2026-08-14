# WS1 Public Catalogue — RLS / Direct-Read Audit (NON-EXECUTABLE)

Status: **review document only — no SQL changes applied.**

## Files inspected

- `scripts/marketplace-ws0-foundation-schema.sql` (lines 2432–2462)
- `scripts/marketplace-ws1-additive-schema.sql` (lines 52–69)
- All `scripts/*.sql` files for `create policy` and `grant ... on public.mp_products`

## Existing mp_products RLS state

### RLS enabled and forced

`marketplace-ws0-foundation-schema.sql` already executes, for **all** marketplace
including `mp_products`:

```sql
alter table public.mp_products enable row level security;
alter table public.mp_products force row level security;
```

`marketplace-ws1-additive-schema.sql` reaffirms this explicitly for
`mp_products`:

```sql
alter table public.mp_products enable row level security;
alter table public.mp_products force row level security;
```

### Privileges

WS0 foundation revokes all privileges from `public`, `anon`, and `authenticated`
on every marketplace table, and grants full `select, insert, update, delete` to
`service_role` only.

WS1 additive reaffirms:

```sql
revoke all on table public.mp_products from public;
revoke all on table public.mp_products from anon;
revoke all on table public.mp_products from authenticated;
grant select, insert, update, delete on table public.mp_products to service_role;
```

### Policies

No `create policy ... on public.mp_products` statement exists in any migration
file in this repository.

## Can direct table reads expose public_visible products?

No.

- `anon` and `authenticated` have **no privileges** on `mp_products`.
- With `force row level security` and **no policies** permitting access, direct
  `select` by `anon`/`authenticated` is denied.
- `service_role` can read the table, but it is intended for trusted backend
  operations and typically bypasses RLS.
- The `public_visible` column is therefore **not** exposed by direct table reads
  from public roles.

## Chosen design for this migration

`scripts/marketplace-ws1-public-rpc-contract.sql` deliberately **does not**
enable/force RLS and does not add new policies. RLS is already managed by the
foundation and additive schemas.

The `ws1_public` gate is enforced **inside the v2 RPC functions only**
(`mp_public_catalogue_list_v2`, `mp_public_catalogue_get_by_slug_v2`,
`mp_public_catalogue_categories_v2`, `mp_public_catalogue_brands_v2`).

If a future design requires row-level filtering for `service_role` or a new
application role, that must be a separately reviewed additive policy migration.
