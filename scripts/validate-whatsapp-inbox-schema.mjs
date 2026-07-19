/**
 * Static validation for scripts/whatsapp-inbox-schema.sql (PR 2 Revision 3).
 * Run: node scripts/validate-whatsapp-inbox-schema.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "scripts/whatsapp-inbox-schema.sql"),
  "utf8"
);

const requiredTables = [
  "whatsapp_conversation_assignment_events",
  "whatsapp_conversation_status_events",
  "whatsapp_read_watermarks",
  "whatsapp_conversation_crm_links",
  "whatsapp_outbound_idempotency_keys",
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`create table if not exists public\\.${table}`, "i"),
    `missing table ${table}`
  );
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `missing RLS for ${table}`
  );
  assert.match(
    sql,
    new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"),
    `missing revoke for ${table}`
  );
  assert.match(
    sql,
    new RegExp(
      `create table if not exists public\\.${table}[\\s\\S]*?company_id text not null`,
      "i"
    ),
    `missing company_id on ${table}`
  );
}

const requiredColumns = [
  "assigned_user_id",
  "assigned_at",
  "assigned_by",
  "lock_version",
  "has_failed_message",
];
for (const col of requiredColumns) {
  assert.match(
    sql,
    new RegExp(`add column if not exists ${col}`, "i"),
    `missing conversation column ${col}`
  );
}

assert.match(
  sql,
  /check \(status in \('open', 'pending', 'resolved', 'archived'\)\)/i
);
assert.match(
  sql,
  /check \(state in \('processing', 'completed', 'failed_known', 'outcome_unknown'\)\)/i
);
assert.match(
  sql,
  /last_read_inbound_message_id/i
);
assert.match(
  sql,
  /last_read_inbound_message_created_at/i
);

const requiredIndexes = [
  "whatsapp_conversations_activity_idx",
  "whatsapp_conversations_delta_idx",
  "whatsapp_conversations_assigned_idx",
  "whatsapp_conversations_failed_idx",
  "whatsapp_messages_conversation_inbound_idx",
  "whatsapp_messages_inbound_created_idx",
  "whatsapp_idempotency_conversation_idx",
  "whatsapp_assignment_events_conv_idx",
  "whatsapp_read_watermarks_user_idx",
];
for (const idx of requiredIndexes) {
  assert.match(
    sql,
    new RegExp(`create index if not exists ${idx}`, "i"),
    `missing index ${idx}`
  );
}

assert.match(sql, /coalesce\(last_message_at, created_at\)/i);
assert.match(sql, /where has_failed_message = true/i);

// Forward-only: no destructive PR1 drops / no rollback companion expectations.
assert.equal(/drop table/i.test(sql), false, "must not drop tables");
assert.equal(
  /drop column/i.test(sql),
  false,
  "must not drop columns"
);
assert.equal(
  /create policy[\s\S]*using\s*\(\s*true\s*\)/i.test(sql),
  false,
  "must not create using(true) policies"
);
assert.equal(
  /status_changed_at/i.test(sql),
  false,
  "status_changed_at was withdrawn in Revision 3"
);

console.log("whatsapp-inbox-schema.sql static validation passed.");
