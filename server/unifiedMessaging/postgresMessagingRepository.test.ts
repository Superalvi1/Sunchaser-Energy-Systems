/**
 * Live disposable-Postgres integration tests for PostgresMessagingRepository.
 *
 * Requires the messaging-test harness (started by scripts/run-unified-messaging-repository-tests.sh).
 * Connects only to 127.0.0.1:55432 / messaging_test — never hosted Supabase.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPostgresMessagingRepository } from "./postgresMessagingRepository.ts";
import {
  MessagingRepositoryError,
  isMessagingRepositoryError,
} from "./messagingRepositoryErrors.ts";
import {
  createPgPoolSqlExecutor,
  type SqlExecutor,
} from "./messagingSql.ts";

const HOST = process.env.MESSAGING_TEST_DB_HOST ?? "127.0.0.1";
const PORT = Number(process.env.MESSAGING_TEST_DB_PORT ?? "55432");
const DATABASE = process.env.MESSAGING_TEST_DB_NAME ?? "messaging_test";
const USER = process.env.MESSAGING_TEST_DB_USER ?? "messaging_test";
const PASSWORD =
  process.env.MESSAGING_TEST_DB_PASSWORD ?? "messaging_test_local_only";

if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  throw new Error(`Refusing non-local harness host: ${HOST}`);
}
if (PORT !== 55432 || DATABASE !== "messaging_test" || USER !== "messaging_test") {
  throw new Error("Refusing unexpected harness database coordinates");
}

let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

/** Fail the first INSERT into `tableNeedle` inside a transaction (after prior UPDATEs). */
function wrapFailingInsert(
  base: SqlExecutor,
  tableNeedle: string
): SqlExecutor {
  return {
    query: (text, params) => base.query(text, params),
    withTransaction: async (fn) =>
      base.withTransaction(async (tx) => {
        const failingTx: SqlExecutor = {
          query: async (text, params) => {
            if (/^\s*INSERT\b/i.test(text) && text.includes(tableNeedle)) {
              throw Object.assign(new Error("injected partial failure"), {
                code: "P0001",
              });
            }
            return tx.query(text, params);
          },
          withTransaction: (inner) => failingTx.withTransaction(inner),
        };
        return fn(failingTx);
      }),
  };
}

async function cleanupOrg(pool: pg.Pool, organizationId: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.messaging_status_events WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_attachments WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_conversation_assignments WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_outbox WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_messages WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_conversations WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_contact_identities WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_contacts WHERE organization_id = $1`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM public.messaging_audit_logs WHERE organization_id = $1`,
    [organizationId]
  );
}

const pool = new pg.Pool({
  host: HOST,
  port: PORT,
  database: DATABASE,
  user: USER,
  password: PASSWORD,
  max: 4,
});

const db = createPgPoolSqlExecutor(pool);
const orgA = `org_a_${randomUUID().slice(0, 8)}`;
const orgB = `org_b_${randomUUID().slice(0, 8)}`;

try {
  // Smoke: schema present
  const { rows: tables } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'messaging_%'`
  );
  assert.ok(
    (tables[0]?.n as number) >= 9,
    "normalized messaging tables missing — run harness apply before tests"
  );

  const repo = createPostgresMessagingRepository({ db });

  await test("repository: upsertContactIdentity create + camelCase mapping", async () => {
    const result = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: {
        displayName: "Alice",
        primaryPhoneNormalized: "+923001112233",
        city: "Lahore",
        consentStatus: "opted_in",
      },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_alice",
        normalizedAddress: "+923001112233",
        displayMetadata: { label: "alice" },
      },
    });
    assert.equal(result.contact.kind, "created");
    assert.equal(result.identity.kind, "created");
    assert.equal(result.contact.row.organizationId, orgA);
    assert.equal(result.contact.row.displayName, "Alice");
    assert.equal(result.contact.row.primaryPhoneNormalized, "+923001112233");
    assert.equal(result.identity.row.externalUserId, "wa_alice");
    assert.equal(result.identity.row.transportType, "meta_whatsapp_cloud");
    assert.equal(result.identity.row.displayMetadata.label, "alice");
    assert.ok(result.contact.row.createdAt);
    assert.ok(result.identity.row.updatedAt);
  });

  await test("repository: upsertContactIdentity idempotent — no duplicate contacts", async () => {
    const first = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Bob" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_bob",
      },
    });
    const second = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Bob Updated" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_bob",
      },
    });
    assert.equal(second.contact.kind, "existing");
    assert.equal(second.identity.kind, "existing");
    assert.equal(second.contact.row.id, first.contact.row.id);
    assert.equal(second.identity.row.id, first.identity.row.id);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_contacts
       WHERE organization_id = $1 AND display_name = 'Bob'`,
      [orgA]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("repository: findOrCreateConversation create + existing", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Carol" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_carol",
      },
    });
    const created = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
    });
    assert.equal(created.kind, "created");
    const again = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
    });
    assert.equal(again.kind, "existing");
    assert.equal(again.row.id, created.row.id);
    assert.equal(again.row.organizationId, orgA);
    assert.equal(again.row.contactId, identity.contact.row.id);
  });

  await test("repository: concurrent findOrCreateConversation is idempotent", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Dana" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_dana",
      },
    });
    const input = {
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_a" as const,
      transportType: "meta_whatsapp_cloud" as const,
    };
    const [a, b, c] = await Promise.all([
      repo.findOrCreateConversation(input),
      repo.findOrCreateConversation(input),
      repo.findOrCreateConversation(input),
    ]);
    const ids = new Set([a.row.id, b.row.id, c.row.id]);
    assert.equal(ids.size, 1);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_conversations
       WHERE organization_id = $1 AND contact_id = $2`,
      [orgA, identity.contact.row.id]
    );
    assert.equal(rows[0]?.n, 1);
  });

  let seededConversationId = "";
  let seededIdentityId = "";
  let seededMessageId = "";

  await test("repository: persistInboundMessage create + camelCase NormalizedMessage", async () => {
    const upserted = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Eve" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_a",
        externalUserId: "wa_eve",
      },
    });
    seededIdentityId = upserted.identity.row.id;
    const conv = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: upserted.contact.row.id,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
    });
    seededConversationId = conv.row.id;
    const msg = await repo.persistInboundMessage({
      organizationId: orgA,
      conversationId: conv.row.id,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: "wamid.eve.1",
      senderIdentityId: upserted.identity.row.id,
      messageType: "text",
      normalizedText: "hello",
      providerMetadata: { source: "test" },
    });
    assert.equal(msg.kind, "created");
    seededMessageId = msg.row.messageId;
    assert.equal(msg.row.organizationId, orgA);
    assert.equal(msg.row.conversationId, conv.row.id);
    assert.equal(msg.row.externalMessageId, "wamid.eve.1");
    assert.equal(msg.row.direction, "inbound");
    assert.equal(msg.row.text, "hello");
    assert.equal(msg.row.deliveryStatus, "received");
    assert.equal(msg.row.providerMetadata.source, "test");
    assert.equal(msg.row.sender.id, upserted.identity.row.id);
  });

  await test("repository: duplicate inbound returns existing", async () => {
    const again = await repo.persistInboundMessage({
      organizationId: orgA,
      conversationId: seededConversationId,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: "wamid.eve.1",
      senderIdentityId: seededIdentityId,
      messageType: "text",
      normalizedText: "hello again ignored",
    });
    assert.equal(again.kind, "existing");
    assert.equal(again.row.messageId, seededMessageId);
    assert.equal(again.row.text, "hello");
  });

  await test("repository: createOutboundMessage + duplicate client key", async () => {
    const created = await repo.createOutboundMessage({
      organizationId: orgA,
      conversationId: seededConversationId,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
      clientIdempotencyKey: "out-key-1",
      recipientIdentityId: seededIdentityId,
      messageType: "text",
      normalizedText: "reply",
      origin: "human",
    });
    assert.equal(created.kind, "created");
    assert.equal(created.row.direction, "outbound");
    assert.equal(created.row.clientIdempotencyKey, "out-key-1");
    const dup = await repo.createOutboundMessage({
      organizationId: orgA,
      conversationId: seededConversationId,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud",
      clientIdempotencyKey: "out-key-1",
      messageType: "text",
      normalizedText: "ignored",
      origin: "human",
    });
    assert.equal(dup.kind, "existing");
    assert.equal(dup.row.messageId, created.row.messageId);
  });

  await test("repository: appendStatusEvent idempotency", async () => {
    const first = await repo.appendStatusEvent({
      organizationId: orgA,
      messageId: seededMessageId,
      status: "delivered",
      externalStatusId: "st-eve-1",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(first.kind, "created");
    const second = await repo.appendStatusEvent({
      organizationId: orgA,
      messageId: seededMessageId,
      status: "delivered",
      externalStatusId: "st-eve-1",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(second.kind, "existing");
    assert.equal(second.row.id, first.row.id);
  });

  await test("repository: addAttachmentReference private objectKey only", async () => {
    const row = await repo.addAttachmentReference({
      organizationId: orgA,
      messageId: seededMessageId,
      objectKey: "org_a/media/file-1.bin",
      mediaType: "image/jpeg",
      sizeBytes: 12,
      sha256: "a".repeat(64),
      originalFilenameSafe: "photo.jpg",
    });
    assert.equal(row.objectKey, "org_a/media/file-1.bin");
    assert.equal(row.mediaType, "image/jpeg");
    assert.equal(row.sizeBytes, 12);
    assert.equal(row.organizationId, orgA);
    assert.ok(!("publicUrl" in row));

    await assert.rejects(
      () =>
        repo.addAttachmentReference({
          organizationId: orgA,
          messageId: seededMessageId,
          objectKey: "https://cdn.example.com/x.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 1,
          sha256: "b".repeat(64),
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.code === "invalid_input"
    );
  });

  await test("repository: recordAssignment handoff closes previous open", async () => {
    const first = await repo.recordAssignment({
      organizationId: orgA,
      conversationId: seededConversationId,
      assignedTo: "user_1",
      assignedBy: "admin",
      reason: "initial",
    });
    assert.equal(first.endedAt, null);
    const second = await repo.recordAssignment({
      organizationId: orgA,
      conversationId: seededConversationId,
      assignedTo: "user_2",
      assignedBy: "admin",
      reason: "handoff",
      endPreviousOpen: true,
    });
    assert.equal(second.assignedTo, "user_2");
    assert.equal(second.endedAt, null);
    const { rows } = await pool.query(
      `SELECT assigned_to, ended_at IS NOT NULL AS closed
       FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2
       ORDER BY started_at ASC`,
      [orgA, seededConversationId]
    );
    assert.ok(rows.length >= 2);
    const prior = rows.find((r) => r.assigned_to === "user_1");
    assert.equal(prior?.closed, true);
    const openCount = rows.filter((r) => r.closed === false).length;
    assert.equal(openCount, 1);
  });

  await test("repository: assignment partial failure rolls back", async () => {
    const failingDb = wrapFailingInsert(
      db,
      "messaging_conversation_assignments"
    );
    const failingRepo = createPostgresMessagingRepository({ db: failingDb });
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2`,
      [orgA, seededConversationId]
    );
    await assert.rejects(() =>
      failingRepo.recordAssignment({
        organizationId: orgA,
        conversationId: seededConversationId,
        assignedTo: "user_rollback",
        assignedBy: "admin",
        endPreviousOpen: true,
      })
    );
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2`,
      [orgA, seededConversationId]
    );
    assert.equal(after.rows[0]?.n, before.rows[0]?.n);
    const { rows: openRows } = await pool.query(
      `SELECT assigned_to FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2 AND ended_at IS NULL`,
      [orgA, seededConversationId]
    );
    assert.equal(openRows.length, 1);
    assert.notEqual(openRows[0]?.assigned_to, "user_rollback");
  });

  await test("repository: enqueueOutboxEvent create + duplicate key", async () => {
    const created = await repo.enqueueOutboxEvent({
      organizationId: orgA,
      aggregateType: "message",
      aggregateId: seededMessageId,
      eventType: "dispatch",
      idempotencyKey: "ob-key-1",
      payload: { attempt: 1 },
    });
    assert.equal(created.kind, "created");
    assert.equal(created.row.idempotencyKey, "ob-key-1");
    assert.equal(created.row.payload.attempt, 1);
    const dup = await repo.enqueueOutboxEvent({
      organizationId: orgA,
      aggregateType: "message",
      aggregateId: seededMessageId,
      eventType: "dispatch",
      idempotencyKey: "ob-key-1",
      payload: { attempt: 2 },
    });
    assert.equal(dup.kind, "existing");
    assert.equal(dup.row.id, created.row.id);
    assert.equal(dup.row.payload.attempt, 1);
  });

  await test("repository: appendAuditEvent", async () => {
    const row = await repo.appendAuditEvent({
      organizationId: orgA,
      actorType: "service",
      actorId: "repo-test",
      action: "message.persisted",
      targetType: "message",
      targetId: seededMessageId,
      metadata: { ok: true },
    });
    assert.equal(row.organizationId, orgA);
    assert.equal(row.action, "message.persisted");
    assert.equal(row.metadata.ok, true);
    assert.equal(row.actorType, "service");
  });

  await test("repository: tenant isolation across organizations", async () => {
    const bIdentity = await repo.upsertContactIdentity({
      organizationId: orgB,
      contact: { displayName: "Other Org" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_b",
        externalUserId: "wa_eve", // same external id, different org/connection
      },
    });
    const bConv = await repo.findOrCreateConversation({
      organizationId: orgB,
      contactId: bIdentity.contact.row.id,
      connectionId: "conn_b",
      transportType: "meta_whatsapp_cloud",
    });
    const bMsg = await repo.persistInboundMessage({
      organizationId: orgB,
      conversationId: bConv.row.id,
      connectionId: "conn_b",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: "wamid.eve.1", // same external id allowed in other scope
      messageType: "text",
      normalizedText: "other org",
    });
    assert.equal(bMsg.kind, "created");

    // Cross-tenant FK must fail predictably
    await assert.rejects(
      () =>
        repo.persistInboundMessage({
          organizationId: orgB,
          conversationId: seededConversationId, // orgA conversation
          connectionId: "conn_b",
          transportType: "meta_whatsapp_cloud",
          externalMessageId: "wamid.cross.1",
          messageType: "text",
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) &&
        (err.code === "constraint_violation" || err.code === "not_found")
    );

    // Outbox key unique per org — same key allowed in orgB
    const obB = await repo.enqueueOutboxEvent({
      organizationId: orgB,
      aggregateType: "message",
      aggregateId: bMsg.row.messageId,
      eventType: "dispatch",
      idempotencyKey: "ob-key-1",
    });
    assert.equal(obB.kind, "created");

    // orgA cannot read orgB contact via get path (scoped queries)
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_contacts
       WHERE organization_id = $1 AND id = $2`,
      [orgA, bIdentity.contact.row.id]
    );
    assert.equal(rows[0]?.n, 0);
  });

  await test("repository: FK / check constraint errors are categorized", async () => {
    await assert.rejects(
      () =>
        repo.addAttachmentReference({
          organizationId: orgA,
          messageId: "missing-message",
          objectKey: "private/key",
          mediaType: "image/png",
          sizeBytes: 1,
          sha256: "c".repeat(64),
        }),
      (err: unknown) =>
        err instanceof MessagingRepositoryError &&
        err.code === "constraint_violation"
    );

    await assert.rejects(
      () =>
        repo.appendAuditEvent({
          organizationId: orgA,
          actorType: "not-a-real-actor" as "system",
          action: "x",
          targetType: "y",
        }),
      (err: unknown) =>
        err instanceof MessagingRepositoryError &&
        err.code === "constraint_violation"
    );
  });

  await test("repository: invalid input does not become existing", async () => {
    await assert.rejects(
      () =>
        repo.persistInboundMessage({
          organizationId: "",
          conversationId: seededConversationId,
          connectionId: "conn_a",
          transportType: "meta_whatsapp_cloud",
          externalMessageId: "x",
          messageType: "text",
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.code === "invalid_input"
    );
  });
} finally {
  await cleanupOrg(pool, orgA).catch(() => undefined);
  await cleanupOrg(pool, orgB).catch(() => undefined);
  await pool.end();
}

if (failed > 0) {
  console.error(`\n${failed} unified-messaging repository test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging repository tests passed.");
