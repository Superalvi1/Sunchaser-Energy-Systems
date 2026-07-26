/**
 * Static validation for scripts/whatsapp-web-lid-phone-mapping-sync14c-migration.sql
 * (SYNC-14C-B / R1). Run: node scripts/validate-whatsapp-web-lid-phone-mapping-migration.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "scripts/whatsapp-web-lid-phone-mapping-sync14c-migration.sql"),
  "utf8"
);

assert.match(
  sql,
  /REVIEW\s*\/\s*MANUAL APPLY ONLY/i,
  "must be review/manual apply only"
);
assert.match(
  sql,
  /Do NOT auto-apply/i,
  "must forbid auto-apply"
);
assert.match(
  sql,
  /Do NOT backfill production/i,
  "must forbid production backfill"
);
assert.match(
  sql,
  /create table if not exists public\.whatsapp_lid_phone_mappings/i,
  "missing mapping table"
);
assert.match(
  sql,
  /channel_phone_number_id text not null/i,
  "missing channel scope column"
);
assert.match(
  sql,
  /session_key text not null/i,
  "missing session scope column"
);
assert.match(
  sql,
  /lid_normalized text not null/i,
  "missing lid_normalized"
);
assert.match(
  sql,
  /phone_e164 text not null/i,
  "missing phone_e164"
);
assert.match(
  sql,
  /whatsapp_lid_phone_mappings_scope_lid_live_uidx/i,
  "missing live unique index"
);
assert.match(
  sql,
  /status in \('active', 'stale', 'superseded'\)/i,
  "missing status check"
);
assert.match(
  sql,
  /alter table public\.whatsapp_lid_phone_mappings\s+enable row level security/i,
  "missing RLS enable"
);
assert.match(
  sql,
  /revoke all on table public\.whatsapp_lid_phone_mappings from public/i,
  "missing revoke from public"
);
assert.match(
  sql,
  /revoke all on table public\.whatsapp_lid_phone_mappings from anon, authenticated/i,
  "missing revoke from anon/authenticated"
);
assert.match(
  sql,
  /if exists \(select 1 from pg_roles where rolname = 'service_role'\) then[\s\S]*?revoke all on table public\.whatsapp_lid_phone_mappings from service_role;[\s\S]*?grant select, insert, update, delete on table public\.whatsapp_lid_phone_mappings to service_role;/i,
  "service_role block must revoke all then grant select/insert/update/delete only"
);
assert.doesNotMatch(
  sql,
  /grant[\s\S]*?\b(truncate|references|trigger)\b[\s\S]*?to service_role/i,
  "must not grant truncate/references/trigger to service_role"
);
assert.match(
  sql,
  /Never expose LID\/JID/i,
  "must document DTO/UI privacy"
);
{
  // No top-level seed/backfill INSERT (RPC body may insert inside the function).
  const withoutFunctions = sql.replace(
    /create or replace function[\s\S]*?\$\$;/gi,
    ""
  );
  assert.doesNotMatch(
    withoutFunctions,
    /insert into public\.whatsapp_lid_phone_mappings/i,
    "migration must not backfill rows outside RPC"
  );
}

// SYNC-14C-B-R1 atomic RPC requirements
assert.match(
  sql,
  /create or replace function public\.whatsapp_upsert_verified_lid_phone_mapping/i,
  "missing atomic upsert RPC"
);
assert.match(
  sql,
  /set search_path\s*=\s*public/i,
  "RPC must fix search_path = public"
);
assert.match(
  sql,
  /security definer/i,
  "RPC must be security definer"
);
assert.match(
  sql,
  /for update/i,
  "RPC must lock live row FOR UPDATE"
);
assert.match(
  sql,
  /pg_advisory_xact_lock/i,
  "RPC must serialize scoped LID decisions"
);
assert.match(
  sql,
  /conflict_count\s*=\s*m\.conflict_count\s*\+\s*1/i,
  "RPC must atomically increment conflict_count"
);
assert.match(
  sql,
  /revoke all on function public\.whatsapp_upsert_verified_lid_phone_mapping[\s\S]*?from public/i,
  "RPC must revoke from public"
);
assert.match(
  sql,
  /revoke all on function public\.whatsapp_upsert_verified_lid_phone_mapping[\s\S]*?from anon, authenticated/i,
  "RPC must revoke from anon/authenticated"
);
assert.match(
  sql,
  /grant execute on function public\.whatsapp_upsert_verified_lid_phone_mapping[\s\S]*?to service_role/i,
  "RPC execute must be service_role-only"
);
assert.match(
  sql,
  /whatsapp_lid_phone_mappings_phone_digits_check/i,
  "must enforce digits-only phone check constraint"
);
assert.match(
  sql,
  /v_phone is null or v_phone !~/i,
  "RPC must reject non-digits phone input"
);
assert.match(
  sql,
  /failed remap preserves stale|stale mapping stays/i,
  "must document failed-remap preserves stale"
);

console.log("PASS: whatsapp-web-lid-phone-mapping-sync14c-migration.sql");
