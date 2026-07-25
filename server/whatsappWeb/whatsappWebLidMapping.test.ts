/**
 * SYNC-14C-B — durable LID→phone mapping tests.
 * Run: npm run test:whatsapp-web-lid-mapping
 */
import assert from "node:assert/strict";
import { displayContactLabel } from "../../src/inbox/utils/format.ts";
import {
  InMemoryWhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import { attachContactDisplayFields } from "../whatsappTransport/whatsappInboxRepoSupport.ts";
import { BaileysInMemorySyncSource } from "./whatsappWebBaileysSyncSource.ts";
import { WhatsAppLidPhoneMap } from "./whatsappWebIdentity.ts";
import { persistWhatsAppWebInbound } from "./whatsappWebInbound.ts";
import {
  containsRawWhatsAppIdentifier,
  hydrateWhatsAppLidPhoneMap,
  rememberVerifiedLidMapping,
  resolveWhatsAppIdentityDurable,
} from "./whatsappWebLidMapping.ts";
import {
  defaultWhatsAppLidMappingScope,
  InMemoryWhatsAppLidPhoneMappingRepository,
  SupabaseWhatsAppLidPhoneMappingRepository,
  type UpsertVerifiedLidMappingResult,
  type WhatsAppLidPhoneMappingRepository,
} from "./whatsappWebLidMappingRepository.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import { normalizeBaileysInbound } from "./whatsappWebNormalize.ts";

const LID_A = "123456789012345@lid";
const LID_B = "999888777666555@lid";
const PHONE_A = "923001112233";
const PHONE_B = "923009998877";
const PHONE_A_JID = `${PHONE_A}@s.whatsapp.net`;
const PHONE_B_JID = `${PHONE_B}@s.whatsapp.net`;

const scopeA = defaultWhatsAppLidMappingScope({
  companyId: "sunchaser",
  sessionKey: "sunchaser",
});
const scopeOtherCompany = defaultWhatsAppLidMappingScope({
  companyId: "other_co",
  sessionKey: "sunchaser",
});

function assertNoRawIdsInValue(value: unknown, path = "root"): void {
  if (typeof value === "string") {
    assert.equal(
      containsRawWhatsAppIdentifier(value),
      false,
      `raw identifier at ${path}: blocked pattern`
    );
    assert.equal(value.includes("@lid"), false, `LID leaked at ${path}`);
    assert.equal(value.includes("@s.whatsapp.net"), false, `JID leaked at ${path}`);
    assert.equal(/^wlid_/i.test(value), false, `mapping id leaked at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoRawIdsInValue(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assert.equal(
        /lid|jid|waid/i.test(k) && k !== "valid",
        false,
        `forbidden key ${k} at ${path}`
      );
      assertNoRawIdsInValue(v, `${path}.${k}`);
    }
  }
}

/** In-memory table implementing the Supabase query surface used by the repo. */
function createLidMappingFakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();

  function liveKey(row: Record<string, unknown>): string {
    return [
      row.company_id,
      row.channel_phone_number_id,
      row.session_key,
      row.lid_normalized,
    ].join("\0");
  }

  function findLive(filters: Record<string, unknown>): Record<string, unknown> | null {
    for (const row of rows.values()) {
      if (row.company_id !== filters.company_id) continue;
      if (
        filters.channel_phone_number_id != null &&
        row.channel_phone_number_id !== filters.channel_phone_number_id
      ) {
        continue;
      }
      if (filters.session_key != null && row.session_key !== filters.session_key) {
        continue;
      }
      if (
        filters.lid_normalized != null &&
        row.lid_normalized !== filters.lid_normalized
      ) {
        continue;
      }
      if (filters.id != null && row.id !== filters.id) continue;
      if (filters.status_eq != null && row.status !== filters.status_eq) continue;
      if (
        Array.isArray(filters.status_in) &&
        !filters.status_in.includes(row.status)
      ) {
        continue;
      }
      return row;
    }
    return null;
  }

  function listLive(filters: Record<string, unknown>): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const row of rows.values()) {
      if (row.company_id !== filters.company_id) continue;
      if (
        filters.channel_phone_number_id != null &&
        row.channel_phone_number_id !== filters.channel_phone_number_id
      ) {
        continue;
      }
      if (filters.session_key != null && row.session_key !== filters.session_key) {
        continue;
      }
      if (
        Array.isArray(filters.status_in) &&
        !filters.status_in.includes(row.status)
      ) {
        continue;
      }
      out.push(row);
    }
    return out;
  }

  const from = (_table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "insert" | "update" = "select";
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    let wantSingle = false;
    let wantMaybe = false;

    const api: Record<string, unknown> = {};
    const chain = () => api;

    api.select = () => {
      op = op === "insert" || op === "update" ? op : "select";
      return chain();
    };
    api.insert = (payload: Record<string, unknown>) => {
      op = "insert";
      insertPayload = payload;
      return chain();
    };
    api.update = (payload: Record<string, unknown>) => {
      op = "update";
      updatePayload = payload;
      return chain();
    };
    api.eq = (col: string, val: unknown) => {
      if (col === "status") filters.status_eq = val;
      else filters[col] = val;
      return chain();
    };
    api.in = (col: string, vals: unknown[]) => {
      if (col === "status") filters.status_in = vals;
      return chain();
    };
    api.maybeSingle = async () => {
      wantMaybe = true;
      return execute();
    };
    api.single = async () => {
      wantSingle = true;
      return execute();
    };

    api.then = (
      resolve: (v: { data: unknown; error: unknown }) => void,
      reject?: (e: unknown) => void
    ) => {
      try {
        resolve(execute());
      } catch (e) {
        reject?.(e);
      }
    };

    function execute(): { data: unknown; error: unknown } {
      if (op === "insert" && insertPayload) {
        // Enforce live unique index.
        const conflict = [...rows.values()].find(
          (r) =>
            liveKey(r) === liveKey(insertPayload!) &&
            (r.status === "active" || r.status === "stale")
        );
        if (conflict) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const row = { ...insertPayload };
        rows.set(String(row.id), row);
        if (wantSingle) return { data: row, error: null };
        return { data: row, error: null };
      }

      if (op === "update" && updatePayload) {
        const target =
          findLive(filters) ||
          [...rows.values()].find((r) => {
            if (filters.company_id && r.company_id !== filters.company_id) {
              return false;
            }
            if (filters.id && r.id !== filters.id) return false;
            if (filters.status_eq && r.status !== filters.status_eq) return false;
            if (
              filters.lid_normalized &&
              r.lid_normalized !== filters.lid_normalized
            ) {
              return false;
            }
            if (
              filters.channel_phone_number_id &&
              r.channel_phone_number_id !== filters.channel_phone_number_id
            ) {
              return false;
            }
            if (filters.session_key && r.session_key !== filters.session_key) {
              return false;
            }
            return true;
          });
        if (!target) {
          return wantSingle
            ? { data: null, error: { message: "not found" } }
            : { data: null, error: null };
        }
        Object.assign(target, updatePayload);
        if (wantSingle || wantMaybe) return { data: { ...target }, error: null };
        return { data: null, error: null };
      }

      // select
      if (wantSingle || wantMaybe) {
        const row = findLive(filters);
        return { data: row ? { ...row } : null, error: null };
      }
      return { data: listLive(filters).map((r) => ({ ...r })), error: null };
    }

    return api;
  };

  return {
    from,
    __rows: rows,
  } as unknown as {
    from: (table: string) => unknown;
    __rows: Map<string, Record<string, unknown>>;
  };
}

async function runRepoSuite(
  label: string,
  createRepo: () => WhatsAppLidPhoneMappingRepository
): Promise<void> {
  {
    const repo = createRepo();
    const created = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    assert.equal(created.kind, "created");
    assert.equal(
      (created as Extract<UpsertVerifiedLidMappingResult, { kind: "created" }>)
        .mapping.phoneE164,
      PHONE_A
    );
    const resolved = await repo.resolvePhoneByLid(scopeA, LID_A);
    assert.equal(resolved, PHONE_A);
    console.log(`PASS (${label}): first verified mapping`);
  }

  {
    const repo = createRepo();
    await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    const again = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    assert.equal(again.kind, "unchanged");
    const rows =
      repo instanceof InMemoryWhatsAppLidPhoneMappingRepository
        ? repo.__all().filter((r) => r.lidNormalized === LID_A && r.status !== "superseded")
        : null;
    if (rows) assert.equal(rows.length, 1);
    console.log(`PASS (${label}): repeated identical mapping`);
  }

  {
    const repo = createRepo();
    await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    const conflict = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
    assert.equal(conflict.kind, "conflict");
    if (conflict.kind === "conflict") {
      assert.equal(conflict.mapping.phoneE164, PHONE_A);
      assert.equal(conflict.mapping.conflictCount >= 1, true);
    }
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
    console.log(`PASS (${label}): same LID with conflicting phone`);
  }

  {
    const repo = createRepo();
    await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    await repo.upsertVerifiedMapping(scopeOtherCompany, LID_A, PHONE_B);
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
    assert.equal(await repo.resolvePhoneByLid(scopeOtherCompany, LID_A), PHONE_B);
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_B), null);
    console.log(`PASS (${label}): cross-company isolation`);
  }

  {
    const repo = createRepo();
    await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
    assert.equal(await repo.markStale(scopeA, LID_A), true);
    // Stale still resolves.
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
    const remapped = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
    assert.equal(remapped.kind, "remapped");
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_B);
    console.log(`PASS (${label}): stale → remap`);
  }
}

await runRepoSuite(
  "in-memory",
  () => new InMemoryWhatsAppLidPhoneMappingRepository()
);

await runRepoSuite("supabase-fake", () => {
  const client = createLidMappingFakeSupabase();
  return new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
});

// Restart durability through repository mocks (empty ephemeral map + durable).
{
  const durable = new InMemoryWhatsAppLidPhoneMappingRepository();
  await durable.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);

  // Simulate process restart: fresh ephemeral map, same durable store.
  const freshMemory = new WhatsAppLidPhoneMap();
  assert.equal(
    freshMemory.resolveIdentity({ remoteJid: LID_A }),
    null
  );
  const hydrated = await hydrateWhatsAppLidPhoneMap(freshMemory, {
    repo: durable,
    scope: scopeA,
  });
  assert.equal(hydrated, 1);
  const after = freshMemory.resolveIdentity({ remoteJid: LID_A });
  assert.equal(after?.phoneE164, PHONE_A);
  assert.equal(after?.source, "ephemeral_lid_map");

  const viaDurable = await resolveWhatsAppIdentityDurable(
    { remoteJid: LID_A },
    {
      repo: durable,
      scope: scopeA,
      memory: new WhatsAppLidPhoneMap(),
    }
  );
  assert.equal(viaDurable?.phoneE164, PHONE_A);
  assert.equal(viaDurable?.source, "durable_lid_map");
  console.log("PASS: restart durability through repository mocks");
}

// LID inbound before and after mapping; no duplicate contact/conversation.
{
  const waRepo = new InMemoryWhatsAppRepository();
  const lidRepo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const lidMap = new WhatsAppLidPhoneMap();

  const before = await persistWhatsAppWebInbound(
    {
      providerMessageId: "m-lid-only-1",
      remoteJid: LID_A,
      fromMe: false,
      text: "hello before map",
      pushName: "Push",
      occurredAt: "2026-07-26T00:00:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "text",
    },
    { repo: waRepo, lidMap, lidMappingRepo: lidRepo, lidMappingScope: scopeA }
  );
  assert.equal(before.kind, "ignored");
  if (before.kind === "ignored") assert.equal(before.reason, "bad_jid");

  // Verified mapping arrives with phone alt.
  const mapped = await persistWhatsAppWebInbound(
    {
      providerMessageId: "m-with-alt-1",
      remoteJid: LID_A,
      remoteJidAlt: PHONE_A_JID,
      fromMe: false,
      text: "hello with alt",
      pushName: "Push",
      occurredAt: "2026-07-26T00:01:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "text",
    },
    { repo: waRepo, lidMap, lidMappingRepo: lidRepo, lidMappingScope: scopeA }
  );
  assert.equal(mapped.kind, "stored");
  // Allow async remember to settle.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await lidRepo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);

  // Simulate restart: new lidMap, same durable + contact repo.
  const lidMap2 = new WhatsAppLidPhoneMap();
  const afterRestart = await persistWhatsAppWebInbound(
    {
      providerMessageId: "m-lid-only-2",
      remoteJid: LID_A,
      fromMe: false,
      text: "hello after map",
      pushName: "Push",
      occurredAt: "2026-07-26T00:02:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "text",
    },
    {
      repo: waRepo,
      lidMap: lidMap2,
      lidMappingRepo: lidRepo,
      lidMappingScope: scopeA,
    }
  );
  assert.equal(afterRestart.kind, "stored");

  // Same contact + conversation (dedup by company+phone / company+channel+contact).
  const contacts = [...waRepo.contacts.values()];
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0]?.phoneE164, PHONE_A);
  assert.equal(contacts[0]?.phoneE164.includes("@"), false);
  const conversations = [...waRepo.conversations.values()];
  assert.equal(conversations.length, 1);
  if (mapped.kind === "stored" && afterRestart.kind === "stored") {
    assert.equal(afterRestart.conversationId, mapped.conversationId);
  }
  console.log("PASS: LID inbound before/after mapping; no duplicate contact/conversation");
}

// Sync source hydration + noteVerifiedIdentity; LID-only still skipped.
{
  const lidRepo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const source = new BaileysInMemorySyncSource();
  source.setLidMappingStore(lidRepo, scopeA);
  source.setConnected(true);
  source.ingestContacts([
    {
      id: LID_A,
      jid: PHONE_A_JID,
      lid: LID_A,
      name: "Saved",
      notify: "Push",
    },
  ]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await lidRepo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);

  // Restart sync source memory via hydrate.
  const source2 = new BaileysInMemorySyncSource();
  source2.setLidMappingStore(lidRepo, scopeA);
  const n = await source2.hydrateLidMappings();
  assert.equal(n, 1);
  source2.setConnected(true);
  source2.ingestMessages([
    {
      key: { id: "S1", remoteJid: LID_A, fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "via durable" },
    },
  ]);
  const msgs = await source2.fetchMessages(PHONE_A_JID, {
    limit: 50,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 1);

  const lidOnly = source2.ingestContacts([
    { id: LID_B, name: "No phone", notify: "X" },
  ]);
  assert.equal(lidOnly.length, 0);
  console.log("PASS: sync-source durable hydrate; LID-only skipped");
}

// Conflict does not adopt bad phone into memory when using rememberVerified.
{
  const lidRepo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const memory = new WhatsAppLidPhoneMap();
  await rememberVerifiedLidMapping(LID_A, PHONE_A, {
    repo: lidRepo,
    scope: scopeA,
    memory,
  });
  const conflict = await rememberVerifiedLidMapping(LID_A, PHONE_B, {
    repo: lidRepo,
    scope: scopeA,
    memory,
  });
  assert.equal(conflict.kind, "conflict");
  assert.equal(memory.resolvePhoneJid(LID_A), PHONE_A_JID);
  console.log("PASS: conflict keeps durable winner in memory");
}

// Mapping failure must not throw / disconnect semantics.
{
  const failingRepo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => {
      throw new Error("db down");
    },
    upsertVerifiedMapping: async () => {
      throw new Error("db down");
    },
    markStale: async () => {
      throw new Error("db down");
    },
    listActiveForHydration: async () => {
      throw new Error("db down");
    },
  };
  const memory = new WhatsAppLidPhoneMap();
  const result = await rememberVerifiedLidMapping(LID_A, PHONE_A, {
    repo: failingRepo,
    scope: scopeA,
    memory,
  });
  assert.equal(result.kind, "error");
  // Ephemeral still usable; socket path would continue.
  assert.equal(memory.resolvePhoneJid(LID_A), PHONE_A_JID);

  const resolved = await resolveWhatsAppIdentityDurable(
    { remoteJid: LID_A },
    { repo: failingRepo, scope: scopeA, memory: new WhatsAppLidPhoneMap() }
  );
  assert.equal(resolved, null);

  const source = new BaileysInMemorySyncSource();
  source.setLidMappingStore(failingRepo, scopeA);
  // Must not throw.
  source.setConnected(true, PHONE_A_JID);
  source.ingestContacts([
    { id: LID_A, jid: PHONE_A_JID, lid: LID_A, name: "X" },
  ]);
  console.log("PASS: mapping failure does not throw / disconnect");
}

// No raw identifier in DTO / log meta / UI label.
{
  const waRepo = new InMemoryWhatsAppRepository();
  const contact = await waRepo.resolveOrCreateContact({
    phoneE164: PHONE_A,
    profileName: "Ada",
  });
  const channel = await waRepo.resolveOrCreateChannel({
    phoneNumberId: scopeA.channelPhoneNumberId,
    displayPhoneNumber: null,
    wabaId: null,
  });
  const conversation = await waRepo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });

  const dtoRows = await attachContactDisplayFields(
    [
      {
        id: conversation.id,
        companyId: "sunchaser",
        channelId: channel.id,
        contactId: contact.id,
        status: "open",
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedUserId: null,
        assignedAt: null,
        assignedBy: null,
        lockVersion: 1,
        hasFailedMessage: false,
        aiOwnershipState: "AI_SHADOW",
      },
    ],
    {
      contactLookup: (id) => {
        const c = waRepo.contacts.get(id);
        return c
          ? { profileName: c.profileName, phoneE164: c.phoneE164 }
          : null;
      },
    }
  );
  assertNoRawIdsInValue({
    profileName: dtoRows[0]?.profileName,
    phoneE164: dtoRows[0]?.phoneE164,
    contactId: dtoRows[0]?.contactId,
  });
  // phoneE164 digits are allowed on DTO; ensure not a JID/LID.
  assert.equal(dtoRows[0]?.phoneE164, PHONE_A);
  assert.equal(String(dtoRows[0]?.phoneE164).includes("@"), false);

  const label = displayContactLabel({
    profileName: dtoRows[0]?.profileName,
    phoneE164: dtoRows[0]?.phoneE164,
  });
  assert.equal(label, "Ada");
  assert.equal(label.includes("@"), false);
  assert.equal(displayContactLabel({ profileName: LID_A }), "Unknown WhatsApp contact");

  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (line: string) => {
    logs.push(String(line));
  };
  try {
    logWhatsAppWeb("info", "lid_mapping_created", {
      outcome: "lid_mapping_created",
      phone: PHONE_A,
      jid: PHONE_A_JID,
      lid: LID_A,
      conflictCount: 0,
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]!);
  assert.equal(parsed.phone, undefined);
  assert.equal(parsed.jid, undefined);
  assert.equal(parsed.lid, undefined);
  assert.equal(parsed.outcome, "lid_mapping_created");
  assert.equal(JSON.stringify(parsed).includes("@lid"), false);
  assert.equal(JSON.stringify(parsed).includes(PHONE_A), false);

  // Normalize ignore for LID-only never fabricates digit phone from LID user.
  const ignored = normalizeBaileysInbound({
    providerMessageId: "x",
    remoteJid: LID_A,
    fromMe: false,
    text: "hi",
    pushName: null,
    occurredAt: "2026-07-26T00:00:00.000Z",
    isGroup: false,
    isStatusOrNewsletter: false,
    rawType: "text",
  });
  assert.equal(ignored.kind, "ignore");

  console.log("PASS: no raw identifier in DTO/log/UI");
}

// Reject invalid LID-as-phone writes.
{
  const repo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const bad = await repo.upsertVerifiedMapping(scopeA, PHONE_A_JID, PHONE_A);
  assert.equal(bad.kind, "rejected");
  const badPhone = await repo.upsertVerifiedMapping(scopeA, LID_A, LID_A);
  assert.equal(badPhone.kind, "rejected");
  console.log("PASS: reject non-LID / LID-as-phone writes");
}

console.log("PASS: SYNC-14C-B durable LID mapping suite complete");
