/**
 * Static validation for scripts/whatsapp-web-sync-jobs-migration.sql (SYNC-9R).
 * Run: node scripts/validate-whatsapp-web-sync-jobs-migration.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "scripts/whatsapp-web-sync-jobs-migration.sql"),
  "utf8"
);

assert.match(
  sql,
  /create table if not exists public\.whatsapp_web_sync_jobs/i,
  "missing sync jobs table"
);
assert.match(
  sql,
  /alter table public\.whatsapp_web_sync_jobs\s+enable row level security/i,
  "missing RLS enable"
);
assert.match(
  sql,
  /revoke all on table public\.whatsapp_web_sync_jobs from public/i,
  "missing revoke from public"
);
assert.match(
  sql,
  /revoke all on table public\.whatsapp_web_sync_jobs from anon, authenticated/i,
  "missing revoke from anon/authenticated"
);
assert.match(
  sql,
  /add column if not exists cancelled/i,
  "missing cancelled column"
);
assert.match(
  sql,
  /add column if not exists durability_warning/i,
  "missing durability_warning column"
);
assert.match(
  sql,
  /whatsapp_web_sync_jobs_status_check/i,
  "missing status check constraint"
);
assert.match(
  sql,
  /whatsapp_web_sync_jobs_outcome_check/i,
  "missing outcome check constraint"
);

// service_role guard must revoke-all then grant only the four DML privileges.
assert.match(
  sql,
  /if exists \(select 1 from pg_roles where rolname = 'service_role'\) then[\s\S]*?revoke all on table public\.whatsapp_web_sync_jobs from service_role;[\s\S]*?grant select, insert, update, delete on table public\.whatsapp_web_sync_jobs to service_role;/i,
  "service_role block must revoke all then grant select/insert/update/delete only"
);

// Ensure we do not grant the extra privileges that leaked via defaults.
assert.doesNotMatch(
  sql,
  /grant[\s\S]*?\b(truncate|references|trigger)\b[\s\S]*?to service_role/i,
  "must not grant truncate/references/trigger to service_role"
);

// Compatibility: absent service_role is a notice skip, not a hard failure.
assert.match(
  sql,
  /service_role missing/i,
  "missing service_role-absent compatibility notice"
);

// Must not attempt to alter postgres-owner privileges.
assert.doesNotMatch(
  sql,
  /revoke\b[\s\S]*?\bfrom postgres\b/i,
  "must not revoke from postgres"
);
assert.doesNotMatch(
  sql,
  /grant\b[\s\S]*?\bto postgres\b/i,
  "must not grant to postgres"
);

console.log("whatsapp-web-sync-jobs-migration.sql static validation passed.");
