/**
 * Static validation for scripts/unified-messaging-normalized-schema.sql (Task 3).
 * Run: node scripts/validate-unified-messaging-schema.mjs
 *
 * Does not require a live Supabase database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sqlPath = join(
  process.cwd(),
  "scripts/unified-messaging-normalized-schema.sql"
);
const sqlRaw = readFileSync(sqlPath, "utf8");
/** Strip line comments so documentary text cannot false-positive policy checks. */
const sql = sqlRaw.replace(/--.*$/gm, "");

const requiredTables = [
  "messaging_contacts",
  "messaging_contact_identities",
  "messaging_conversations",
  "messaging_messages",
  "messaging_attachments",
  "messaging_status_events",
  "messaging_conversation_assignments",
  "messaging_outbox",
  "messaging_audit_logs",
];

const existingWhatsAppTables = [
  "whatsapp_channels",
  "whatsapp_contacts",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_message_status_events",
  "whatsapp_webhook_events",
  "whatsapp_audit_events",
  "whatsapp_connections",
  "whatsapp_conversation_crm_links",
  "whatsapp_outbound_idempotency_keys",
];

console.log("Validating unified messaging normalized schema (static)...");

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`create table if not exists public\\.${table}`, "i"),
    `missing table ${table}`
  );
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `missing RLS enable for ${table}`
  );
  assert.match(
    sql,
    new RegExp(
      `revoke all on table public\\.${table} from anon, authenticated`,
      "i"
    ),
    `missing revoke anon/authenticated for ${table}`
  );
  assert.match(
    sql,
    new RegExp(
      `create table if not exists public\\.${table}[\\s\\S]*?organization_id text not null`,
      "i"
    ),
    `missing organization_id on ${table}`
  );
}

// No permissive policies / anonymous grants
assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
assert.doesNotMatch(sql, /with\s+check\s*\(\s*true\s*\)/i);
assert.doesNotMatch(
  sql,
  /grant\s+(select|insert|update|delete|all)\b[\s\S]{0,80}\bto\s+(anon|authenticated)/i
);
assert.doesNotMatch(sql, /create\s+policy\s+/i);

// Must not mutate existing WhatsApp tables
assert.doesNotMatch(sql, /drop\s+table\s+.*whatsapp_/i);
assert.doesNotMatch(sql, /alter\s+table\s+public\.whatsapp_/i);
assert.doesNotMatch(sql, /drop\s+index\s+.*whatsapp_/i);
assert.doesNotMatch(sql, /rename\s+.*whatsapp_/i);

// Existing WhatsApp table names must not be redefined here
for (const table of existingWhatsAppTables) {
  assert.doesNotMatch(
    sql,
    new RegExp(`create table if not exists public\\.${table}`, "i"),
    `must not redefine WhatsApp table ${table}`
  );
}

// Transport / message / origin alignment with Task 2
for (const transport of [
  "meta_whatsapp_cloud",
  "whatsapp_web_qr",
  "website_chat",
  "instagram",
  "messenger",
]) {
  assert.match(sql, new RegExp(`'${transport}'`));
}

for (const messageType of [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "interactive",
  "template",
  "location",
  "reaction",
  "system",
]) {
  assert.match(sql, new RegExp(`'${messageType}'`));
}

for (const origin of [
  "customer",
  "human",
  "ai",
  "bot_flow",
  "system",
  "broadcast",
]) {
  assert.match(sql, new RegExp(`'${origin}'`));
}

assert.match(sql, /check \(direction in \('inbound', 'outbound'\)\)/i);
assert.match(
  sql,
  /check \(automation_mode in \(\s*'bot_active',\s*'ai_active',\s*'human_handling',\s*'paused',\s*'disabled'\s*\)\)/i
);
assert.match(
  sql,
  /check \(status in \('open', 'pending', 'resolved', 'archived'\)\)/i
);

// Idempotency indexes
assert.match(sql, /messaging_messages_inbound_external_uidx/i);
assert.match(sql, /where external_message_id is not null/i);
assert.match(sql, /messaging_messages_outbound_idempotency_uidx/i);
assert.match(sql, /where client_idempotency_key is not null/i);
assert.match(sql, /messaging_status_events_external_uidx/i);
assert.match(sql, /where external_status_id is not null/i);
assert.match(sql, /messaging_outbox_idempotency_uidx/i);
assert.match(sql, /messaging_outbox_claim_idx/i);

// Identity uniqueness
assert.match(sql, /messaging_contact_identities_provider_uidx/i);

// Attachment privacy: reject http(s) object keys
assert.match(sql, /messaging_attachments_object_key_private/i);
assert.match(sql, /object_key !~\* '\^https\?:\/\//i);

// Connection disablement must not FK-cascade from whatsapp_connections
assert.doesNotMatch(
  sql,
  /references\s+public\.whatsapp_connections/i
);
assert.match(
  sqlRaw,
  /Intentionally NO foreign key to whatsapp_connections/i
);

// Outbox statuses
for (const status of [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_lettered",
]) {
  assert.match(
    sql,
    new RegExp(`'${status}'`),
    `missing outbox status ${status}`
  );
}

// Status events support queued/sent/delivered/read/failed
assert.match(
  sql,
  /check \(status in \('queued', 'sent', 'delivered', 'read', 'failed'\)\)/i
);

// Composite org-scoped FKs present
assert.match(sql, /messaging_contact_identities_contact_fk/i);
assert.match(sql, /messaging_conversations_contact_fk/i);
assert.match(sql, /messaging_messages_conversation_fk/i);
assert.match(sql, /on delete restrict/i);

// No ENUM types
assert.doesNotMatch(sql, /create\s+type\s+.*as\s+enum/i);

// Manual-apply header (comments)
assert.match(sqlRaw, /manual apply only/i);
assert.match(sqlRaw, /Do NOT auto-apply/i);

console.log("PASS: unified messaging normalized schema static validation");
