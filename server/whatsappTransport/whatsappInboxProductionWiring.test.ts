/**
 * Production inbox DI wiring tests (RC-1.2.1 hardening).
 * Run: npm run test:whatsapp-inbox-production-wiring
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import {
  buildProductionInboxServiceOptions,
  buildProductionWebhookAutoLinkLead,
} from "./whatsappInboxProductionWiring.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import {
  normalizePakistanPhone,
  pakistanMobileLookupForms,
  phonesMatch,
} from "../../src/lib/phoneNormalize.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const actor = {
  id: "u-staff",
  username: "staff",
  name: "Staff",
  email: "staff@test.com",
  role: "Sales Executive",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt" as const,
};

function staffUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-staff",
    username: "staff",
    name: "Staff",
    email: "staff@test.com",
    role: "Sales Executive",
    account_status: "Approved",
    company_id: "sunchaser",
    ...overrides,
  };
}

async function seedWaConversation(
  wa: InMemoryWhatsAppRepository,
  phoneE164: string,
  profileName = "Inbox Contact"
) {
  const channel = await wa.resolveOrCreateChannel({
    phoneNumberId: "12345678901",
    displayPhoneNumber: "+1",
  });
  const contact = await wa.resolveOrCreateContact({
    phoneE164,
    profileName,
  });
  const conversation = await wa.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  return { channel, contact, conversation };
}

function seedInboxConversation(
  repos: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>,
  conversation: { id: string; channelId: string; contactId: string },
  overrides: { companyId?: string; lockVersion?: number } = {}
) {
  const now = "2026-07-22T10:00:00.000Z";
  repos.store.conversations.set(conversation.id, {
    id: conversation.id,
    companyId: overrides.companyId ?? "sunchaser",
    channelId: conversation.channelId,
    contactId: conversation.contactId,
    status: "open",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: overrides.lockVersion ?? 1,
    hasFailedMessage: false,
  });
}

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

await test("phone: equivalent PK forms normalize identically", () => {
  const forms = [
    "03001234567",
    "3001234567",
    "923001234567",
    "+923001234567",
    "00923001234567",
    "0300-123-4567",
    "+92 300 1234567",
  ];
  for (const f of forms) {
    assert.equal(normalizePakistanPhone(f), "923001234567", f);
  }
  assert.equal(phonesMatch("03-001234567", "+92 300 1234567"), true);
  assert.deepEqual(pakistanMobileLookupForms("923001234567"), [
    "923001234567",
    "+923001234567",
    "00923001234567",
    "03001234567",
    "3001234567",
  ]);
});

await test("phone: lookup forms include all five accepted exact storage variants", () => {
  const forms = pakistanMobileLookupForms("03001234567");
  assert.equal(forms.length, 5);
  assert.deepEqual(forms, [
    "923001234567",
    "+923001234567",
    "00923001234567",
    "03001234567",
    "3001234567",
  ]);
  assert.equal(new Set(forms).size, 5);
  assert.deepEqual(pakistanMobileLookupForms("not-a-phone"), []);
});

await test("phone: invalid values rejected", () => {
  assert.equal(normalizePakistanPhone(""), null);
  assert.equal(normalizePakistanPhone("123"), null);
  assert.equal(normalizePakistanPhone("00000000000"), null);
  assert.equal(normalizePakistanPhone("921111111111"), null); // not mobile 3xx
  assert.equal(normalizePakistanPhone("abc03001234567xyz"), null);
  assert.equal(normalizePakistanPhone("0300<script>1234567"), null);
  assert.equal(normalizePakistanPhone("++923001234567"), null);
  assert.equal(normalizePakistanPhone("+03001234567"), null);
  assert.equal(normalizePakistanPhone("92300123456789"), null);
  assert.equal(normalizePakistanPhone("0092303001234567"), null);
  // Foreign country codes — never reinterpret as PK mobiles
  assert.equal(normalizePakistanPhone("+14155552671"), null);
  assert.equal(normalizePakistanPhone("+447911123456"), null);
  assert.equal(normalizePakistanPhone("001234567890"), null);
  assert.equal(normalizePakistanPhone("+971501234567"), null);
});

await test("phone: structural placeholder patterns rejected", () => {
  const placeholders = [
    "00000000000",
    "03000000000",
    "03111111111",
    "03222222222",
    "03333333333",
    "03444444444",
    "03555555555",
    "923000000000",
    "+923111111111",
  ];
  for (const p of placeholders) {
    assert.equal(normalizePakistanPhone(p), null, p);
  }
  // Legitimate numbers with some repeated digits still accepted
  assert.equal(normalizePakistanPhone("03001112233"), "923001112233");
  assert.equal(normalizePakistanPhone("03331234567"), "923331234567");
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

await test("assign: valid same-company user succeeds", async () => {
  const localDb = { users: [staffUser()], leads: [] } as any;
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const row = await services.assignments.setAssignment(seeded.conversation.id, {
    assigneeUserId: "u-staff",
    actor,
    expectedLockVersion: 1,
  });
  assert.equal(row.assignedUserId, "u-staff");
});

await test("assign: unknown user rejected", async () => {
  const localDb = { users: [staffUser()], leads: [] } as any;
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.assignments.setAssignment(seeded.conversation.id, {
        assigneeUserId: "missing",
        actor,
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError &&
      err.code === "invalid_argument" &&
      /not found/i.test(err.message)
  );
});

await test("assign: inactive user rejected", async () => {
  const localDb = {
    users: [staffUser({ account_status: "Pending" })],
    leads: [],
  } as any;
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.assignments.setAssignment(seeded.conversation.id, {
        assigneeUserId: "u-staff",
        actor,
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError &&
      err.code === "invalid_argument" &&
      /Approved/i.test(err.message)
  );
});

await test("assign: non-default company scope fails closed (users have no company_id)", async () => {
  // Schema: public.users has no company_id. Isolation is single-tenant DEFAULT only.
  const localDb = { users: [staffUser()], leads: [] } as any;
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation, {
    companyId: "other-company",
  });
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  assert.equal(await opts.assignees!.getById("u-staff", "other-company"), null);
  const services = createWhatsAppInboxServices(repos, {
    ...opts,
    companyId: "other-company",
  });
  await assert.rejects(
    () =>
      services.assignments.setAssignment(seeded.conversation.id, {
        assigneeUserId: "u-staff",
        actor,
        expectedLockVersion: 1,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError &&
      err.code === "invalid_argument" &&
      /not found/i.test(err.message)
  );
});

await test("assign: valid default-company user succeeds without users.company_id", async () => {
  const localDb = {
    users: [
      {
        id: "u-staff",
        username: "staff",
        name: "Staff",
        email: "staff@test.com",
        role: "Sales Executive",
        account_status: "Approved",
        // intentionally no company_id — matches production schema
      },
    ],
    leads: [],
  } as any;
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const row = await services.assignments.setAssignment(seeded.conversation.id, {
    assigneeUserId: "u-staff",
    actor,
    expectedLockVersion: 1,
  });
  assert.equal(row.assignedUserId, "u-staff");
});

await test("assign: assignee lookup database failure propagates", async () => {
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => {
      throw new Error("db down");
    },
    whatsappRepo: new InMemoryWhatsAppRepository(),
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  await assert.rejects(
    () => opts.assignees!.getById("u-staff", "sunchaser"),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
});

// ---------------------------------------------------------------------------
// Create lead
// ---------------------------------------------------------------------------

await test("createLead: valid lead creation succeeds", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233", "Ali");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const localDb = { users: [staffUser()], leads: [] } as any;
  let persisted: { phone: string; name: string } | null = null;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persisted = { phone: lead.phone, name: lead.name };
      localDb.leads.push({ id: lead.id, phone: lead.phone, name: lead.name });
      return { leadId: lead.id };
    },
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const created = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: true }
  );
  assert.equal(created.kind, "created");
  assert.equal(persisted?.phone, "923001112233");
  assert.equal(persisted?.name, "Ali");
});

await test("createLead: duplicate 03... vs +923... detected", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "+923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const localDb = {
    users: [staffUser()],
    leads: [{ id: "lead-existing", phone: "03001112233", deleted_at: null }],
  } as any;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async () => {
      throw new Error("should not persist");
    },
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const result = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: false }
  );
  assert.equal(result.kind, "duplicate_suggestion");
  if (result.kind === "duplicate_suggestion") {
    assert.equal(result.suggestion.linkedEntityId, "lead-existing");
  }
});

await test("createLead: duplicate 03... vs 923... detected", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "03001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const localDb = {
    users: [staffUser()],
    leads: [{ id: "lead-existing", phone: "923001112233" }],
  } as any;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async () => {
      throw new Error("should not persist");
    },
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const result = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor }
  );
  assert.equal(result.kind, "duplicate_suggestion");
});

await test("createLead: soft-deleted lead is ignored", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const localDb = {
    users: [staffUser()],
    leads: [
      {
        id: "lead-deleted",
        phone: "03001112233",
        deleted_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  } as any;
  let createdId: string | null = null;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      createdId = lead.id;
      return { leadId: lead.id };
    },
  });
  const services = createWhatsAppInboxServices(repos, opts);
  const result = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor }
  );
  assert.equal(result.kind, "created");
  assert.ok(createdId);
});

await test("createLead: duplicate pick is deterministic (oldest created_at, then id)", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  const localDb = {
    users: [staffUser()],
    leads: [
      {
        id: "lead-z",
        phone: "03001112233",
        deleted_at: null,
        created_at: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "lead-a",
        phone: "+923001112233",
        deleted_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "lead-b",
        phone: "923001112233",
        deleted_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  } as any;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => localDb,
    whatsappRepo: wa,
    persistLead: async () => {
      throw new Error("should not persist");
    },
  });
  const suggestion = await opts.findDuplicate!({
    conversationId: seeded.conversation.id,
    companyId: "sunchaser",
    actor,
  });
  assert.ok(suggestion);
  // Same created_at → lexicographically smaller id wins (lead-a before lead-b)
  assert.equal(suggestion!.linkedEntityId, "lead-a");
});

await test("createLead: duplicate lookup database failure does not create a lead", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);
  let persistCalls = 0;

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => {
      throw new Error("db boom");
    },
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persistCalls += 1;
      return { leadId: lead.id };
    },
  });
  // Assignees path may also hit resolveLocalDb — use findDuplicate directly
  await assert.rejects(
    () =>
      opts.findDuplicate!({
        conversationId: seeded.conversation.id,
        companyId: "sunchaser",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
  assert.equal(persistCalls, 0);

  // Service path: duplicate lookup failure before claim → no link row
  const services = createWhatsAppInboxServices(repos, {
    ...opts,
    assignees: {
      async getById() {
        return {
          id: "u-staff",
          role: "Sales Executive",
          accountStatus: "Approved",
          companyId: "sunchaser",
        };
      },
    },
  });
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(seeded.conversation.id, {
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
  assert.equal(
    await repos.crmLinks.getByConversationId(seeded.conversation.id),
    null
  );
});

await test("createLead: missing conversation/contact bundle fails", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  await assert.rejects(
    () =>
      opts.createLead!({
        conversationId: "missing-conv",
        companyId: "sunchaser",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError &&
      err.code === "invalid_argument" &&
      /bundle/i.test(err.message)
  );
});

await test("createLead: missing/invalid phone fails; no synthetic phone", async () => {
  const wa = new InMemoryWhatsAppRepository();
  // Seed contact with unusable phone by mutating after create
  const channel = await wa.resolveOrCreateChannel({
    phoneNumberId: "12345678901",
    displayPhoneNumber: "+1",
  });
  const contact = await wa.resolveOrCreateContact({
    phoneE164: "923001112233",
    profileName: "X",
  });
  const conversation = await wa.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  // Break phone on in-memory contact
  (wa as any).contacts.get(contact.id).phoneE164 = "";

  let persisted = false;
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persisted = true;
      assert.notEqual(lead.phone, "00000000000");
      return { leadId: lead.id };
    },
  });
  await assert.rejects(
    () =>
      opts.createLead!({
        conversationId: conversation.id,
        companyId: "sunchaser",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError &&
      err.code === "invalid_argument" &&
      /phone/i.test(err.message)
  );
  assert.equal(persisted, false);

  (wa as any).contacts.get(contact.id).phoneE164 = "00000000000";
  await assert.rejects(
    () =>
      opts.createLead!({
        conversationId: conversation.id,
        companyId: "sunchaser",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "invalid_argument"
  );
  assert.equal(persisted, false);
});

await test("createLead: persistence failure leaves workflow retry-safe", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async () => {
      throw new Error("persist exploded");
    },
  });
  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(seeded.conversation.id, {
        actor,
        forceCreate: true,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
  // Claim released
  assert.equal(
    await repos.crmLinks.getByConversationId(seeded.conversation.id),
    null
  );

  // Retry succeeds after fixing persist
  let ok = false;
  const opts2 = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      ok = true;
      return { leadId: lead.id };
    },
  });
  const services2 = createWhatsAppInboxServices(repos, opts2);
  const created = await services2.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: true }
  );
  assert.equal(created.kind, "created");
  assert.equal(ok, true);
});

await test("createLead: forceCreate does not bypass phone integrity", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const channel = await wa.resolveOrCreateChannel({
    phoneNumberId: "12345678901",
    displayPhoneNumber: "+1",
  });
  const contact = await wa.resolveOrCreateContact({
    phoneE164: "923001112233",
    profileName: "X",
  });
  const conversation = await wa.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  (wa as any).contacts.get(contact.id).phoneE164 = "bad";

  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, conversation);
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () =>
      ({
        users: [staffUser()],
        leads: [{ id: "dup", phone: "923001112233" }],
      }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(conversation.id, {
        actor,
        forceCreate: true,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "invalid_argument"
  );
});

await test("company: non-default company createLead/findDuplicate fail closed", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923001112233");
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  await assert.rejects(
    () =>
      opts.createLead!({
        conversationId: seeded.conversation.id,
        companyId: "other-company",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
  await assert.rejects(
    () =>
      opts.findDuplicate!({
        conversationId: seeded.conversation.id,
        companyId: "other-company",
        actor,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "forbidden"
  );
});

await test("company: assignee directory scopes lookup by companyId", async () => {
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    persistLead: async (lead) => ({ leadId: lead.id }),
  });
  const same = await opts.assignees!.getById("u-staff", "sunchaser");
  assert.ok(same);
  assert.equal(same!.companyId, "sunchaser");
  const cross = await opts.assignees!.getById("u-staff", "other-company");
  assert.equal(cross, null);
});

await test("createLead: link failure after persist recovers or enables duplicate link", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923009998877");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  const leads: Array<{
    id: string;
    phone: string;
    deleted_at: null;
    created_at: string;
  }> = [];
  let persistCount = 0;
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persistCount += 1;
      leads.push({
        id: lead.id,
        phone: lead.phone,
        deleted_at: null,
        created_at: lead.createdAt,
      });
      return { leadId: lead.id };
    },
  });

  const originalUpsert = repos.crmLinks.upsert.bind(repos.crmLinks);
  repos.crmLinks.upsert = async (input) => {
    if (!input.linkedEntityId.startsWith("pending_lead:") && input.linkedEntityId !== "__pending_create_lead__") {
      throw new Error("crm link write failed");
    }
    return originalUpsert(input);
  };

  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(seeded.conversation.id, {
        actor,
        forceCreate: true,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
  assert.equal(persistCount, 1);
  assert.equal(leads.length, 1);
  const pendingRow = await repos.crmLinks.getByConversationId(seeded.conversation.id);
  assert.ok(pendingRow);
  assert.equal(pendingRow?.linkedEntityId, `pending_lead:${leads[0]!.id}`);

  // Restore real upsert; retry WITHOUT forceCreate recovers exact correlated leadId
  repos.crmLinks.upsert = originalUpsert;
  const services2 = createWhatsAppInboxServices(repos, opts);
  const result = await services2.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: false }
  );
  assert.equal(result.kind, "created");
  if (result.kind === "created") {
    assert.equal(result.leadId, leads[0]!.id);
  }
  assert.equal(persistCount, 1, "must not create a second lead");
});

await test("createLead: forceCreate retry after link failure never creates second lead", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923008887766");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  const leads: Array<{
    id: string;
    phone: string;
    deleted_at: null;
    created_at: string;
  }> = [];
  let persistCount = 0;
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persistCount += 1;
      leads.push({
        id: lead.id,
        phone: lead.phone,
        deleted_at: null,
        created_at: lead.createdAt,
      });
      return { leadId: lead.id };
    },
  });

  const originalUpsert = repos.crmLinks.upsert.bind(repos.crmLinks);
  let linkFailed = false;
  repos.crmLinks.upsert = async (input) => {
    if (input.linkedEntityId === leads[0]?.id || (!linkFailed && input.linkedEntityId.startsWith("lead-"))) {
      linkFailed = true;
      throw new Error("crm link write failed permanently");
    }
    return originalUpsert(input);
  };

  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(seeded.conversation.id, {
        actor,
        forceCreate: true,
      }),
    (err: unknown) =>
      err instanceof InboxServiceError && err.code === "service_unavailable"
  );
  assert.equal(persistCount, 1);

  // Restore working upsert; identical retry including forceCreate=true recovers exact leadId
  repos.crmLinks.upsert = originalUpsert;
  const recovered = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: true }
  );
  assert.equal(recovered.kind, "created");
  if (recovered.kind === "created") {
    assert.equal(recovered.leadId, leads[0]!.id);
  }
  assert.equal(persistCount, 1, "forceCreate must not create a second CRM lead");
  assert.ok(await repos.crmLinks.getByConversationId(seeded.conversation.id));
});

await test("createLead: pending-claim cleanup failure is service_unavailable", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923007778899");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async () => {
      throw new Error("persist exploded");
    },
  });
  repos.crmLinks.deleteByConversationId = async () => {
    throw new Error("delete claim: ECONNRESET postgres://internal/db");
  };

  const services = createWhatsAppInboxServices(repos, opts);
  await assert.rejects(
    () =>
      services.crmLinks.createLeadFromConversation(seeded.conversation.id, {
        actor,
        forceCreate: true,
      }),
    (err: unknown) => {
      if (!(err instanceof InboxServiceError)) return false;
      if (err.code !== "service_unavailable") return false;
      // Must not leak raw repository/infra exception text
      assert.equal(/ECONNRESET|postgres:\/\//i.test(err.message), false);
      assert.match(err.message, /cleanup failed/i);
      return true;
    }
  );
});

await test("createLead: transient link failure recovers without second persist", async () => {
  const wa = new InMemoryWhatsAppRepository();
  const seeded = await seedWaConversation(wa, "923007776655");
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedInboxConversation(repos, seeded.conversation);

  let persistCount = 0;
  let upsertAttempts = 0;
  const opts = buildProductionInboxServiceOptions({
    resolveLocalDb: () => ({ users: [staffUser()], leads: [] }) as any,
    whatsappRepo: wa,
    persistLead: async (lead) => {
      persistCount += 1;
      return { leadId: lead.id };
    },
  });
  const realUpsert = repos.crmLinks.upsert.bind(repos.crmLinks);
  repos.crmLinks.upsert = async (input) => {
    upsertAttempts += 1;
    if (upsertAttempts === 3) throw new Error("transient link failure");
    return realUpsert(input);
  };

  const services = createWhatsAppInboxServices(repos, opts);
  const created = await services.crmLinks.createLeadFromConversation(
    seeded.conversation.id,
    { actor, forceCreate: true }
  );
  assert.equal(created.kind, "created");
  assert.equal(persistCount, 1);
  assert.equal(upsertAttempts, 4);
  assert.ok(await repos.crmLinks.getByConversationId(seeded.conversation.id));
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

await test("composition: server mounts hardened inbox router once", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(here, "../../server.ts");
  const src = fs.readFileSync(serverPath, "utf8");
  assert.match(src, /buildProductionInboxServiceOptions/);
  const mounts = src.match(/createWhatsAppInboxRouter\s*\(/g) || [];
  assert.equal(mounts.length, 1);
  assert.match(src, /persistLead:\s*persistPublicMarketingLead/);
  // Public lead mount remains separate
  assert.match(src, /createPublicLeadRouter/);
});

await test("composition: inbox list availability is wired Meta-only (no QR session)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(here, "../../server.ts");
  const src = fs.readFileSync(serverPath, "utf8");
  assert.match(src, /createWhatsAppInboxListAvailabilityResolver/);
  assert.match(src, /resolveListAvailability:\s*createWhatsAppInboxListAvailabilityResolver/);
  // The unofficial WhatsApp Web (Baileys) session must not be wired into the inbox.
  assert.equal(src.includes("getQrConnectionStatus"), false);
  assert.equal(src.includes("whatsappWebSession"), false);
  assert.equal(src.includes("getSharedWhatsAppWebSession"), false);
  assert.ok(src.indexOf("createWhatsAppInboxRouter({") >= 0);
});

await test("production wiring: signed inbound customer message auto-links lead and duplicate does not repeat lead creation", async () => {
  const waRepo = new InMemoryWhatsAppRepository();
  const persistedLeads: any[] = [];

  const deps = {
    resolveLocalDb: () => ({}) as any,
    persistLead: async (lead: any) => {
      persistedLeads.push(lead);
      return { leadId: lead.id };
    },
    whatsappRepo: waRepo,
  };

  const inboxRepos = createInMemoryWhatsAppInboxRepositories();
  const autoLinkLead = buildProductionWebhookAutoLinkLead(deps, inboxRepos);

  const channel = await waRepo.resolveOrCreateChannel({
    phoneNumberId: "PN123",
    displayPhoneNumber: "+923001234567",
  });
  const contact = await waRepo.resolveOrCreateContact({
    phoneE164: "923001234567",
    profileName: "Ali Test",
  });
  const conversation = await waRepo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  seedInboxConversation(inboxRepos, conversation);

  // Auto-link lead on message acceptance
  const linkRes = await autoLinkLead(conversation.id);
  assert.ok(linkRes.leadId);
  assert.equal(linkRes.created, true);
  assert.equal(persistedLeads.length, 1);

  // Duplicate delivery attempt
  const linkResDuplicate = await autoLinkLead(conversation.id);
  assert.equal(linkResDuplicate.leadId, linkRes.leadId);
  assert.equal(linkResDuplicate.created, false);
  assert.equal(persistedLeads.length, 1);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll production inbox wiring tests passed.");
