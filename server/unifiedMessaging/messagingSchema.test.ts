/**
 * Normalized messaging schema / persistence-contract tests (Task 3).
 * Run: npm run test:unified-messaging-schema
 *
 * Static verification only — does not require a live Supabase database.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SQL_ALIGNED_ENUMS } from "./messagingSchemaTypes.ts";
import type { MessagingRepository } from "./messagingRepository.ts";

let failed = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../..");
const SQL_PATH = path.join(
  REPO_ROOT,
  "scripts/unified-messaging-normalized-schema.sql"
);
const VALIDATOR_PATH = path.join(
  REPO_ROOT,
  "scripts/validate-unified-messaging-schema.mjs"
);

function readSql(): string {
  return fs.readFileSync(SQL_PATH, "utf8");
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    specs.push(match[1] ?? match[2] ?? "");
  }
  return specs;
}

const REQUIRED_TABLES = [
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

const EXISTING_WHATSAPP_TABLES = [
  "whatsapp_channels",
  "whatsapp_contacts",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_message_status_events",
  "whatsapp_webhook_events",
  "whatsapp_audit_events",
  "whatsapp_connections",
  "whatsapp_conversation_crm_links",
];

await test("schema: static SQL validator passes", () => {
  const result = spawnSync(process.execPath, [VALIDATOR_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "validator failed"
  );
});

await test("schema: all required tables exist in migration SQL", () => {
  const sql = readSql();
  for (const table of REQUIRED_TABLES) {
    assert.match(
      sql,
      new RegExp(`create table if not exists public\\.${table}`, "i")
    );
  }
});

await test(
  "schema: existing WhatsApp-specific tables remain present and untouched",
  () => {
    const sql = readSql();
    assert.doesNotMatch(sql, /drop\s+table\s+.*whatsapp_/i);
    assert.doesNotMatch(sql, /alter\s+table\s+public\.whatsapp_/i);
    assert.doesNotMatch(sql, /rename\s+.*whatsapp_/i);

    for (const table of EXISTING_WHATSAPP_TABLES) {
      assert.doesNotMatch(
        sql,
        new RegExp(`create table if not exists public\\.${table}`, "i")
      );
    }

    // Existing WhatsApp schema files still define the official tables.
    const transportSql = fs.readFileSync(
      path.join(REPO_ROOT, "scripts/whatsapp-transport-schema.sql"),
      "utf8"
    );
    for (const table of [
      "whatsapp_channels",
      "whatsapp_contacts",
      "whatsapp_conversations",
      "whatsapp_messages",
    ]) {
      assert.match(
        transportSql,
        new RegExp(`create table if not exists public\\.${table}`, "i")
      );
    }
  }
);

await test("schema: required organization_id columns exist", () => {
  const sql = readSql();
  for (const table of REQUIRED_TABLES) {
    assert.match(
      sql,
      new RegExp(
        `create table if not exists public\\.${table}[\\s\\S]*?organization_id text not null`,
        "i"
      )
    );
  }
});

await test(
  "schema: cross-tenant / anonymous access is not permitted by policies (static)",
  () => {
    const sql = readSql().replace(/--.*$/gm, "");
    // Service-role-only lockdown: RLS on, no policies, revoke anon/authenticated.
    assert.doesNotMatch(sql, /create\s+policy\s+/i);
    assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
    assert.doesNotMatch(
      sql,
      /grant\s+(select|insert|update|delete|all)\b[\s\S]{0,80}\bto\s+(anon|authenticated)/i
    );
    for (const table of REQUIRED_TABLES) {
      assert.match(
        sql,
        new RegExp(
          `revoke all on table public\\.${table} from anon, authenticated`,
          "i"
        )
      );
      assert.match(
        sql,
        new RegExp(
          `alter table public\\.${table} enable row level security`,
          "i"
        )
      );
    }
  }
);

await test(
  "schema: audit rows cannot be updated/deleted by normal application roles (static)",
  () => {
    const sql = readSql();
    assert.match(
      sql,
      /revoke all on table public\.messaging_audit_logs from anon, authenticated/i
    );
    assert.doesNotMatch(
      sql,
      /grant\s+(update|delete|all)\b[\s\S]{0,60}messaging_audit_logs/i
    );
    assert.match(sql, /Immutable audit trail/i);
  }
);

await test(
  "schema: browser roles cannot insert directly into the outbox (static)",
  () => {
    const sql = readSql();
    assert.match(
      sql,
      /revoke all on table public\.messaging_outbox from anon, authenticated/i
    );
    assert.doesNotMatch(
      sql,
      /grant\s+(insert|all)\b[\s\S]{0,60}messaging_outbox/i
    );
    assert.match(sql, /Not browser-writable/i);
  }
);

await test("schema: inbound external-message idempotency is enforced", () => {
  const sql = readSql();
  assert.match(sql, /messaging_messages_inbound_external_uidx/i);
  assert.match(
    sql,
    /organization_id,\s*connection_id,\s*transport_type,\s*external_message_id/i
  );
  assert.match(sql, /where external_message_id is not null/i);
});

await test("schema: outbound client-idempotency is enforced", () => {
  const sql = readSql();
  assert.match(sql, /messaging_messages_outbound_idempotency_uidx/i);
  assert.match(
    sql,
    /organization_id,\s*connection_id,\s*client_idempotency_key/i
  );
  assert.match(sql, /where client_idempotency_key is not null/i);
});

await test("schema: duplicate stable status events are prevented", () => {
  const sql = readSql();
  assert.match(sql, /messaging_status_events_external_uidx/i);
  assert.match(
    sql,
    /organization_id,\s*message_id,\s*external_status_id/i
  );
  assert.match(sql, /where external_status_id is not null/i);
});

await test(
  "schema: messages survive connection disablement/disconnection",
  () => {
    const sql = readSql();
    assert.doesNotMatch(sql, /references\s+public\.whatsapp_connections/i);
    assert.match(sql, /on delete restrict/i);
    assert.match(
      sql,
      /must not cascade-erase normalized conversation\/message history/i
    );
    // conversations/messages keep connection_id as opaque text, not cascading FK.
    assert.match(
      sql,
      /create table if not exists public\.messaging_conversations[\s\S]*?connection_id text not null/i
    );
    assert.match(
      sql,
      /create table if not exists public\.messaging_messages[\s\S]*?connection_id text not null/i
    );
  }
);

await test(
  "schema: attachment records contain private object keys rather than permanent public URLs",
  () => {
    const sql = readSql();
    assert.match(sql, /object_key text not null/i);
    assert.match(sql, /messaging_attachments_object_key_private/i);
    assert.match(sql, /object_key !~\* '\^https\?:\/\//i);
    assert.doesNotMatch(sql, /public_url/i);
    assert.doesNotMatch(sql, /permanent_url/i);
  }
);

await test(
  "schema: SQL transport/message/origin values match Task 2 TypeScript contract",
  () => {
    const sql = readSql();
    for (const value of SQL_ALIGNED_ENUMS.transports) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.messageTypes) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.origins) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.directions) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.processingStatuses) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.deliveryStatuses) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.automationModes) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    for (const value of SQL_ALIGNED_ENUMS.outboxStatuses) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
  }
);

await test(
  "schema: persistence interface imports no CRM, AI or provider implementation",
  () => {
    const repoSrc = fs.readFileSync(
      path.join(MODULE_ROOT, "messagingRepository.ts"),
      "utf8"
    );
    const schemaTypesSrc = fs.readFileSync(
      path.join(MODULE_ROOT, "messagingSchemaTypes.ts"),
      "utf8"
    );

    for (const source of [repoSrc, schemaTypesSrc]) {
      for (const spec of extractImportSpecifiers(source)) {
        assert.ok(
          spec.startsWith("./"),
          `unexpected import specifier "${spec}"`
        );
        assert.equal(spec.includes("whatsappTransport"), false);
        assert.equal(spec.includes("whatsappCrm"), false);
        assert.equal(spec.includes("aiEngine"), false);
        assert.equal(spec.includes("ai/providers"), false);
        assert.equal(spec.includes("baileys"), false);
        assert.equal(spec.includes("whatsapp-web"), false);
      }
    }

    // Interface surface exists (compile-time shape).
    type RequiredOps = keyof MessagingRepository;
    const ops: RequiredOps[] = [
      "upsertContactIdentity",
      "findOrCreateConversation",
      "persistInboundMessage",
      "createOutboundMessage",
      "appendStatusEvent",
      "addAttachmentReference",
      "recordAssignment",
      "enqueueOutboxEvent",
      "appendAuditEvent",
    ];
    assert.equal(ops.length, 9);
    assert.match(repoSrc, /export type MessagingRepository/);
    assert.match(repoSrc, /IdempotentOutcome/);
  }
);

await test(
  "schema: outbox claim index and assignment history semantics are present",
  () => {
    const sql = readSql();
    assert.match(sql, /messaging_outbox_claim_idx/i);
    assert.match(sql, /where status = 'pending'/i);
    assert.match(sql, /messaging_conversation_assignments/i);
    assert.match(sql, /ended_at timestamptz/i);
    assert.match(sql, /Append-only assignment history/i);
  }
);

if (failed > 0) {
  console.error(`\n${failed} unified-messaging schema test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging schema tests passed (static verification).");
console.log(
  "NOTE: Live RLS/database execution was not performed; validation is SQL-static only."
);
