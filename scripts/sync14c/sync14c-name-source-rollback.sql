-- =============================================================================
-- SYNC-14C-A / R2 — rollback: restore pre-SYNC-14B name_source allow-list
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY. Do NOT auto-apply.
--
-- Restores exactly:
--   NULL | manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone
--
-- Safety (R2):
--   - Complete predicate proof via pg_constraint.conbin against an ephemeral
--     exact reference constraint (not regex/set-only matching).
--   - Temporary mismatches STOP fail-closed.
--   - If complete equality cannot be proven ⇒ rebuild (never false no-op).
--
-- LIMITATIONS:
-- 1. FAILS CLOSED if any row stores whatsapp_verified or whatsapp_legacy.
-- 2. Does NOT rewrite profile_name / name_source data.
-- 3. Roll back application writers before SQL rollback if they emit expanded values.
-- 4. Recommended abort order: stop deploy → roll back app → this SQL.
-- =============================================================================

do $$
declare
  table_oid oid;
  canonical_name constant text := 'whatsapp_contacts_name_source_check';
  temp_name constant text := 'whatsapp_contacts_name_source_check_rollback';
  forward_temp_name constant text := 'whatsapp_contacts_name_source_check_v14c';
  ref_name constant text := 'whatsapp_contacts_name_source_check_ref_rb';
  forward_ref_name constant text := 'whatsapp_contacts_name_source_check_ref_fwd';
  blocking_count bigint;
  canonical_oid oid;
  temp_oid oid;
  forward_temp_oid oid;
  canonical_validated boolean;
  temp_validated boolean;
  canonical_proven boolean := false;
  temp_proven boolean := false;
  forward_temp_proven boolean := false;
  action text;
  proof boolean;
  comment_text constant text :=
    'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — upgrade-only allow-list after SQL rollback. Application policy (SYNC-14B+): nonempty profile_name with null name_source is treated as whatsapp_legacy (not manual). phone is deprecated and must not be newly written as profile_name.';
begin
  if to_regclass('public.whatsapp_contacts') is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  select c.oid into table_oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'whatsapp_contacts' and c.relkind = 'r';

  if table_oid is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = table_oid
      and a.attname = 'name_source'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'STOP: whatsapp_contacts.name_source column missing';
  end if;

  select count(*) into blocking_count
  from public.whatsapp_contacts
  where name_source in ('whatsapp_verified', 'whatsapp_legacy');

  if blocking_count > 0 then
    raise exception
      'STOP: cannot rollback name_source check — % row(s) use whatsapp_verified/whatsapp_legacy. Roll back application writers first and clear/rewrite those values under a separate approved data plan (not provided here).',
      blocking_count;
  end if;

  -- Refuse unknown forward reference leftover (pack-owned ephemeral only may be dropped below)
  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = forward_ref_name
  ) then
    execute format(
      'alter table public.whatsapp_contacts drop constraint %I',
      forward_ref_name
    );
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = ref_name
  ) then
    execute format(
      'alter table public.whatsapp_contacts drop constraint %I',
      ref_name
    );
  end if;

  -- Install rollback reference predicate
  alter table public.whatsapp_contacts
    add constraint whatsapp_contacts_name_source_check_ref_rb
    check (
      name_source is null
      or name_source in (
        'manual',
        'whatsapp_saved',
        'whatsapp_push',
        'whatsapp_short',
        'phone'
      )
    ) not valid;

  select c.oid, c.convalidated, (c.conbin is not null and c.conbin = r.conbin)
  into canonical_oid, canonical_validated, canonical_proven
  from pg_constraint r
  left join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = canonical_name
   and c.contype = 'c'
  where r.conrelid = table_oid
    and r.conname = ref_name;

  canonical_proven := coalesce(canonical_proven, false);

  select c.oid, c.convalidated, (c.conbin is not null and c.conbin = r.conbin)
  into temp_oid, temp_validated, temp_proven
  from pg_constraint r
  left join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = temp_name
   and c.contype = 'c'
  where r.conrelid = table_oid
    and r.conname = ref_name;

  temp_proven := coalesce(temp_proven, false);

  alter table public.whatsapp_contacts
    drop constraint whatsapp_contacts_name_source_check_ref_rb;

  if temp_oid is not null and not temp_proven then
    raise exception
      'STOP: temporary constraint % exists but conbin does not equal the exact pre-expansion reference predicate (fail-closed)',
      temp_name;
  end if;

  -- Forward temp may be dropped only when its conbin equals the *forward* reference
  select c.oid into forward_temp_oid
  from pg_constraint c
  where c.conrelid = table_oid
    and c.conname = forward_temp_name
    and c.contype = 'c';

  if forward_temp_oid is not null then
    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check_ref_fwd
      check (
        name_source is null
        or name_source in (
          'manual',
          'whatsapp_verified',
          'whatsapp_saved',
          'whatsapp_legacy',
          'whatsapp_push',
          'whatsapp_short',
          'phone'
        )
      ) not valid;

    select (c.conbin = r.conbin)
    into forward_temp_proven
    from pg_constraint r
    join pg_constraint c
      on c.conrelid = r.conrelid
     and c.conname = forward_temp_name
     and c.contype = 'c'
    where r.conrelid = table_oid
      and r.conname = forward_ref_name;

    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_ref_fwd;

    if not coalesce(forward_temp_proven, false) then
      raise exception
        'STOP: temporary constraint % exists with unknown/mismatched conbin (fail-closed; will not drop/promote)',
        forward_temp_name;
    end if;
  end if;

  if coalesce(canonical_proven, false)
     and coalesce(canonical_validated, false)
     and temp_oid is null then
    action := 'NOOP';
  elsif coalesce(canonical_proven, false)
        and coalesce(canonical_validated, false)
        and temp_proven then
    action := 'CLEANUP_TEMP';
  elsif coalesce(canonical_proven, false)
        and not coalesce(canonical_validated, false)
        and temp_oid is null then
    action := 'VALIDATE_CANONICAL';
  elsif temp_proven then
    action := 'PROMOTE_TEMP';
  else
    action := 'REBUILD';
  end if;

  raise notice
    'SYNC-14C-A rollback: action=% canonical_proven=% canonical_validated=% temp_proven=%',
    action,
    canonical_proven,
    coalesce(canonical_validated, false),
    temp_proven;

  if action = 'NOOP' then
    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;
    comment on column public.whatsapp_contacts.name_source is comment_text;
    raise notice 'PASS: SYNC-14C-A rollback — conbin-proven validated pre-expansion allow-list (idempotent no-op)';
    return;
  end if;

  if action = 'CLEANUP_TEMP' then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_rollback;
    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;
    comment on column public.whatsapp_contacts.name_source is comment_text;
    raise notice 'PASS: SYNC-14C-A rollback — canonical proven; dropped leftover proven temporary';
    return;
  end if;

  if action = 'VALIDATE_CANONICAL' then
    alter table public.whatsapp_contacts
      validate constraint whatsapp_contacts_name_source_check;

    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check_ref_rb
      check (
        name_source is null
        or name_source in (
          'manual',
          'whatsapp_saved',
          'whatsapp_push',
          'whatsapp_short',
          'phone'
        )
      ) not valid;

    select (c.conbin = r.conbin), c.convalidated
    into proof, canonical_validated
    from pg_constraint r
    join pg_constraint c
      on c.conrelid = r.conrelid
     and c.conname = canonical_name
     and c.contype = 'c'
    where r.conrelid = table_oid
      and r.conname = ref_name;

    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_ref_rb;

    if not coalesce(proof, false) or not coalesce(canonical_validated, false) then
      raise exception 'STOP: canonical rollback constraint failed conbin proof and/or validation';
    end if;

    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;

    comment on column public.whatsapp_contacts.name_source is comment_text;
    raise notice 'PASS: SYNC-14C-A rollback — validated conbin-proven pre-expansion canonical';
    return;
  end if;

  if action = 'REBUILD' then
    if temp_oid is not null then
      raise exception 'STOP: unexpected temporary rollback constraint state during rebuild';
    end if;

    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check_rollback
      check (
        name_source is null
        or name_source in (
          'manual',
          'whatsapp_saved',
          'whatsapp_push',
          'whatsapp_short',
          'phone'
        )
      ) not valid;
    raise notice 'SYNC-14C-A rollback: added % NOT VALID', temp_name;
  end if;

  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_rollback;

  alter table public.whatsapp_contacts
    add constraint whatsapp_contacts_name_source_check_ref_rb
    check (
      name_source is null
      or name_source in (
        'manual',
        'whatsapp_saved',
        'whatsapp_push',
        'whatsapp_short',
        'phone'
      )
    ) not valid;

  select (c.conbin = r.conbin), c.convalidated
  into proof, temp_validated
  from pg_constraint r
  join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = temp_name
   and c.contype = 'c'
  where r.conrelid = table_oid
    and r.conname = ref_name;

  alter table public.whatsapp_contacts
    drop constraint whatsapp_contacts_name_source_check_ref_rb;

  if not coalesce(proof, false) or not coalesce(temp_validated, false) then
    raise exception
      'STOP: temporary rollback constraint failed conbin proof + validated check before promotion';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = canonical_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  end if;

  if forward_temp_oid is not null then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_v14c;
  end if;

  alter table public.whatsapp_contacts
    rename constraint whatsapp_contacts_name_source_check_rollback
    to whatsapp_contacts_name_source_check;

  alter table public.whatsapp_contacts
    add constraint whatsapp_contacts_name_source_check_ref_rb
    check (
      name_source is null
      or name_source in (
        'manual',
        'whatsapp_saved',
        'whatsapp_push',
        'whatsapp_short',
        'phone'
      )
    ) not valid;

  select (c.conbin = r.conbin), c.convalidated
  into proof, canonical_validated
  from pg_constraint r
  join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = canonical_name
   and c.contype = 'c'
  where r.conrelid = table_oid
    and r.conname = ref_name;

  alter table public.whatsapp_contacts
    drop constraint whatsapp_contacts_name_source_check_ref_rb;

  if not coalesce(proof, false) or not coalesce(canonical_validated, false) then
    raise exception
      'STOP: rollback did not leave conbin-proven validated pre-expansion canonical constraint';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname in (temp_name, forward_temp_name, ref_name, forward_ref_name)
  ) then
    raise exception 'STOP: temporary/reference name_source constraint(s) still present after rollback';
  end if;

  comment on column public.whatsapp_contacts.name_source is comment_text;

  raise notice 'PASS: SYNC-14C-A rollback — restored conbin-proven pre-expansion name_source check';
end $$;
