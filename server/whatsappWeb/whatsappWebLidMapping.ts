/**
 * SYNC-14C-B durable LID resolution helpers.
 *
 * Combines ephemeral WhatsAppLidPhoneMap with a durable repository.
 * Mapping failures are swallowed into structured outcomes — never disconnect.
 * Fire-and-forget durable writes are bounded and failure-isolated.
 */
import { ContactIdentityPersistQueue } from "./whatsappWebContactIdentityQueue.ts";
import {
  collectLidJid,
  resolveWhatsAppIdentity,
  WhatsAppLidPhoneMap,
  type ResolvedWhatsAppIdentity,
  type WhatsAppIdentityInput,
} from "./whatsappWebIdentity.ts";
import {
  createWhatsAppLidPhoneMappingRepository,
  defaultWhatsAppLidMappingScope,
  normalizeLidJid,
  normalizeMappingPhoneE164,
  type UpsertVerifiedLidMappingResult,
  type WhatsAppLidMappingScope,
  type WhatsAppLidPhoneMappingRepository,
} from "./whatsappWebLidMappingRepository.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import { waIdToChatJid } from "./whatsappWebNormalize.ts";

export type WhatsAppLidMappingRuntime = {
  repo: WhatsAppLidPhoneMappingRepository;
  memory: WhatsAppLidPhoneMap;
  scope: WhatsAppLidMappingScope;
};

/** Cap concurrent durable LID persist tasks; isolate failures per task. */
export const WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY = 2;

/**
 * Hard cap on pending LID persist slots (after coalesce). Overflow drops only
 * durable persistence — never inbound, socket lifecycle, or fake phone contacts.
 */
export const WHATSAPP_LID_MAPPING_PERSIST_MAX_PENDING = 64;

/** Allow-listed overflow outcome — never include scope/LID/phone. */
export const LID_MAPPING_PERSIST_OVERFLOW_OUTCOME =
  "lid_mapping_persist_overflow" as const;

let sharedLidMappingRuntime: WhatsAppLidMappingRuntime | null = null;
let sharedLidMappingPersistQueue: ContactIdentityPersistQueue | null = null;

function logLidMappingPersistOverflow(): void {
  // Fixed allow-listed outcome only — no scope, LID, phone, or counts.
  logWhatsAppWeb("warn", LID_MAPPING_PERSIST_OVERFLOW_OUTCOME, {
    outcome: LID_MAPPING_PERSIST_OVERFLOW_OUTCOME,
  });
}

export function createLidMappingPersistQueue(options?: {
  concurrency?: number;
  maxPending?: number;
  onTaskError?: () => void;
  onOverflow?: () => void;
}): ContactIdentityPersistQueue {
  return new ContactIdentityPersistQueue({
    concurrency: options?.concurrency ?? WHATSAPP_LID_MAPPING_PERSIST_CONCURRENCY,
    maxPending: options?.maxPending ?? WHATSAPP_LID_MAPPING_PERSIST_MAX_PENDING,
    onTaskError:
      options?.onTaskError ??
      (() => {
        logWhatsAppWeb("warn", "lid_mapping_persist_failed", {
          outcome: "lid_mapping_persist_failed",
          phase: "queue",
        });
      }),
    onOverflow: options?.onOverflow ?? logLidMappingPersistOverflow,
  });
}

function getLidMappingPersistQueue(): ContactIdentityPersistQueue {
  if (!sharedLidMappingPersistQueue) {
    sharedLidMappingPersistQueue = createLidMappingPersistQueue();
  }
  return sharedLidMappingPersistQueue;
}

/**
 * Process-wide LID mapping runtime shared by inbound + sync source.
 * Durable writes degrade cleanly when the review-only migration is not applied.
 */
export function getSharedWhatsAppLidMappingRuntime(): WhatsAppLidMappingRuntime {
  if (!sharedLidMappingRuntime) {
    sharedLidMappingRuntime = {
      repo: createWhatsAppLidPhoneMappingRepository(),
      memory: new WhatsAppLidPhoneMap(),
      scope: defaultWhatsAppLidMappingScope(),
    };
  }
  return sharedLidMappingRuntime;
}

/** Test-only reset of the shared runtime and persist queue. */
export function __resetSharedWhatsAppLidMappingRuntime(): void {
  sharedLidMappingRuntime = null;
  if (sharedLidMappingPersistQueue) {
    sharedLidMappingPersistQueue.close();
    sharedLidMappingPersistQueue = null;
  }
}

/** Test helper: observe the shared persist queue. */
export function __getSharedLidMappingPersistQueueForTests(): ContactIdentityPersistQueue {
  return getLidMappingPersistQueue();
}

export type DurableLidResolveDeps = {
  repo: WhatsAppLidPhoneMappingRepository;
  scope?: WhatsAppLidMappingScope;
  memory?: WhatsAppLidPhoneMap;
  /** Optional injectible queue (tests). Defaults to process-shared bounded queue. */
  persistQueue?: ContactIdentityPersistQueue;
};

function logMappingOutcome(
  event:
    | "lid_mapping_created"
    | "lid_mapping_unchanged"
    | "lid_mapping_conflict"
    | "lid_mapping_remapped"
    | "lid_mapping_rejected"
    | "lid_mapping_persist_failed"
    | "lid_mapping_persist_overflow"
    | "lid_mapping_resolve_miss"
    | "lid_mapping_hydrate_failed"
    | "lid_mapping_hydrate_ok",
  extra?: Record<string, unknown>
): void {
  // Outcome codes only — never phone/jid/lid keys (blocked by log filter too).
  logWhatsAppWeb("info", event, {
    outcome: event,
    ...extra,
  });
}

/** Serialization key: one durable write lane per scoped LID. */
export function lidMappingPersistSerializeKey(
  scope: WhatsAppLidMappingScope,
  lidNormalized: string
): string {
  return `${scope.companyId}\0${scope.channelPhoneNumberId}\0${scope.sessionKey}\0${lidNormalized}`;
}

/** Coalesce key: identical scoped LID+phone mapping events share one slot. */
export function lidMappingPersistCoalesceKey(
  scope: WhatsAppLidMappingScope,
  lidNormalized: string,
  phoneE164: string
): string {
  return `${lidMappingPersistSerializeKey(scope, lidNormalized)}\0${phoneE164}`;
}

export function mappingResultToOutcomeEvent(
  result: UpsertVerifiedLidMappingResult
):
  | "lid_mapping_created"
  | "lid_mapping_unchanged"
  | "lid_mapping_conflict"
  | "lid_mapping_remapped"
  | "lid_mapping_rejected"
  | "lid_mapping_persist_failed" {
  switch (result.kind) {
    case "created":
      return "lid_mapping_created";
    case "unchanged":
      return "lid_mapping_unchanged";
    case "conflict":
      return "lid_mapping_conflict";
    case "remapped":
      return "lid_mapping_remapped";
    case "rejected":
      return "lid_mapping_rejected";
    case "error":
      return "lid_mapping_persist_failed";
  }
}

/**
 * Persist a verified LID→phone pair. Never throws.
 * On conflict, memory is realigned to the durable winner phone.
 */
export async function rememberVerifiedLidMapping(
  lidJid: string | null | undefined,
  phoneE164OrJid: string | null | undefined,
  deps: DurableLidResolveDeps
): Promise<UpsertVerifiedLidMappingResult> {
  const scope = deps.scope ?? defaultWhatsAppLidMappingScope();
  const lid = normalizeLidJid(lidJid);
  const phone = normalizeMappingPhoneE164(phoneE164OrJid);
  const memory = deps.memory;

  if (!lid || !phone) {
    const rejected = {
      kind: "rejected" as const,
      reason: !lid ? ("invalid_lid" as const) : ("invalid_phone" as const),
    };
    logMappingOutcome("lid_mapping_rejected", { reasonCode: rejected.reason });
    return rejected;
  }

  try {
    const result = await deps.repo.upsertVerifiedMapping(scope, lid, phone);
    if (memory) {
      if (result.kind === "conflict") {
        // Keep first-verified durable phone; do not adopt conflicting candidate.
        memory.remember(lid, waIdToChatJid(result.mapping.phoneE164));
      } else if (
        result.kind === "created" ||
        result.kind === "unchanged" ||
        result.kind === "remapped"
      ) {
        memory.remember(lid, waIdToChatJid(result.mapping.phoneE164));
      }
    }
    logMappingOutcome(mappingResultToOutcomeEvent(result), {
      conflictCount:
        result.kind === "conflict" ? result.mapping.conflictCount : undefined,
    });
    return result;
  } catch {
    logMappingOutcome("lid_mapping_persist_failed");
    // Still keep ephemeral memory so the current process can resolve.
    memory?.remember(lid, waIdToChatJid(phone));
    return { kind: "error", errorCode: "persist_threw" };
  }
}

/**
 * Schedule a bounded, coalesced, failure-isolated durable write.
 * Never throws to callers. Overflow drops only durable persistence.
 * Same scoped LID is serialized; identical LID+phone work coalesces;
 * global DB concurrency and pending depth are capped.
 */
export function scheduleRememberVerifiedLidMapping(
  lidJid: string | null | undefined,
  phoneE164OrJid: string | null | undefined,
  deps: DurableLidResolveDeps
): void {
  const scope = deps.scope ?? defaultWhatsAppLidMappingScope();
  const lid = normalizeLidJid(lidJid);
  const phone = normalizeMappingPhoneE164(phoneE164OrJid);
  // Invalid inputs never consume a pending slot (fail-closed for schedule).
  if (!lid || !phone) return;

  const queue = deps.persistQueue ?? getLidMappingPersistQueue();
  const key = lidMappingPersistSerializeKey(scope, lid);
  const coalesceKey = lidMappingPersistCoalesceKey(scope, lid, phone);
  // Fire-and-forget: enqueue never rejects and returns a shared coalesce
  // promise — do not attach per-event .then/.catch (unbounded listeners).
  void queue.enqueue(
    () => rememberVerifiedLidMapping(lid, phone, deps),
    { key, coalesceKey }
  );
}

/**
 * Resolve identity using direct Baileys fields → ephemeral map → durable store.
 * Never throws; durable failures degrade to null (caller skips LID-only).
 */
export async function resolveWhatsAppIdentityDurable(
  input: WhatsAppIdentityInput,
  deps: DurableLidResolveDeps
): Promise<ResolvedWhatsAppIdentity | null> {
  const memory = deps.memory ?? new WhatsAppLidPhoneMap();
  const scope = deps.scope ?? defaultWhatsAppLidMappingScope();

  const direct = memory.resolveIdentity(input);
  if (direct) {
    if (direct.lidJid) {
      // Fire-and-forget durable write; never block inbound on persist.
      scheduleRememberVerifiedLidMapping(direct.lidJid, direct.phoneE164, {
        repo: deps.repo,
        scope,
        memory,
        persistQueue: deps.persistQueue,
      });
    }
    return direct;
  }

  const lid = collectLidJid(
    input.remoteJid,
    input.participant,
    input.contactId,
    input.contactLid,
    input.senderLid,
    input.participantLid
  );
  if (!lid) return null;

  try {
    const phone = await deps.repo.resolvePhoneByLid(scope, lid);
    if (!phone) {
      logMappingOutcome("lid_mapping_resolve_miss");
      return null;
    }
    memory.remember(lid, waIdToChatJid(phone));
    return {
      phoneE164: phone,
      phoneJid: waIdToChatJid(phone),
      lidJid: lid,
      source: "durable_lid_map",
    };
  } catch {
    logMappingOutcome("lid_mapping_persist_failed", {
      phase: "resolve",
    });
    return null;
  }
}

/** Hydrate ephemeral map from durable rows. Never throws. */
export async function hydrateWhatsAppLidPhoneMap(
  memory: WhatsAppLidPhoneMap,
  deps: Omit<DurableLidResolveDeps, "memory">
): Promise<number> {
  const scope = deps.scope ?? defaultWhatsAppLidMappingScope();
  try {
    const rows = await deps.repo.listActiveForHydration(scope);
    for (const row of rows) {
      memory.remember(row.lidNormalized, waIdToChatJid(row.phoneE164));
    }
    logMappingOutcome("lid_mapping_hydrate_ok", { count: rows.length });
    return rows.length;
  } catch {
    logMappingOutcome("lid_mapping_hydrate_failed");
    return 0;
  }
}

/**
 * When durable store is unavailable, fall back to pure ephemeral/direct resolve.
 */
export function resolveWhatsAppIdentityWithOptionalMap(
  input: WhatsAppIdentityInput,
  lidMap?: WhatsAppLidPhoneMap | null
): ResolvedWhatsAppIdentity | null {
  if (lidMap) return lidMap.resolveIdentity(input);
  return resolveWhatsAppIdentity(input);
}

/** True when a string looks like a raw LID/JID that must never appear in DTO/UI. */
export function containsRawWhatsAppIdentifier(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (v.includes("@lid")) return true;
  if (v.includes("@s.whatsapp.net")) return true;
  if (v.includes("@g.us")) return true;
  if (/^wlid_/i.test(v)) return true;
  return false;
}
