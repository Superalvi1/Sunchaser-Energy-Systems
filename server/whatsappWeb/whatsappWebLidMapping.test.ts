/**
 * SYNC-14C-B / R1 — durable LID→phone mapping tests.
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
  createLidMappingPersistQueue,
  hydrateWhatsAppLidPhoneMap,
  LID_MAPPING_PERSIST_OVERFLOW_OUTCOME,
  rememberVerifiedLidMapping,
  resolveWhatsAppIdentityDurable,
  scheduleRememberVerifiedLidMapping,
  WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY,
  WHATSAPP_LID_MAPPING_PERSIST_MAX_PENDING,
} from "./whatsappWebLidMapping.ts";
import {
  defaultWhatsAppLidMappingScope,
  InMemoryWhatsAppLidPhoneMappingRepository,
  normalizeMappingPhoneE164,
  SupabaseWhatsAppLidPhoneMappingRepository,
  WHATSAPP_UPSERT_VERIFIED_LID_PHONE_MAPPING_RPC,
  type UpsertVerifiedLidMappingResult,
  type WhatsAppLidPhoneMappingRepository,
} from "./whatsappWebLidMappingRepository.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import { normalizeBaileysInbound } from "./whatsappWebNormalize.ts";

const LID_A = "123456789012345@lid";
const LID_B = "999888777666555@lid";
const PHONE_A = "923001112233";
const PHONE_B = "923009998877";
const PHONE_C = "923007776655";
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

type FakeLidClient = {
  from: (table: string) => unknown;
  rpc: (
    name: string,
    params: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>;
  __rows: Map<string, Record<string, unknown>>;
  __failNextRemapInsert: boolean;
  __rpcHold: Map<string, { release: () => void; promise: Promise<void> }>;
  __beginRpcHold: (key: string) => Promise<void>;
  __releaseRpcHold: (key: string) => void;
};

/**
 * In-memory table + atomic RPC twin of
 * public.whatsapp_upsert_verified_lid_phone_mapping.
 */
function createLidMappingFakeSupabase(): FakeLidClient {
  const rows = new Map<string, Record<string, unknown>>();
  const lidLocks = new Map<string, Promise<void>>();
  const rpcHold = new Map<string, { release: () => void; promise: Promise<void> }>();
  let failNextRemapInsert = false;

  function liveKey(row: Record<string, unknown>): string {
    return [
      row.company_id,
      row.channel_phone_number_id,
      row.session_key,
      row.lid_normalized,
    ].join("\0");
  }

  function scopeLidKey(
    companyId: string,
    channel: string,
    session: string,
    lid: string
  ): string {
    return [companyId, channel, session, lid].join("\0");
  }

  async function withLidLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = lidLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    lidLocks.set(key, next);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (lidLocks.get(key) === next) lidLocks.delete(key);
    }
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

  async function atomicUpsertRpc(
    params: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }> {
    const companyId = String(params.p_company_id || "").trim();
    const channel = String(params.p_channel_phone_number_id || "").trim();
    const session = String(params.p_session_key || "").trim();
    const lid = String(params.p_lid_normalized || "").trim();
    const phone = String(params.p_phone_e164 || "").trim();
    const mappingId = String(params.p_mapping_id || "").trim() || `wlid_${rows.size + 1}`;

    if (!companyId || !channel || !session) {
      return {
        data: { kind: "rejected", reason: "invalid_scope", mapping: null },
        error: null,
      };
    }
    if (!lid || !/@lid$/i.test(lid)) {
      return {
        data: { kind: "rejected", reason: "invalid_lid", mapping: null },
        error: null,
      };
    }
    if (!/^[0-9]{6,}$/.test(phone)) {
      return {
        data: { kind: "rejected", reason: "invalid_phone", mapping: null },
        error: null,
      };
    }

    const key = scopeLidKey(companyId, channel, session, lid);
    return withLidLock(key, async () => {
      const hold = rpcHold.get(key);
      if (hold) await hold.promise;

      const now = new Date().toISOString();
      const live = findLive({
        company_id: companyId,
        channel_phone_number_id: channel,
        session_key: session,
        lid_normalized: lid,
        status_in: ["active", "stale"],
      });

      if (!live) {
        const created = {
          id: mappingId,
          company_id: companyId,
          channel_phone_number_id: channel,
          session_key: session,
          lid_normalized: lid,
          phone_e164: phone,
          status: "active",
          verified_at: now,
          last_resolved_at: now,
          conflict_count: 0,
          superseded_at: null,
          created_at: now,
          updated_at: now,
        };
        // Cross-process-style unique race on live key.
        const conflict = [...rows.values()].find(
          (r) =>
            liveKey(r) === liveKey(created) &&
            (r.status === "active" || r.status === "stale")
        );
        if (conflict) {
          return {
            data: { kind: "error", error_code: "insert_unique_race", mapping: null },
            error: null,
          };
        }
        rows.set(String(created.id), created);
        return { data: { kind: "created", mapping: { ...created } }, error: null };
      }

      if (live.phone_e164 === phone) {
        Object.assign(live, {
          status: live.status === "stale" ? "active" : live.status,
          last_resolved_at: now,
          updated_at: now,
          superseded_at: null,
        });
        return { data: { kind: "unchanged", mapping: { ...live } }, error: null };
      }

      if (live.status === "stale") {
        // Atomic remap: stage supersede + insert; roll back on insert failure.
        const prior = { ...live };
        if (failNextRemapInsert) {
          failNextRemapInsert = false;
          // Do not mutate durable state — stale remains resolvable.
          Object.assign(live, prior);
          return {
            data: {
              kind: "error",
              error_code: "remap_insert_failed",
              mapping: null,
            },
            error: null,
          };
        }
        Object.assign(live, {
          status: "superseded",
          superseded_at: now,
          updated_at: now,
        });
        const created = {
          id: mappingId,
          company_id: companyId,
          channel_phone_number_id: channel,
          session_key: session,
          lid_normalized: lid,
          phone_e164: phone,
          status: "active",
          verified_at: now,
          last_resolved_at: now,
          conflict_count: 0,
          superseded_at: null,
          created_at: now,
          updated_at: now,
        };
        rows.set(String(created.id), created);
        return { data: { kind: "remapped", mapping: { ...created } }, error: null };
      }

      // Atomic conflict_count increment under the same lock.
      Object.assign(live, {
        conflict_count: Number(live.conflict_count ?? 0) + 1,
        updated_at: now,
      });
      return { data: { kind: "conflict", mapping: { ...live } }, error: null };
    });
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

      if (wantSingle || wantMaybe) {
        const row = findLive(filters);
        return { data: row ? { ...row } : null, error: null };
      }
      return { data: listLive(filters).map((r) => ({ ...r })), error: null };
    }

    return api;
  };

  const client: FakeLidClient = {
    from,
    rpc: async (name, params) => {
      assert.equal(name, WHATSAPP_UPSERT_VERIFIED_LID_PHONE_MAPPING_RPC);
      return atomicUpsertRpc(params);
    },
    __rows: rows,
    get __failNextRemapInsert() {
      return failNextRemapInsert;
    },
    set __failNextRemapInsert(v: boolean) {
      failNextRemapInsert = v;
    },
    __rpcHold: rpcHold,
    __beginRpcHold: async (key: string) => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      rpcHold.set(key, { release, promise });
    },
    __releaseRpcHold: (key: string) => {
      const hold = rpcHold.get(key);
      if (!hold) return;
      hold.release();
      rpcHold.delete(key);
    },
  };

  return client;
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
  // Drain bounded persist queue.
  await new Promise((r) => setTimeout(r, 30));
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
  await new Promise((r) => setTimeout(r, 30));
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

// Reject invalid LID-as-phone writes + alphanumeric stripping.
{
  const repo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const bad = await repo.upsertVerifiedMapping(scopeA, PHONE_A_JID, PHONE_A);
  assert.equal(bad.kind, "rejected");
  const badPhone = await repo.upsertVerifiedMapping(scopeA, LID_A, LID_A);
  assert.equal(badPhone.kind, "rejected");
  assert.equal(normalizeMappingPhoneE164("abc123def456"), null);
  assert.equal(normalizeMappingPhoneE164("+923001112233"), null);
  assert.equal(normalizeMappingPhoneE164(PHONE_A), PHONE_A);
  assert.equal(normalizeMappingPhoneE164(PHONE_A_JID), PHONE_A);
  const alpha = await repo.upsertVerifiedMapping(scopeA, LID_A, "abc123def456");
  assert.equal(alpha.kind, "rejected");
  if (alpha.kind === "rejected") assert.equal(alpha.reason, "invalid_phone");
  console.log("PASS: reject non-LID / LID-as-phone / alphanumeric phone writes");
}

// ---------------------------------------------------------------------------
// SYNC-14C-B-R1 — atomic remap / concurrency (Supabase-fake)
// ---------------------------------------------------------------------------

// Insert failure after attempted stale remap preserves old mapping.
{
  const client = createLidMappingFakeSupabase();
  const repo = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  assert.equal(await repo.markStale(scopeA, LID_A), true);
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);

  client.__failNextRemapInsert = true;
  const failed = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
  assert.equal(failed.kind, "error");
  if (failed.kind === "error") {
    assert.equal(failed.errorCode, "remap_insert_failed");
  }
  // Old stale mapping remains the sole live/resolvable row.
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
  const live = [...client.__rows.values()].filter(
    (r) =>
      r.lid_normalized === LID_A &&
      (r.status === "active" || r.status === "stale")
  );
  assert.equal(live.length, 1);
  assert.equal(live[0]?.status, "stale");
  assert.equal(live[0]?.phone_e164, PHONE_A);
  console.log("PASS: insert failure after stale remap preserves old mapping");
}

// In-memory twin: failed remap also preserves stale.
{
  const repo = new InMemoryWhatsAppLidPhoneMappingRepository();
  await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  await repo.markStale(scopeA, LID_A);
  repo.__failNextRemapInsert = true;
  const failed = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
  assert.equal(failed.kind, "error");
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
  const live = repo.__all().filter(
    (r) => r.lidNormalized === LID_A && r.status !== "superseded"
  );
  assert.equal(live.length, 1);
  assert.equal(live[0]?.status, "stale");
  console.log("PASS: in-memory failed remap preserves old mapping");
}

// Two concurrent different-phone remaps → one remapped winner, no dual-live.
{
  const client = createLidMappingFakeSupabase();
  const repo = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  await repo.markStale(scopeA, LID_A);

  const holdKey = [
    scopeA.companyId,
    scopeA.channelPhoneNumberId,
    scopeA.sessionKey,
    LID_A,
  ].join("\0");
  await client.__beginRpcHold(holdKey);

  const p1 = repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
  const p2 = repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_C);
  // Let both enter the RPC and queue on the lid lock / hold.
  await new Promise((r) => setTimeout(r, 10));
  client.__releaseRpcHold(holdKey);

  const results = await Promise.all([p1, p2]);
  const kinds = results.map((r) => r.kind).sort();
  // First remap wins; second sees active winner → conflict (or rare error).
  assert.equal(kinds.includes("remapped"), true);
  assert.equal(
    kinds.includes("conflict") || kinds.includes("error"),
    true
  );
  const resolved = await repo.resolvePhoneByLid(scopeA, LID_A);
  assert.equal(resolved === PHONE_B || resolved === PHONE_C, true);
  const live = [...client.__rows.values()].filter(
    (r) =>
      r.lid_normalized === LID_A &&
      (r.status === "active" || r.status === "stale")
  );
  assert.equal(live.length, 1);
  assert.equal(live[0]?.status, "active");
  console.log("PASS: concurrent different-phone remaps → single live winner");
}

// Concurrent conflict_count increments are not lost.
{
  const client = createLidMappingFakeSupabase();
  const repo = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);

  const holdKey = [
    scopeA.companyId,
    scopeA.channelPhoneNumberId,
    scopeA.sessionKey,
    LID_A,
  ].join("\0");
  await client.__beginRpcHold(holdKey);

  const n = 8;
  const pending = Array.from({ length: n }, (_, i) =>
    repo.upsertVerifiedMapping(
      scopeA,
      LID_A,
      i % 2 === 0 ? PHONE_B : PHONE_C
    )
  );
  await new Promise((r) => setTimeout(r, 10));
  client.__releaseRpcHold(holdKey);
  const results = await Promise.all(pending);
  assert.equal(results.every((r) => r.kind === "conflict"), true);
  const last = results[results.length - 1];
  assert.equal(last?.kind, "conflict");
  if (last?.kind === "conflict") {
    assert.equal(last.mapping.conflictCount, n);
  }
  // Direct row check — atomic increments under lock.
  const live = [...client.__rows.values()].find(
    (r) => r.lid_normalized === LID_A && r.status === "active"
  );
  assert.equal(Number(live?.conflict_count), n);
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
  console.log("PASS: concurrent conflict_count increments are atomic");
}

// Cross-process-style competing inserts → one created, others re-decide.
{
  const client = createLidMappingFakeSupabase();
  const repoA = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  const repoB = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);

  const holdKey = [
    scopeA.companyId,
    scopeA.channelPhoneNumberId,
    scopeA.sessionKey,
    LID_A,
  ].join("\0");
  await client.__beginRpcHold(holdKey);

  const p1 = repoA.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  const p2 = repoB.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  await new Promise((r) => setTimeout(r, 10));
  client.__releaseRpcHold(holdKey);
  const [r1, r2] = await Promise.all([p1, p2]);
  const kinds = [r1.kind, r2.kind].sort();
  assert.deepEqual(kinds, ["created", "unchanged"]);
  const live = [...client.__rows.values()].filter(
    (r) =>
      r.lid_normalized === LID_A &&
      (r.status === "active" || r.status === "stale")
  );
  assert.equal(live.length, 1);
  assert.equal(live[0]?.phone_e164, PHONE_A);
  console.log("PASS: cross-process-style competing inserts → one live row");
}

// Malformed alphanumeric phone rejected via Supabase RPC path too.
{
  const client = createLidMappingFakeSupabase();
  const repo = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  const rejected = await repo.upsertVerifiedMapping(
    scopeA,
    LID_A,
    "user_abc123def456"
  );
  assert.equal(rejected.kind, "rejected");
  if (rejected.kind === "rejected") {
    assert.equal(rejected.reason, "invalid_phone");
  }
  assert.equal(client.__rows.size, 0);
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), null);
  console.log("PASS: malformed alphanumeric phone rejected (supabase-fake)");
}

// Old mapping remains resolvable after every failed remap (multi-fail).
{
  const client = createLidMappingFakeSupabase();
  const repo = new SupabaseWhatsAppLidPhoneMappingRepository(client as never);
  await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_A);
  await repo.markStale(scopeA, LID_A);

  for (let i = 0; i < 3; i++) {
    client.__failNextRemapInsert = true;
    const failed = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
    assert.equal(failed.kind, "error");
    assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
  }
  // Successful remap after failures.
  const ok = await repo.upsertVerifiedMapping(scopeA, LID_A, PHONE_B);
  assert.equal(ok.kind, "remapped");
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_B);
  console.log("PASS: old mapping resolvable after every failed remap");
}

// Bounded fire-and-forget persist queue is failure-isolated + concurrency-capped.
{
  assert.equal(WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY >= 1, true);
  assert.equal(WHATSAPP_LID_MAPPING_PERSIST_MAX_PENDING >= 1, true);
  const repo = new InMemoryWhatsAppLidPhoneMappingRepository();
  let inflight = 0;
  let peak = 0;
  let failures = 0;
  const slowRepo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: (s, l) => repo.resolvePhoneByLid(s, l),
    markStale: (s, l) => repo.markStale(s, l),
    listActiveForHydration: (s) => repo.listActiveForHydration(s),
    upsertVerifiedMapping: async (s, l, p) => {
      inflight += 1;
      if (inflight > peak) peak = inflight;
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      if (p === PHONE_C) {
        failures += 1;
        throw new Error("injected");
      }
      return repo.upsertVerifiedMapping(s, l, p);
    },
  };
  const queue = createLidMappingPersistQueue({
    concurrency: WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY,
    maxPending: WHATSAPP_LID_MAPPING_PERSIST_MAX_PENDING,
  });
  const memory = new WhatsAppLidPhoneMap();
  for (let i = 0; i < 5; i++) {
    scheduleRememberVerifiedLidMapping(LID_A, PHONE_A, {
      repo: slowRepo,
      scope: scopeA,
      memory,
      persistQueue: queue,
    });
  }
  scheduleRememberVerifiedLidMapping(LID_B, PHONE_C, {
    repo: slowRepo,
    scope: scopeA,
    memory,
    persistQueue: queue,
  });
  await queue.whenIdle();
  assert.equal(peak <= WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY, true);
  assert.equal(failures >= 1, true);
  assert.equal(await repo.resolvePhoneByLid(scopeA, LID_A), PHONE_A);
  // Failure-isolated: LID_A still mapped despite LID_B throw.
  assert.equal(memory.resolvePhoneJid(LID_A), PHONE_A_JID);
  console.log("PASS: bounded failure-isolated durable persist queue");
}

// ---------------------------------------------------------------------------
// SYNC-14C-B-R2 — pending bound, coalesce, fail-closed overflow
// ---------------------------------------------------------------------------

// Pending work never exceeds configured maximum.
{
  const maxPending = 3;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let upserts = 0;
  const blockingRepo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => null,
    markStale: async () => false,
    listActiveForHydration: async () => [],
    upsertVerifiedMapping: async () => {
      upserts += 1;
      await gate;
      return {
        kind: "created",
        mapping: {
          id: `wlid_${upserts}`,
          companyId: scopeA.companyId,
          channelPhoneNumberId: scopeA.channelPhoneNumberId,
          sessionKey: scopeA.sessionKey,
          lidNormalized: LID_A,
          phoneE164: PHONE_A,
          status: "active",
          verifiedAt: new Date().toISOString(),
          lastResolvedAt: new Date().toISOString(),
          conflictCount: 0,
          supersededAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
  const queue = createLidMappingPersistQueue({
    concurrency: 1,
    maxPending,
  });
  // Fill active (1) + pending (maxPending) with distinct LIDs.
  const lids = Array.from({ length: maxPending + 4 }, (_, i) => `${1000 + i}@lid`);
  const promises = lids.map((lid) =>
    queue.enqueue(
      () =>
        rememberVerifiedLidMapping(lid, `${923000000000 + Number(lid.split("@")[0])}`, {
          repo: blockingRepo,
          scope: scopeA,
        }),
      {
        key: `${scopeA.companyId}\0${scopeA.channelPhoneNumberId}\0${scopeA.sessionKey}\0${lid}`,
        coalesceKey: `${scopeA.companyId}\0${scopeA.channelPhoneNumberId}\0${scopeA.sessionKey}\0${lid}\0phone`,
      }
    )
  );
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(queue.pendingCount <= maxPending, true);
  assert.equal(queue.peakPending <= maxPending, true);
  assert.equal(queue.overflowCount >= 1, true);
  release();
  await Promise.all(promises);
  await queue.whenIdle();
  console.log("PASS: pending work never exceeds configured maximum");
}

// Hundreds of duplicate mapping events are coalesced.
{
  let upsertCalls = 0;
  const repo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => null,
    markStale: async () => false,
    listActiveForHydration: async () => [],
    upsertVerifiedMapping: async (s, l, p) => {
      upsertCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return {
        kind: "created",
        mapping: {
          id: "wlid_coalesce",
          companyId: s.companyId,
          channelPhoneNumberId: s.channelPhoneNumberId,
          sessionKey: s.sessionKey,
          lidNormalized: l,
          phoneE164: p,
          status: "active",
          verifiedAt: new Date().toISOString(),
          lastResolvedAt: new Date().toISOString(),
          conflictCount: 0,
          supersededAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending: 8 });
  const memory = new WhatsAppLidPhoneMap();
  for (let i = 0; i < 250; i++) {
    scheduleRememberVerifiedLidMapping(LID_A, PHONE_A, {
      repo,
      scope: scopeA,
      memory,
      persistQueue: queue,
    });
  }
  await new Promise((r) => setTimeout(r, 5));
  // At most one pending slot for the duplicate key (+ possibly active).
  assert.equal(queue.pendingCount <= 1, true);
  assert.equal(queue.coalesceCount >= 200, true);
  await queue.whenIdle();
  // One in-flight start + coalesced joiners; upserts must be tiny (1, or 2 if
  // a post-active coalesce raced a second slot before join).
  assert.equal(upsertCalls <= 2, true);
  assert.equal(upsertCalls >= 1, true);
  console.log("PASS: hundreds of duplicate mapping events are coalesced");
}

// Distinct-key overflow remains memory-bounded.
{
  const maxPending = 5;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const repo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => null,
    markStale: async () => false,
    listActiveForHydration: async () => [],
    upsertVerifiedMapping: async () => {
      await gate;
      return { kind: "error", errorCode: "blocked" };
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending });
  const n = 80;
  for (let i = 0; i < n; i++) {
    scheduleRememberVerifiedLidMapping(`${200000 + i}@lid`, `92301${String(i).padStart(7, "0")}`, {
      repo,
      scope: scopeA,
      persistQueue: queue,
    });
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(queue.pendingCount <= maxPending, true);
  assert.equal(queue.peakPending <= maxPending, true);
  assert.equal(queue.overflowCount, n - maxPending - 1); // 1 active + maxPending pending
  release();
  await queue.whenIdle();
  console.log("PASS: distinct-key overflow remains memory-bounded");
}

// Overflow does not affect inbound processing / socket lifecycle.
{
  const maxPending = 2;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lidRepo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const blockingRepo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: (s, l) => lidRepo.resolvePhoneByLid(s, l),
    markStale: (s, l) => lidRepo.markStale(s, l),
    listActiveForHydration: (s) => lidRepo.listActiveForHydration(s),
    upsertVerifiedMapping: async () => {
      await gate;
      return { kind: "error", errorCode: "blocked" };
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending });
  for (let i = 0; i < 20; i++) {
    scheduleRememberVerifiedLidMapping(`${300000 + i}@lid`, `92302${String(i).padStart(7, "0")}`, {
      repo: blockingRepo,
      scope: scopeA,
      persistQueue: queue,
    });
  }
  assert.equal(queue.overflowCount >= 1, true);

  const waRepo = new InMemoryWhatsAppRepository();
  const lidMap = new WhatsAppLidPhoneMap();
  // Inbound with phone identity must still store despite overflowed durable queue.
  const stored = await persistWhatsAppWebInbound(
    {
      providerMessageId: "m-overflow-ok",
      remoteJid: PHONE_A_JID,
      fromMe: false,
      text: "still stores",
      pushName: "Ada",
      occurredAt: "2026-07-26T00:10:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "text",
    },
    {
      repo: waRepo,
      lidMap,
      lidMappingRepo: blockingRepo,
      lidMappingScope: scopeA,
    }
  );
  assert.equal(stored.kind, "stored");
  assert.equal(waRepo.contacts.size, 1);

  // Sync-source connect path must not throw under overflow pressure.
  const source = new BaileysInMemorySyncSource();
  source.setLidMappingStore(blockingRepo, scopeA);
  source.setConnected(true, PHONE_A_JID);
  source.ingestContacts([{ id: LID_B, jid: PHONE_B_JID, lid: LID_B, name: "X" }]);

  release();
  await queue.whenIdle();
  console.log("PASS: overflow does not affect inbound/socket lifecycle");
}

// No identifier appears in overflow logs.
{
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (line: string) => {
    logs.push(String(line));
  };
  try {
    // Default onOverflow path — fixed allow-listed outcome only.
    const queue = createLidMappingPersistQueue({
      concurrency: 1,
      maxPending: 0,
    });
    scheduleRememberVerifiedLidMapping(LID_A, PHONE_A, {
      repo: new InMemoryWhatsAppLidPhoneMappingRepository(),
      scope: scopeA,
      persistQueue: queue,
    });
    await queue.whenIdle();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(logs.length >= 1, true);
  for (const line of logs) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.outcome, LID_MAPPING_PERSIST_OVERFLOW_OUTCOME);
    assert.equal(parsed.event, LID_MAPPING_PERSIST_OVERFLOW_OUTCOME);
    // Only fixed allow-listed fields (+ scope/level/at envelope).
    for (const key of Object.keys(parsed)) {
      assert.equal(
        ["scope", "level", "event", "outcome", "at"].includes(key),
        true,
        `unexpected overflow log key: ${key}`
      );
    }
    assert.equal(line.includes("@lid"), false);
    assert.equal(line.includes("@s.whatsapp.net"), false);
    assert.equal(line.includes(PHONE_A), false);
    assert.equal(line.includes(LID_A), false);
    assert.equal(line.includes(scopeA.companyId), false);
    assert.equal(line.includes(scopeA.channelPhoneNumberId), false);
    assert.equal(line.includes(scopeA.sessionKey), false);
  }
  console.log("PASS: no identifier in overflow logs");
}

// Queue close settles all callers (pending + coalesced waiters).
{
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const repo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => null,
    markStale: async () => false,
    listActiveForHydration: async () => [],
    upsertVerifiedMapping: async () => {
      await gate;
      return { kind: "error", errorCode: "blocked" };
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending: 10 });
  const p1 = queue.enqueue(
    () => rememberVerifiedLidMapping(LID_A, PHONE_A, { repo, scope: scopeA }),
    { key: "k-a", coalesceKey: "c-a" }
  );
  // Coalesced waiter on same in-flight key — shared promise identity.
  const p2 = queue.enqueue(
    () => rememberVerifiedLidMapping(LID_A, PHONE_A, { repo, scope: scopeA }),
    { key: "k-a", coalesceKey: "c-a" }
  );
  assert.equal(p1, p2);
  // Distinct pending item — must settle on close() without running.
  const p3 = queue.enqueue(
    () => rememberVerifiedLidMapping(LID_B, PHONE_B, { repo, scope: scopeA }),
    { key: "k-b", coalesceKey: "c-b" }
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.coalesceCount >= 1, true);
  queue.close();
  // close() settles pending and active-coalesced callers immediately.
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1, undefined);
  assert.equal(r2, undefined);
  assert.equal(r3, undefined);
  assert.equal(queue.pendingCount, 0);
  assert.equal(queue.coalesceBookkeepingCount, 0);
  assert.equal(queue.storedSettleCount, 0);
  release();
  await queue.closeAndDrain();
  console.log("PASS: queue close settles all callers");
}

// ---------------------------------------------------------------------------
// SYNC-14C-B-R3 — coalesce memory-bounded (shared promise, no resolver fan-out)
// ---------------------------------------------------------------------------

// 10,000 duplicate events use constant queue-side waiter/resolver storage.
{
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let upsertCalls = 0;
  const repo: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: async () => null,
    markStale: async () => false,
    listActiveForHydration: async () => [],
    upsertVerifiedMapping: async () => {
      upsertCalls += 1;
      await gate;
      return {
        kind: "created",
        mapping: {
          id: "wlid_burst",
          companyId: scopeA.companyId,
          channelPhoneNumberId: scopeA.channelPhoneNumberId,
          sessionKey: scopeA.sessionKey,
          lidNormalized: LID_A,
          phoneE164: PHONE_A,
          status: "active",
          verifiedAt: new Date().toISOString(),
          lastResolvedAt: new Date().toISOString(),
          conflictCount: 0,
          supersededAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending: 64 });
  for (let i = 0; i < 10000; i++) {
    // Fire-and-forget scheduler must not attach per-event handlers.
    scheduleRememberVerifiedLidMapping(LID_A, PHONE_A, {
      repo,
      scope: scopeA,
      persistQueue: queue,
    });
  }
  await new Promise((r) => setTimeout(r, 10));
  // Constant queue-side bookkeeping despite 10k duplicate events.
  assert.equal(queue.coalesceBookkeepingCount <= 1, true);
  assert.equal(queue.peakCoalesceBookkeeping <= 1, true);
  assert.equal(queue.storedSettleCount <= 1, true);
  assert.equal(queue.peakStoredSettles <= 1, true);
  assert.equal(queue.pendingCount, 0); // single distinct key is active, not pending
  assert.equal(queue.activeCount, 1);
  assert.equal(queue.coalesceCount >= 9000, true);
  release();
  await queue.whenIdle();
  assert.equal(upsertCalls, 1);
  assert.equal(queue.coalesceBookkeepingCount, 0);
  assert.equal(queue.storedSettleCount, 0);
  console.log("PASS: 10k duplicate events keep constant queue-side storage");
}

// Duplicate enqueue returns the shared promise/result.
{
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const repo = new InMemoryWhatsAppLidPhoneMappingRepository();
  const slow: WhatsAppLidPhoneMappingRepository = {
    isActive: () => true,
    resolvePhoneByLid: (s, l) => repo.resolvePhoneByLid(s, l),
    markStale: (s, l) => repo.markStale(s, l),
    listActiveForHydration: (s) => repo.listActiveForHydration(s),
    upsertVerifiedMapping: async (s, l, p) => {
      await gate;
      return repo.upsertVerifiedMapping(s, l, p);
    },
  };
  const queue = createLidMappingPersistQueue({ concurrency: 1, maxPending: 8 });
  const a = queue.enqueue(
    () => rememberVerifiedLidMapping(LID_A, PHONE_A, { repo: slow, scope: scopeA }),
    { key: "share-a", coalesceKey: "share-c" }
  );
  const b = queue.enqueue(
    () => rememberVerifiedLidMapping(LID_A, PHONE_A, { repo: slow, scope: scopeA }),
    { key: "share-a", coalesceKey: "share-c" }
  );
  assert.equal(a === b, true);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb);
  assert.equal(ra?.kind, "created");
  console.log("PASS: duplicate enqueue returns the shared promise/result");
}

// Callback exceptions cannot strand promises.
{
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let taskCalls = 0;
  const queue = createLidMappingPersistQueue({
    concurrency: 1,
    maxPending: 1,
    onOverflow: () => {
      throw new Error("overflow callback boom");
    },
    onTaskError: () => {
      throw new Error("task-error callback boom");
    },
  });
  const running = queue.enqueue(
    async () => {
      taskCalls += 1;
      await gate;
      throw new Error("task boom");
    },
    { key: "cb-a", coalesceKey: "cb-a-phone" }
  );
  // Fill the single pending slot (active already holds cb-a).
  const parked = queue.enqueue(async () => "parked", {
    key: "cb-park",
    coalesceKey: "cb-park-phone",
  });
  // Distinct key while pending full → overflow (callback throws; must still settle).
  const overflowed = queue.enqueue(async () => "never", {
    key: "cb-b",
    coalesceKey: "cb-b-phone",
  });
  assert.equal(await overflowed, undefined);
  assert.equal(queue.overflowCount, 1);
  release();
  assert.equal(await running, undefined);
  assert.equal(await parked, "parked");
  assert.equal(taskCalls, 1);
  await queue.whenIdle();
  console.log("PASS: callback exceptions cannot strand promises");
}

console.log("PASS: SYNC-14C-B-R3 durable LID mapping suite complete");
