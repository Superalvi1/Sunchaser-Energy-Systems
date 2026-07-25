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
  mapDatabaseError,
} from "./messagingRepositoryErrors.ts";
import {
  assertSafeMetadata,
  assertStructuredContent,
} from "./messagingSafePayload.ts";
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

/** Barrier that releases only after N matching insert attempts have arrived. */
function createInsertBarrier(
  match: (sql: string) => boolean,
  parties = 2
): (sql: string) => Promise<void> {
  let waiting: Array<() => void> = [];
  return async (sql: string) => {
    if (!match(sql)) return;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= parties) {
        const ready = waiting;
        waiting = [];
        for (const r of ready) r();
      }
    });
  };
}

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

function assertNoFailedTx(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  assert.equal(msg.includes("25P02"), false, "must not surface 25P02");
  assert.equal(
    /current transaction is aborted/i.test(msg),
    false,
    "must not abort transaction then continue querying"
  );
}

const pool = new pg.Pool({
  host: HOST,
  port: PORT,
  database: DATABASE,
  user: USER,
  password: PASSWORD,
  max: 8,
});

const db = createPgPoolSqlExecutor(pool);
const orgA = `org_a_${randomUUID().slice(0, 8)}`;
const orgB = `org_b_${randomUUID().slice(0, 8)}`;

try {
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
    assert.equal(result.identity.row.displayMetadata.label, "alice");
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
  });

  let seededConversationId = "";
  let seededIdentityId = "";
  let seededContactId = "";
  let seededMessageId = "";

  await test("repository: persistInboundMessage maps sender to customer_contact contact_id", async () => {
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
    seededContactId = upserted.contact.row.id;
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
    assert.equal(msg.row.sender.kind, "customer_contact");
    assert.equal(msg.row.sender.id, seededContactId);
    assert.notEqual(msg.row.sender.id, seededIdentityId);
    assert.equal(msg.row.text, "hello");
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
    assert.equal(again.row.sender.kind, "customer_contact");
    assert.equal(again.row.sender.id, seededContactId);
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
    assert.equal(created.row.recipient.kind, "customer_contact");
    assert.equal(created.row.recipient.id, seededContactId);
    const dup = await repo.createOutboundMessage({
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
    assert.equal(dup.kind, "existing");
    assert.equal(dup.row.messageId, created.row.messageId);

    await assert.rejects(
      () =>
        repo.createOutboundMessage({
          organizationId: orgA,
          conversationId: seededConversationId,
          connectionId: "conn_a",
          transportType: "meta_whatsapp_cloud",
          clientIdempotencyKey: "out-key-1",
          recipientIdentityId: seededIdentityId,
          messageType: "text",
          normalizedText: "different text",
          origin: "human",
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.detail === "idempotency_conflict"
    );
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
    });
    assert.equal(row.objectKey, "org_a/media/file-1.bin");
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
    });
    assert.equal(first.endedAt, null);
    const second = await repo.recordAssignment({
      organizationId: orgA,
      conversationId: seededConversationId,
      assignedTo: "user_2",
      assignedBy: "admin",
      endPreviousOpen: true,
    });
    assert.equal(second.assignedTo, "user_2");
    const { rows } = await pool.query(
      `SELECT assigned_to, ended_at IS NULL AS open
       FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2`,
      [orgA, seededConversationId]
    );
    assert.equal(rows.filter((r) => r.open === true).length, 1);
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
    assert.equal(row.metadata.ok, true);
  });

  await test("repository: tenant isolation across organizations", async () => {
    const bIdentity = await repo.upsertContactIdentity({
      organizationId: orgB,
      contact: { displayName: "Other Org" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_b",
        externalUserId: "wa_eve",
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
      externalMessageId: "wamid.eve.1",
      messageType: "text",
      normalizedText: "other org",
    });
    assert.equal(bMsg.kind, "created");
    await assert.rejects(
      () =>
        repo.persistInboundMessage({
          organizationId: orgB,
          conversationId: seededConversationId,
          connectionId: "conn_b",
          transportType: "meta_whatsapp_cloud",
          externalMessageId: "wamid.cross.1",
          messageType: "text",
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) &&
        (err.code === "constraint_violation" || err.code === "not_found")
    );
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
  });

  await test("errors: mapped errors never expose raw cause or duplicate values", async () => {
    const raw = Object.assign(new Error('duplicate key value violates unique constraint "messaging_outbox_idempotency_uidx" Detail: Key (organization_id, idempotency_key)=(org, secret-token-value) already exists.'), {
      code: "23505",
      constraint: "messaging_outbox_idempotency_uidx",
      detail: "Key (organization_id, idempotency_key)=(org, secret-token-value) already exists.",
    });
    const mapped = mapDatabaseError(raw);
    assert.equal(mapped.code, "unique_violation");
    assert.equal(mapped.detail, "messaging_outbox_idempotency_uidx");
    assert.equal("cause" in mapped, false);
    assert.equal((mapped as { cause?: unknown }).cause, undefined);
    assert.equal(mapped.message.includes("secret-token-value"), false);
    assert.equal(mapped.message.includes("duplicate key"), false);
    const json = JSON.stringify(mapped);
    assert.equal(json.includes("secret-token-value"), false);
    assert.equal(json.includes("cause"), false);
  });

  await test("safe payload: rejects nested/credential metadata; accepts scalars", async () => {
    assert.deepEqual(assertSafeMetadata({ a: 1, b: "x", c: true, d: null }, "m"), {
      a: 1,
      b: "x",
      c: true,
      d: null,
    });
    assert.throws(
      () => assertSafeMetadata({ nested: { x: 1 } }, "providerMetadata"),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.code === "invalid_input"
    );
    assert.throws(
      () => assertSafeMetadata({ access_token: "abc" }, "diagnostics"),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.detail === "credential_like_key"
    );
    assert.throws(
      () => assertSafeMetadata({ Authorization: "Bearer x" }, "payload"),
      (err: unknown) => isMessagingRepositoryError(err)
    );
    assert.throws(
      () => assertSafeMetadata(["a"], "metadata"),
      (err: unknown) => isMessagingRepositoryError(err)
    );
    await assert.rejects(
      () =>
        repo.enqueueOutboxEvent({
          organizationId: orgA,
          aggregateType: "message",
          aggregateId: seededMessageId,
          eventType: "dispatch",
          idempotencyKey: "ob-bad-meta",
          payload: { refreshToken: "nope" },
        }),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.code === "invalid_input"
    );
  });

  await test("safe payload: credential-like keys including camelCase / prefixed forms", async () => {
    const rejectedKeys = [
      "token",
      "apiToken",
      "authToken",
      "accessToken",
      "whatsappAccessToken",
      "refreshToken",
      "secret",
      "clientSecret",
      "apiSecret",
      "password",
      "passwordHash",
      "authorization",
      "authorizationHeader",
      "cookie",
      "session",
      "sessionId",
      "privateKey",
    ];
    for (const key of rejectedKeys) {
      assert.throws(
        () => assertSafeMetadata({ [key]: "x" }, "providerMetadata"),
        (err: unknown) => {
          if (!isMessagingRepositoryError(err)) return false;
          assert.equal(err.detail, "credential_like_key");
          assert.equal(err.message.includes(key), false);
          assert.equal(err.message.includes("x"), false);
          return true;
        },
        `expected rejection for key form`
      );
    }

    // Safe controls: ordinary keys and words that merely contain credential
    // character sequences without a credential segment.
    // Conservative policy rejects whole-segment terms even with suffixes
    // (sessionDurationSeconds, passwordPolicyEnabled), so controls use
    // durationSeconds / policyEnabled instead.
    const accepted = assertSafeMetadata(
      {
        status: "ok",
        tokenizedLabel: "label",
        durationSeconds: 30,
        policyEnabled: true,
      },
      "diagnostics"
    );
    assert.equal(accepted.status, "ok");
    assert.equal(accepted.tokenizedLabel, "label");
    assert.equal(accepted.durationSeconds, 30);
    assert.equal(accepted.policyEnabled, true);

    assert.throws(
      () =>
        assertSafeMetadata({ sessionDurationSeconds: 1 }, "diagnostics"),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.detail === "credential_like_key"
    );
    assert.throws(
      () => assertSafeMetadata({ passwordPolicyEnabled: true }, "diagnostics"),
      (err: unknown) =>
        isMessagingRepositoryError(err) && err.detail === "credential_like_key"
    );
  });

  await test("safe payload: structured content union validation", async () => {
    assert.deepEqual(assertStructuredContent({ kind: "none" }), { kind: "none" });
    assert.throws(
      () =>
        assertStructuredContent({
          kind: "media_ref",
          mediaId: "m1",
          rawProvider: { envelope: true },
        }),
      (err: unknown) => isMessagingRepositoryError(err)
    );
    assert.throws(
      () => assertStructuredContent({ kind: "unknown_kind" }),
      (err: unknown) => isMessagingRepositoryError(err)
    );
  });

  // ---- Deterministic race tests (SQL insert barrier) ----

  await test("race: contact identity ON CONFLICT — one created, one existing, no orphans", async () => {
    const barrier = createInsertBarrier((sql) =>
      sql.includes("messaging_contact_identities")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const externalUserId = `wa_race_id_${randomUUID().slice(0, 8)}`;
    const [r1, r2] = await Promise.all([
      repoA.upsertContactIdentity({
        organizationId: orgA,
        contact: { displayName: "RaceId1" },
        identity: {
          transportType: "meta_whatsapp_cloud",
          connectionId: "conn_race",
          externalUserId,
        },
      }),
      repoB.upsertContactIdentity({
        organizationId: orgA,
        contact: { displayName: "RaceId2" },
        identity: {
          transportType: "meta_whatsapp_cloud",
          connectionId: "conn_race",
          externalUserId,
        },
      }),
    ]);
    const kinds = [r1.identity.kind, r2.identity.kind].sort();
    assert.deepEqual(kinds, ["created", "existing"]);
    assert.equal(r1.identity.row.id, r2.identity.row.id);
    assert.equal(r1.contact.row.id, r2.contact.row.id);
    const { rows: idRows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_contact_identities
       WHERE organization_id = $1 AND external_user_id = $2`,
      [orgA, externalUserId]
    );
    assert.equal(idRows[0]?.n, 1);
    const { rows: orphanRows } = await pool.query(
      `SELECT c.id FROM public.messaging_contacts c
       LEFT JOIN public.messaging_contact_identities i
         ON i.organization_id = c.organization_id AND i.contact_id = c.id
       WHERE c.organization_id = $1
         AND c.display_name IN ('RaceId1', 'RaceId2')
         AND i.id IS NULL`,
      [orgA]
    );
    assert.equal(orphanRows.length, 0);
  });

  await test("race: conversation findOrCreate ON CONFLICT", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "RaceConv" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_race_cv",
        externalUserId: `wa_race_cv_${randomUUID().slice(0, 8)}`,
      },
    });
    const barrier = createInsertBarrier((sql) =>
      sql.includes("messaging_conversations")
    );
    const input = {
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_race_cv",
      transportType: "meta_whatsapp_cloud" as const,
    };
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const [a, b] = await Promise.all([
      repoA.findOrCreateConversation(input),
      repoB.findOrCreateConversation(input),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing"]);
    assert.equal(a.row.id, b.row.id);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_conversations
       WHERE organization_id = $1 AND contact_id = $2 AND connection_id = $3`,
      [orgA, identity.contact.row.id, "conn_race_cv"]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("race: inbound message ON CONFLICT", async () => {
    const barrier = createInsertBarrier(
      (sql) =>
        sql.includes("messaging_messages") &&
        sql.includes("external_message_id") &&
        sql.includes("WHERE (external_message_id IS NOT NULL)")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const externalMessageId = `wamid.race.${randomUUID().slice(0, 8)}`;
    const input = {
      organizationId: orgA,
      conversationId: seededConversationId,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud" as const,
      externalMessageId,
      senderIdentityId: seededIdentityId,
      messageType: "text" as const,
      normalizedText: "race inbound",
    };
    const [a, b] = await Promise.all([
      repoA.persistInboundMessage(input),
      repoB.persistInboundMessage(input),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing"]);
    assert.equal(a.row.messageId, b.row.messageId);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_messages
       WHERE organization_id = $1 AND external_message_id = $2`,
      [orgA, externalMessageId]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("race: outbound message ON CONFLICT", async () => {
    const barrier = createInsertBarrier(
      (sql) =>
        sql.includes("messaging_messages") &&
        sql.includes("client_idempotency_key") &&
        sql.includes("WHERE (client_idempotency_key IS NOT NULL)")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const clientIdempotencyKey = `out-race-${randomUUID().slice(0, 8)}`;
    const input = {
      organizationId: orgA,
      conversationId: seededConversationId,
      connectionId: "conn_a",
      transportType: "meta_whatsapp_cloud" as const,
      clientIdempotencyKey,
      messageType: "text" as const,
      normalizedText: "race outbound",
      origin: "human" as const,
    };
    const [a, b] = await Promise.all([
      repoA.createOutboundMessage(input),
      repoB.createOutboundMessage(input),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing"]);
    assert.equal(a.row.messageId, b.row.messageId);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_messages
       WHERE organization_id = $1 AND client_idempotency_key = $2`,
      [orgA, clientIdempotencyKey]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("race: status event ON CONFLICT", async () => {
    const barrier = createInsertBarrier(
      (sql) =>
        sql.includes("messaging_status_events") &&
        sql.includes("WHERE (external_status_id IS NOT NULL)")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const externalStatusId = `st-race-${randomUUID().slice(0, 8)}`;
    const input = {
      organizationId: orgA,
      messageId: seededMessageId,
      status: "read" as const,
      externalStatusId,
      occurredAt: new Date().toISOString(),
    };
    const [a, b] = await Promise.all([
      repoA.appendStatusEvent(input),
      repoB.appendStatusEvent(input),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing"]);
    assert.equal(a.row.id, b.row.id);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_status_events
       WHERE organization_id = $1 AND external_status_id = $2`,
      [orgA, externalStatusId]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("race: outbox ON CONFLICT", async () => {
    const barrier = createInsertBarrier((sql) =>
      sql.includes("messaging_outbox")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const idempotencyKey = `ob-race-${randomUUID().slice(0, 8)}`;
    const input = {
      organizationId: orgA,
      aggregateType: "message",
      aggregateId: seededMessageId,
      eventType: "dispatch",
      idempotencyKey,
      payload: { n: 1 },
    };
    const [a, b] = await Promise.all([
      repoA.enqueueOutboxEvent(input),
      repoB.enqueueOutboxEvent(input),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing"]);
    assert.equal(a.row.id, b.row.id);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_outbox
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [orgA, idempotencyKey]
    );
    assert.equal(rows[0]?.n, 1);
  });

  await test("race: concurrent assignment handoffs leave one open assignee", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "AssignRace" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_assign_race",
        externalUserId: `wa_assign_${randomUUID().slice(0, 8)}`,
      },
    });
    const conv = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_assign_race",
      transportType: "meta_whatsapp_cloud",
    });
    await repo.recordAssignment({
      organizationId: orgA,
      conversationId: conv.row.id,
      assignedTo: "user_seed",
      assignedBy: "admin",
    });
    const [a, b] = await Promise.all([
      repo.recordAssignment({
        organizationId: orgA,
        conversationId: conv.row.id,
        assignedTo: "user_a",
        assignedBy: "admin",
        endPreviousOpen: true,
      }),
      repo.recordAssignment({
        organizationId: orgA,
        conversationId: conv.row.id,
        assignedTo: "user_b",
        assignedBy: "admin",
        endPreviousOpen: true,
      }),
    ]);
    assert.ok(a.id);
    assert.ok(b.id);
    const { rows } = await pool.query(
      `SELECT assigned_to FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2 AND ended_at IS NULL`,
      [orgA, conv.row.id]
    );
    assert.equal(rows.length, 1);
    assert.ok(["user_a", "user_b"].includes(String(rows[0]?.assigned_to)));
  });

  await test("assignment: out-of-order startedAt still closes previous open", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "AssignOOO" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_assign_ooo",
        externalUserId: `wa_ooo_${randomUUID().slice(0, 8)}`,
      },
    });
    const conv = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_assign_ooo",
      transportType: "meta_whatsapp_cloud",
    });
    const laterStartedAt = "2026-07-24T12:00:00.000Z";
    const earlierStartedAt = "2026-07-24T10:00:00.000Z";
    const first = await repo.recordAssignment({
      organizationId: orgA,
      conversationId: conv.row.id,
      assignedTo: "user_later",
      assignedBy: "admin",
      startedAt: laterStartedAt,
    });
    assert.equal(first.endedAt, null);
    const second = await repo.recordAssignment({
      organizationId: orgA,
      conversationId: conv.row.id,
      assignedTo: "user_earlier_handoff",
      assignedBy: "admin",
      startedAt: earlierStartedAt,
      endPreviousOpen: true,
    });
    assert.equal(second.endedAt, null);
    assert.equal(second.assignedTo, "user_earlier_handoff");

    const { rows: openRows } = await pool.query(
      `SELECT assigned_to FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2 AND ended_at IS NULL`,
      [orgA, conv.row.id]
    );
    assert.equal(openRows.length, 1);
    assert.equal(openRows[0]?.assigned_to, "user_earlier_handoff");

    const { rows: closedRows } = await pool.query(
      `SELECT started_at, ended_at
       FROM public.messaging_conversation_assignments
       WHERE organization_id = $1 AND conversation_id = $2 AND id = $3`,
      [orgA, conv.row.id, first.id]
    );
    assert.ok(closedRows[0]?.ended_at);
    const closedStarted = new Date(String(closedRows[0]?.started_at)).getTime();
    const closedEnded = new Date(String(closedRows[0]?.ended_at)).getTime();
    assert.ok(closedEnded >= closedStarted);

    const { rows: convRows } = await pool.query(
      `SELECT assigned_user_id FROM public.messaging_conversations
       WHERE organization_id = $1 AND id = $2`,
      [orgA, conv.row.id]
    );
    assert.equal(convRows[0]?.assigned_user_id, "user_earlier_handoff");
  });

  await test("race: identity conflict with different existing contact IDs → tenant_mismatch", async () => {
    const contactA = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "MismatchA" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_mismatch_seed_a",
        externalUserId: `wa_mm_a_${randomUUID().slice(0, 8)}`,
      },
    });
    const contactB = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "MismatchB" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_mismatch_seed_b",
        externalUserId: `wa_mm_b_${randomUUID().slice(0, 8)}`,
      },
    });
    const contactIdA = contactA.contact.row.id;
    const contactIdB = contactB.contact.row.id;
    assert.notEqual(contactIdA, contactIdB);

    const barrier = createInsertBarrier((sql) =>
      sql.includes("messaging_contact_identities")
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeIdempotentInsert: barrier,
    });
    const externalUserId = `wa_mm_race_${randomUUID().slice(0, 8)}`;
    const sharedIdentity = {
      transportType: "meta_whatsapp_cloud" as const,
      connectionId: "conn_mismatch_race",
      externalUserId,
    };

    const results = await Promise.allSettled([
      repoA.upsertContactIdentity({
        organizationId: orgA,
        contact: { id: contactIdA },
        identity: sharedIdentity,
      }),
      repoB.upsertContactIdentity({
        organizationId: orgA,
        contact: { id: contactIdB },
        identity: sharedIdentity,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const winner = (fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof repo.upsertContactIdentity>>
    >).value;
    assert.equal(winner.identity.kind, "created");
    assert.ok(
      winner.contact.row.id === contactIdA ||
        winner.contact.row.id === contactIdB
    );
    const loserErr = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(isMessagingRepositoryError(loserErr));
    assert.equal(loserErr.code, "tenant_mismatch");

    const { rows: idRows } = await pool.query(
      `SELECT count(*)::int AS n, min(contact_id) AS contact_id
       FROM public.messaging_contact_identities
       WHERE organization_id = $1
         AND connection_id = $2
         AND external_user_id = $3`,
      [orgA, "conn_mismatch_race", externalUserId]
    );
    assert.equal(idRows[0]?.n, 1);
    assert.equal(idRows[0]?.contact_id, winner.contact.row.id);

    const { rows: contactRows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_contacts
       WHERE organization_id = $1 AND id = ANY($2::text[])`,
      [orgA, [contactIdA, contactIdB]]
    );
    assert.equal(contactRows[0]?.n, 2);
  });

  await test("race: outbound claim — only one claimed, other in_flight", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Claim" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_claim",
        externalUserId: `wa_claim_${randomUUID().slice(0, 8)}`,
      },
    });
    const conversation = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_claim",
      transportType: "meta_whatsapp_cloud",
    });
    const created = await repo.createOutboundMessage({
      organizationId: orgA,
      conversationId: conversation.row.id,
      connectionId: "conn_claim",
      transportType: "meta_whatsapp_cloud",
      clientIdempotencyKey: `claim-key-${randomUUID()}`,
      recipientIdentityId: identity.identity.row.id,
      messageType: "text",
      normalizedText: "claim race",
      origin: "human",
      deliveryStatus: "queued",
      processingStatus: "pending",
    });
    assert.equal(created.kind, "created");

    const barrier = createInsertBarrier(
      (sql) =>
        sql.includes("messaging_messages") &&
        sql.includes("processing_status = 'processing'"),
      2
    );
    const repoA = createPostgresMessagingRepository({
      db,
      beforeOutboundClaim: barrier,
    });
    const repoB = createPostgresMessagingRepository({
      db,
      beforeOutboundClaim: barrier,
    });
    const [c1, c2] = await Promise.all([
      repoA.claimOutboundMessageForSend({
        organizationId: orgA,
        messageId: created.row.messageId,
      }),
      repoB.claimOutboundMessageForSend({
        organizationId: orgA,
        messageId: created.row.messageId,
      }),
    ]);
    const kinds = [c1.kind, c2.kind].sort();
    assert.deepEqual(kinds, ["claimed", "in_flight"]);
    const after = await repo.findMessageByExternalId({
      organizationId: orgA,
      connectionId: "conn_claim",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: "does-not-exist",
    });
    assert.equal(after, null);
    const bound = await repo.bindOutboundLegacyMessageId({
      organizationId: orgA,
      messageId: created.row.messageId,
      whatsappMessageId: "wa-legacy-1",
    });
    assert.equal(bound.providerMetadata.whatsappMessageId, "wa-legacy-1");
    assert.equal(bound.deliveryStatus, "sending");

    const associated = await repo.associateOutboundProviderExternalId({
      organizationId: orgA,
      messageId: created.row.messageId,
      providerMessageId: "wamid.claim.assoc",
    });
    assert.equal(associated.externalMessageId, "wamid.claim.assoc");
    assert.equal(associated.deliveryStatus, "sending");
    const byLegacy = await repo.findMessageByLegacyWhatsAppId({
      organizationId: orgA,
      connectionId: "conn_claim",
      transportType: "meta_whatsapp_cloud",
      whatsappMessageId: "wa-legacy-1",
    });
    assert.ok(byLegacy);
    assert.equal(byLegacy.messageId, created.row.messageId);
    const cross = await repo.findMessageByLegacyWhatsAppId({
      organizationId: orgB,
      connectionId: "conn_claim",
      transportType: "meta_whatsapp_cloud",
      whatsappMessageId: "wa-legacy-1",
    });
    assert.equal(cross, null);
  });

  await test("status: delayed sent cannot downgrade read; attachment/audit idempotent", async () => {
    const identity = await repo.upsertContactIdentity({
      organizationId: orgA,
      contact: { displayName: "Mono" },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId: "conn_mono",
        externalUserId: `wa_mono_${randomUUID().slice(0, 8)}`,
      },
    });
    const conversation = await repo.findOrCreateConversation({
      organizationId: orgA,
      contactId: identity.contact.row.id,
      connectionId: "conn_mono",
      transportType: "meta_whatsapp_cloud",
    });
    const outbound = await repo.createOutboundMessage({
      organizationId: orgA,
      conversationId: conversation.row.id,
      connectionId: "conn_mono",
      transportType: "meta_whatsapp_cloud",
      clientIdempotencyKey: `mono-${randomUUID()}`,
      recipientIdentityId: identity.identity.row.id,
      messageType: "text",
      normalizedText: "mono",
      origin: "human",
    });
    await repo.appendStatusEvent({
      organizationId: orgA,
      messageId: outbound.row.messageId,
      status: "read",
      externalStatusId: `read-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      diagnostics: { providerMessageId: "wamid.mono.repo" },
    });
    await repo.appendStatusEvent({
      organizationId: orgA,
      messageId: outbound.row.messageId,
      status: "sent",
      externalStatusId: `sent-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      diagnostics: { providerMessageId: "wamid.mono.repo" },
    });
    const found = await repo.findMessageByExternalId({
      organizationId: orgA,
      connectionId: "conn_mono",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: "wamid.mono.repo",
    });
    assert.ok(found);
    assert.equal(found.deliveryStatus, "read");

    const inbound = await repo.persistInboundMessage({
      organizationId: orgA,
      conversationId: conversation.row.id,
      connectionId: "conn_mono",
      transportType: "meta_whatsapp_cloud",
      externalMessageId: `wamid.att.${randomUUID()}`,
      senderIdentityId: identity.identity.row.id,
      messageType: "image",
      origin: "customer",
    });
    const att1 = await repo.addAttachmentReference({
      organizationId: orgA,
      messageId: inbound.row.messageId,
      objectKey: `meta/${orgA}/conn_mono/media1`,
      mediaType: "image/jpeg",
      sizeBytes: 1,
      sha256: "b".repeat(64),
    });
    const att2 = await repo.addAttachmentReference({
      organizationId: orgA,
      messageId: inbound.row.messageId,
      objectKey: `meta/${orgA}/conn_mono/media1`,
      mediaType: "image/jpeg",
      sizeBytes: 1,
      sha256: "b".repeat(64),
    });
    assert.equal(att1.id, att2.id);
    const { rows: attRows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.messaging_attachments
       WHERE organization_id = $1 AND message_id = $2`,
      [orgA, inbound.row.messageId]
    );
    assert.equal(attRows[0]?.n, 1);

    const auditKey = `inbound:${inbound.row.externalMessageId}`;
    const a1 = await repo.appendAuditEvent({
      organizationId: orgA,
      actorType: "system",
      action: "inbound.message.persisted",
      targetType: "message",
      targetId: inbound.row.messageId,
      metadata: { idempotencyKey: auditKey },
    });
    const a2 = await repo.appendAuditEvent({
      organizationId: orgA,
      actorType: "system",
      action: "inbound.message.persisted",
      targetType: "message",
      targetId: inbound.row.messageId,
      metadata: { idempotencyKey: auditKey },
    });
    assert.equal(a1.id, a2.id);
  });

  // Ensure race helpers did not leave aborted-tx symptoms in the process.
  assertNoFailedTx(null);
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
