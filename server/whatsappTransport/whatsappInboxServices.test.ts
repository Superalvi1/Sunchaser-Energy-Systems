/**
 * PR 2 inbox service-layer unit tests (Revision 3).
 * Run: npm run test:whatsapp-inbox-services
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import {
  createInMemoryWhatsAppInboxRepositories,
} from "./whatsappInboxRepository.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { InboxAssigneeDirectory } from "./whatsappInboxServicePorts.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import { IDEMPOTENCY_PROCESSING_STALE_MS } from "./whatsappMessageService.ts";

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

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "user_sales_1",
    username: "sales1",
    name: "Sales One",
    email: "sales1@example.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function admin(overrides: Partial<RequestActor> = {}): RequestActor {
  return actor({
    id: "user_admin_1",
    username: "admin1",
    name: "Admin One",
    role: "Admin",
    ...overrides,
  });
}

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id"> &
    Partial<WhatsAppConversationInbox>
): WhatsAppConversationInbox {
  const now = partial.updatedAt ?? "2026-07-19T10:00:00.000Z";
  const row: WhatsAppConversationInbox = {
    id: partial.id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${partial.id}`,
    status: "open",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    ...partial,
  };
  store.conversations.set(row.id, row);
  return row;
}

function seedMessage(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<InboxMessageRef, "id" | "conversationId" | "direction"> &
    Partial<InboxMessageRef>
): InboxMessageRef {
  const row: InboxMessageRef = {
    id: partial.id,
    companyId: "sunchaser",
    conversationId: partial.conversationId,
    direction: partial.direction,
    status: partial.status ?? "received",
    textBody: partial.textBody ?? "hi",
    createdAt: partial.createdAt ?? "2026-07-19T10:00:00.000Z",
    occurredAt: partial.occurredAt ?? partial.createdAt ?? "2026-07-19T10:00:00.000Z",
    ...partial,
  };
  store.messages.set(row.id, row);
  return row;
}

function memoryAssignees(
  users: Array<{
    id: string;
    role: string;
    accountStatus: string;
    companyId?: string;
  }>
): InboxAssigneeDirectory {
  const map = new Map(users.map((u) => [u.id, u]));
  return {
    async getById(id, _companyId) {
      const u = map.get(id);
      if (!u) return null;
      return {
        id: u.id,
        role: u.role,
        accountStatus: u.accountStatus,
        companyId: u.companyId ?? "sunchaser",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// StatusService
// ---------------------------------------------------------------------------

await test("status: staff may resolve→open; assignee cannot archive", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    status: "resolved",
    assignedUserId: "user_sales_1",
  });
  const services = createWhatsAppInboxServices(repos);

  const opened = await services.statuses.userTransition("c1", {
    toStatus: "open",
    actor: actor(),
    expectedLockVersion: 1,
  });
  assert.equal(opened.status, "open");
  assert.equal(opened.lockVersion, 2);

  seedConversation(repos.store, {
    id: "c2",
    status: "open",
    assignedUserId: "user_sales_1",
    lockVersion: 1,
  });
  await assert.rejects(
    () =>
      services.statuses.userTransition("c2", {
        toStatus: "archived",
        actor: actor(),
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
});

await test("status: admin may archive and reopen-archived", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "open" });
  const services = createWhatsAppInboxServices(repos);

  const archived = await services.statuses.userTransition("c1", {
    toStatus: "archived",
    actor: admin(),
    expectedLockVersion: 1,
  });
  assert.equal(archived.status, "archived");

  const reopened = await services.statuses.userTransition("c1", {
    toStatus: "open",
    actor: admin(),
    expectedLockVersion: 2,
  });
  assert.equal(reopened.status, "open");
});

await test("status: Technical CEO is admin-tier for archive", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "pending" });
  const services = createWhatsAppInboxServices(repos);
  const row = await services.statuses.userTransition("c1", {
    toStatus: "archived",
    actor: actor({ id: "ceo", role: "Technical CEO" }),
    expectedLockVersion: 1,
  });
  assert.equal(row.status, "archived");
});

await test("status: systemReopen preserves assignment and is idempotent", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    status: "archived",
    assignedUserId: "user_sales_1",
    assignedAt: "2026-07-19T09:00:00.000Z",
    assignedBy: "user_admin_1",
  });
  const services = createWhatsAppInboxServices(repos);

  const reopened = await services.statuses.systemReopen("c1", {
    trigger: "webhook_callback",
  });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.assignedUserId, "user_sales_1");
  assert.equal(reopened.lockVersion, 2);

  const again = await services.statuses.systemReopen("c1", {
    trigger: "webhook_callback",
  });
  assert.equal(again.lockVersion, 2);

  const events = await repos.statuses.listByConversation("c1");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.metadata.trigger, "webhook_callback");
  assert.equal(events[0]!.changedByUserId, null);
});

await test("status: autoOpenOnSuccessfulReply only from pending", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "pending", status: "pending" });
  seedConversation(repos.store, { id: "resolved", status: "resolved" });
  const services = createWhatsAppInboxServices(repos);

  const opened = await services.statuses.autoOpenOnSuccessfulReply("pending");
  assert.equal(opened.status, "open");

  const untouched = await services.statuses.autoOpenOnSuccessfulReply("resolved");
  assert.equal(untouched.status, "resolved");
});

await test("status: OCC conflict on stale lock_version", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "open", lockVersion: 3 });
  const services = createWhatsAppInboxServices(repos);
  await assert.rejects(
    () =>
      services.statuses.userTransition("c1", {
        toStatus: "pending",
        actor: actor(),
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "conflict"
  );
});

await test("status: invalid transition rejected", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "archived" });
  const services = createWhatsAppInboxServices(repos);
  await assert.rejects(
    () =>
      services.statuses.userTransition("c1", {
        toStatus: "pending",
        actor: admin(),
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "invalid_transition"
  );
});

// ---------------------------------------------------------------------------
// AssignmentService
// ---------------------------------------------------------------------------

await test("assignment: self-assign unassigned + event + status untouched", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "pending" });
  const services = createWhatsAppInboxServices(repos, {
    assignees: memoryAssignees([
      { id: "user_sales_1", role: "Sales Executive", accountStatus: "Approved" },
    ]),
  });

  const row = await services.assignments.setAssignment("c1", {
    assigneeUserId: "user_sales_1",
    actor: actor(),
    expectedLockVersion: 1,
  });
  assert.equal(row.assignedUserId, "user_sales_1");
  assert.equal(row.status, "pending");
  assert.equal(row.lockVersion, 2);
  const events = await repos.assignments.listByConversation("c1");
  assert.equal(events.length, 1);
});

await test("assignment: non-assignee staff cannot reassign others", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    assignedUserId: "user_other",
  });
  const services = createWhatsAppInboxServices(repos, {
    assignees: memoryAssignees([
      { id: "user_sales_1", role: "Sales Executive", accountStatus: "Approved" },
    ]),
  });
  await assert.rejects(
    () =>
      services.assignments.setAssignment("c1", {
        assigneeUserId: "user_sales_1",
        actor: actor(),
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
});

await test("assignment: admin may reassign; invalid assignee rejected", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    assignedUserId: "user_other",
  });
  const services = createWhatsAppInboxServices(repos, {
    assignees: memoryAssignees([
      { id: "user_sales_1", role: "Sales Executive", accountStatus: "Approved" },
      { id: "user_pending", role: "Sales Executive", accountStatus: "Pending" },
    ]),
  });

  const row = await services.assignments.setAssignment("c1", {
    assigneeUserId: "user_sales_1",
    actor: admin(),
    expectedLockVersion: 1,
  });
  assert.equal(row.assignedUserId, "user_sales_1");

  await assert.rejects(
    () =>
      services.assignments.setAssignment("c1", {
        assigneeUserId: "user_pending",
        actor: admin(),
        expectedLockVersion: 2,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "invalid_argument"
  );
});

// ---------------------------------------------------------------------------
// ReadStateService
// ---------------------------------------------------------------------------

await test("read: outbound seen position resolves to inbound watermark", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedMessage(repos.store, {
    id: "m_in_1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T10:00:00.000Z",
  });
  seedMessage(repos.store, {
    id: "m_out_1",
    conversationId: "c1",
    direction: "outbound",
    createdAt: "2026-07-19T10:01:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos);

  const result = await services.readState.resolveAndAdvance("c1", {
    actor: actor(),
    lastSeenMessageId: "m_out_1",
    lastSeenMessageCreatedAt: "2026-07-19T10:01:00.000Z",
  });
  assert.equal(result.advanced, true);
  assert.equal(result.watermark.lastReadInboundMessageId, "m_in_1");
});

await test("read: monotonic guard blocks regression; outbound-only → no unread", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedMessage(repos.store, {
    id: "m_in_1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T10:00:00.000Z",
  });
  seedMessage(repos.store, {
    id: "m_in_2",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T11:00:00.000Z",
  });
  seedMessage(repos.store, {
    id: "m_out_only",
    conversationId: "c2",
    direction: "outbound",
    createdAt: "2026-07-19T12:00:00.000Z",
  });
  seedConversation(repos.store, { id: "c2" });
  const services = createWhatsAppInboxServices(repos);

  await services.readState.resolveAndAdvance("c1", {
    actor: actor(),
    lastSeenMessageId: "m_in_2",
    lastSeenMessageCreatedAt: "2026-07-19T11:00:00.000Z",
  });
  const regress = await services.readState.resolveAndAdvance("c1", {
    actor: actor(),
    lastSeenMessageId: "m_in_1",
    lastSeenMessageCreatedAt: "2026-07-19T10:00:00.000Z",
  });
  assert.equal(regress.advanced, false);
  assert.equal(regress.watermark.lastReadInboundMessageId, "m_in_2");

  assert.equal(await services.readState.getUnreadCount("c2", actor()), 0);
  assert.equal(await services.readState.hasUnread("c2", actor()), false);
});

// ---------------------------------------------------------------------------
// CRMLinkService
// ---------------------------------------------------------------------------

await test("crm: link/unlink; createLead 409 when already linked", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  let created = 0;
  const services = createWhatsAppInboxServices(repos, {
    createLead: async () => {
      created += 1;
      return { leadId: "lead_1" };
    },
  });

  const link = await services.crmLinks.link("c1", {
    actor: actor(),
    linkedEntityType: "lead",
    linkedEntityId: "lead_existing",
  });
  assert.equal(link.linkedEntityId, "lead_existing");

  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation("c1", { actor: actor() }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "already_linked"
  );
  assert.equal(created, 0);

  assert.equal(await services.crmLinks.unlink("c1", actor()), true);
  const createdResult = await services.crmLinks.createLeadFromConversation(
    "c1",
    { actor: actor() }
  );
  assert.equal(createdResult.kind, "created");
  assert.equal(created, 1);
});

await test("crm: duplicate suggestion before create", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  let createCalls = 0;
  const services = createWhatsAppInboxServices(repos, {
    findDuplicate: async () => ({
      linkedEntityType: "lead",
      linkedEntityId: "lead_dup",
    }),
    createLead: async () => {
      createCalls += 1;
      return { leadId: "lead_new" };
    },
  });

  const suggestion = await services.crmLinks.createLeadFromConversation("c1", {
    actor: actor(),
  });
  assert.equal(suggestion.kind, "duplicate_suggestion");
  assert.equal(createCalls, 0);

  // forceCreate recovers by linking the existing lead — never creates a second.
  const forced = await services.crmLinks.createLeadFromConversation("c1", {
    actor: actor(),
    forceCreate: true,
  });
  assert.equal(forced.kind, "created");
  if (forced.kind === "created") {
    assert.equal(forced.leadId, "lead_dup");
  }
  assert.equal(createCalls, 0);
});

// ---------------------------------------------------------------------------
// ConversationService
// ---------------------------------------------------------------------------

await test("conversation: list ignores client companyId; detail self-heals", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    status: "archived",
    updatedAt: "2026-07-19T10:00:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_other",
    companyId: "other_co",
    updatedAt: "2026-07-19T11:00:00.000Z",
  });
  seedMessage(repos.store, {
    id: "m_in_new",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T12:00:00.000Z",
    occurredAt: "2026-07-19T12:00:00.000Z",
  });
  // Stale status event older than inbound
  await repos.statuses.insertEvent({
    conversationId: "c1",
    fromStatus: "open",
    toStatus: "archived",
    changedByUserId: "user_admin_1",
    createdAt: "2026-07-19T11:00:00.000Z",
    companyId: "sunchaser",
  });

  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T12:30:00.000Z"),
  });

  const list = await services.conversations.listByActivity(actor(), {});
  assert.deepEqual(
    list.rows.map((r) => r.id),
    ["c1"]
  );

  const detail = await services.conversations.getDetail("c1", actor());
  assert.equal(detail.selfHealed, true);
  assert.equal(detail.conversation.status, "open");
  assert.equal(detail.freeForm.freeFormAllowed, true);
});

await test("conversation: open detail is no-op for self-heal", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "open" });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T10:00:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T10:30:00.000Z"),
  });
  const detail = await services.conversations.getDetail("c1", actor());
  assert.equal(detail.selfHealed, false);
  assert.equal((await repos.statuses.listByConversation("c1")).length, 0);
});

// ---------------------------------------------------------------------------
// MessageService
// ---------------------------------------------------------------------------

await test("message: free-form closed after 24h", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-18T10:00:00.000Z",
    occurredAt: "2026-07-18T10:00:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T11:00:00.000Z"),
  });
  const eligibility = await services.messages.getFreeFormEligibility(
    "c1",
    actor()
  );
  assert.equal(eligibility.freeFormAllowed, false);
  await assert.rejects(
    () => services.messages.assertFreeFormAllowed("c1"),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "free_form_closed"
  );
});

await test("message: idempotency claim, replay, stale processing", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "pending" });
  seedMessage(repos.store, {
    id: "m_in",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T10:00:00.000Z",
    occurredAt: "2026-07-19T10:00:00.000Z",
  });

  let now = Date.parse("2026-07-19T10:30:00.000Z");
  const services = createWhatsAppInboxServices(repos, { now: () => now });

  const claimed = await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-1",
    actor: actor(),
  });
  assert.equal(claimed.kind, "claimed");

  const processing = await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-1",
    actor: actor(),
  });
  assert.equal(processing.kind, "processing");

  const completed = await services.messages.completeOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-1",
    messageId: "m_out_1",
  });
  assert.equal(completed.state, "completed");
  const conv = await repos.conversations.getById("c1");
  assert.equal(conv!.status, "open");
  assert.equal(conv!.hasFailedMessage, false);

  const replay = await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-1",
    actor: actor(),
  });
  assert.equal(replay.kind, "replay_completed");

  // Fresh key left processing, then become stale
  await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-stale",
    actor: actor(),
  });
  now += IDEMPOTENCY_PROCESSING_STALE_MS + 1;
  const unknown = await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-stale",
    actor: actor(),
  });
  assert.equal(unknown.kind, "outcome_unknown");
  assert.equal(
    (await repos.conversations.getById("c1"))!.hasFailedMessage,
    true
  );
});

await test("message: failed_known sets failure badge; company isolation", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedConversation(repos.store, {
    id: "c_foreign",
    companyId: "other_co",
  });
  seedMessage(repos.store, {
    id: "m_in",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-19T10:00:00.000Z",
    occurredAt: "2026-07-19T10:00:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T10:30:00.000Z"),
  });

  await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-fail",
    actor: actor(),
  });
  await services.messages.failOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-fail",
    error: "graph_rejected",
  });
  assert.equal(
    (await repos.conversations.getById("c1"))!.hasFailedMessage,
    true
  );

  await assert.rejects(
    () => services.conversations.getDetail("c_foreign", actor()),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "not_found"
  );
});

await test("forbidden for unapproved / non-crm roles", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  const services = createWhatsAppInboxServices(repos);
  await assert.rejects(
    () =>
      services.conversations.getDetail(
        "c1",
        actor({ accountStatus: "Pending" })
      ),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
  await assert.rejects(
    () =>
      services.conversations.getDetail(
        "c1",
        actor({ role: "Technician" })
      ),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
});

// ---------------------------------------------------------------------------
// Step 3A Codex HOLD regressions
// ---------------------------------------------------------------------------

await test("3A: mismatched idempotency completion does not mutate conversation", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "pending" });
  seedConversation(repos.store, { id: "c2", status: "pending" });
  await repos.idempotency.claim({
    idempotencyKey: "key-scope",
    conversationId: "c1",
    companyId: "sunchaser",
  });
  const services = createWhatsAppInboxServices(repos);

  await assert.rejects(
    () =>
      services.messages.completeOutboundIdempotency({
        conversationId: "c2",
        idempotencyKey: "key-scope",
        messageId: "m_x",
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "conflict"
  );

  const c1 = await repos.conversations.getById("c1");
  const c2 = await repos.conversations.getById("c2");
  assert.equal(c1!.status, "pending");
  assert.equal(c2!.status, "pending");
  assert.equal(c1!.hasFailedMessage, false);
  assert.equal(
    (await repos.idempotency.getByKey("key-scope"))!.state,
    "processing"
  );
});

await test("3A: mismatched idempotency failure does not mutate conversation", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedConversation(repos.store, { id: "c2" });
  await repos.idempotency.claim({
    idempotencyKey: "key-fail-scope",
    conversationId: "c1",
    companyId: "sunchaser",
  });
  const services = createWhatsAppInboxServices(repos);

  await assert.rejects(
    () =>
      services.messages.failOutboundIdempotency({
        conversationId: "c2",
        idempotencyKey: "key-fail-scope",
        error: "x",
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "conflict"
  );
  assert.equal(
    (await repos.conversations.getById("c2"))!.hasFailedMessage,
    false
  );
  assert.equal(
    (await repos.idempotency.getByKey("key-fail-scope"))!.state,
    "processing"
  );
});

await test("3A: concurrent status race — one audit event, both end open", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    status: "archived",
    assignedUserId: "user_sales_1",
    lockVersion: 1,
  });
  const services = createWhatsAppInboxServices(repos);

  const [a, b] = await Promise.all([
    services.statuses.systemReopen("c1", { trigger: "webhook_callback" }),
    services.statuses.systemReopen("c1", {
      trigger: "read_path_reconciliation",
    }),
  ]);
  assert.equal(a.status, "open");
  assert.equal(b.status, "open");
  assert.equal(a.assignedUserId, "user_sales_1");
  const events = await repos.statuses.listByConversation("c1");
  assert.equal(events.length, 1);
  assert.equal(
    (await repos.conversations.getById("c1"))!.lockVersion,
    2
  );
});

await test("3A: audit failure rolls back status mutation", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", status: "open", lockVersion: 1 });
  repos.store.beforeStatusEventInsert = () => {
    throw new Error("audit boom");
  };
  const services = createWhatsAppInboxServices(repos);

  await assert.rejects(
    () =>
      services.statuses.userTransition("c1", {
        toStatus: "pending",
        actor: actor(),
        expectedLockVersion: 1,
      }),
    (err: unknown) => err instanceof Error && err.message === "audit boom"
  );

  const row = await repos.conversations.getById("c1");
  assert.equal(row!.status, "open");
  assert.equal(row!.lockVersion, 1);
  assert.equal((await repos.statuses.listByConversation("c1")).length, 0);
});

await test("3A: audit failure rolls back assignment mutation", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1", lockVersion: 1 });
  repos.store.beforeAssignmentEventInsert = () => {
    throw new Error("assignment audit boom");
  };
  const services = createWhatsAppInboxServices(repos, {
    assignees: memoryAssignees([
      { id: "user_sales_1", role: "Sales Executive", accountStatus: "Approved" },
    ]),
  });

  await assert.rejects(
    () =>
      services.assignments.setAssignment("c1", {
        assigneeUserId: "user_sales_1",
        actor: actor(),
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof Error && err.message === "assignment audit boom"
  );
  const row = await repos.conversations.getById("c1");
  assert.equal(row!.assignedUserId, null);
  assert.equal(row!.lockVersion, 1);
  assert.equal((await repos.assignments.listByConversation("c1")).length, 0);
});

await test("3A: duplicate CRM createLead race — one callback only", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const services = createWhatsAppInboxServices(repos, {
    createLead: async () => {
      calls += 1;
      await gate;
      return { leadId: `lead_${calls}` };
    },
  });

  const p1 = services.crmLinks.createLeadFromConversation("c1", {
    actor: actor(),
  });
  // Wait until exclusivity claim is held before starting the racer.
  for (let i = 0; i < 50; i += 1) {
    if (await repos.crmLinks.getByConversationId("c1")) break;
    await new Promise((r) => setTimeout(r, 1));
  }
  assert.ok(await repos.crmLinks.getByConversationId("c1"), "pending claim");

  const p2 = services.crmLinks.createLeadFromConversation("c1", {
    actor: actor(),
  });

  await assert.rejects(
    () => p2,
    (err: unknown) =>
      err instanceof InboxServiceError &&
      (err.code === "conflict" || err.code === "already_linked")
  );
  release();
  const created = await p1;
  assert.equal(created.kind, "created");
  assert.equal(calls, 1);
  assert.equal(
    (await repos.crmLinks.getByConversationId("c1"))!.linkedEntityId,
    "lead_1"
  );
});

await test("3A: invalid leadId rejected and claim released", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  const services = createWhatsAppInboxServices(repos, {
    createLead: async () => ({ leadId: "   " }),
  });

  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation("c1", { actor: actor() }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "invalid_argument"
  );
  assert.equal(await repos.crmLinks.getByConversationId("c1"), null);

  // Retry succeeds after release.
  const services2 = createWhatsAppInboxServices(repos, {
    createLead: async () => ({ leadId: "lead_ok" }),
  });
  const ok = await services2.crmLinks.createLeadFromConversation("c1", {
    actor: actor(),
  });
  assert.equal(ok.kind, "created");
});

await test("3A: replay completed idempotency after 24h free-form closed", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, { id: "c1" });
  seedMessage(repos.store, {
    id: "m_in",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-18T08:00:00.000Z",
    occurredAt: "2026-07-18T08:00:00.000Z",
  });

  let now = Date.parse("2026-07-18T09:00:00.000Z");
  const services = createWhatsAppInboxServices(repos, { now: () => now });
  await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-replay-24h",
    actor: actor(),
  });
  await services.messages.completeOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-replay-24h",
    messageId: "m_out",
  });

  // Window closed
  now = Date.parse("2026-07-19T12:00:00.000Z");
  await assert.rejects(
    () => services.messages.assertFreeFormAllowed("c1"),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "free_form_closed"
  );

  const replay = await services.messages.beginOutboundIdempotency({
    conversationId: "c1",
    idempotencyKey: "key-replay-24h",
    actor: actor(),
  });
  assert.equal(replay.kind, "replay_completed");
  assert.equal(replay.row.messageId, "m_out");
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll inbox service tests passed.");
