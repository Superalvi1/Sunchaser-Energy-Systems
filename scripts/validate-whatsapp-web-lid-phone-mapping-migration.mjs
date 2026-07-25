/**
 * Static validation for scripts/whatsapp-web-lid-phone-mapping-sync14c-migration.sql
 * (SYNC-14C-B). Run: node scripts/validate-whatsapp-web-lid-phone-mapping-migration.mjs
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
assert.doesNotMatch(
  sql,
  /insert into public\.whatsapp_lid_phone_mappings/i,
  "migration must not backfill rows"
);

console.log("PASS: whatsapp-web-lid-phone-mapping-sync14c-migration.sql");
