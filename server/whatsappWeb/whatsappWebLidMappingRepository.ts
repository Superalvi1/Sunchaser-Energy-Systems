/**
 * Durable WhatsApp LID → phone mapping repository (SYNC-14C-B).
 *
 * Company/channel/session isolation is enforced on every read/write.
 * Mapping failures must never throw into WhatsApp socket lifecycle callers —
 * methods return structured results; callers log outcome codes only.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import {
  DEFAULT_COMPANY_ID,
  resolveCompanyId,
} from "../whatsappTransport/whatsappConstants.ts";
import {
  WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  WHATSAPP_WEB_SESSION_DIR_NAME,
} from "./whatsappWebConfig.ts";
import { jidToWaId, waIdToChatJid } from "./whatsappWebNormalize.ts";
import { normalizeJid } from "./whatsappWebSyncTypes.ts";

export type LidMappingStatus = "active" | "stale" | "superseded";

export type WhatsAppLidMappingScope = {
  companyId: string;
  channelPhoneNumberId: string;
  sessionKey: string;
};

export type WhatsAppLidMappingRecord = {
  id: string;
  companyId: string;
  channelPhoneNumberId: string;
  sessionKey: string;
  lidNormalized: string;
  phoneE164: string;
  status: LidMappingStatus;
  verifiedAt: string;
  lastResolvedAt: string;
  conflictCount: number;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertVerifiedLidMappingResult =
  | { kind: "created"; mapping: WhatsAppLidMappingRecord }
  | { kind: "unchanged"; mapping: WhatsAppLidMappingRecord }
  | { kind: "conflict"; mapping: WhatsAppLidMappingRecord }
  | { kind: "remapped"; mapping: WhatsAppLidMappingRecord }
  | { kind: "rejected"; reason: "invalid_lid" | "invalid_phone" }
  | { kind: "error"; errorCode: string };

export interface WhatsAppLidPhoneMappingRepository {
  isActive(): boolean;
  resolvePhoneByLid(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<string | null>;
  upsertVerifiedMapping(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string,
    phoneE164: string
  ): Promise<UpsertVerifiedLidMappingResult>;
  markStale(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<boolean>;
  listActiveForHydration(
    scope: WhatsAppLidMappingScope
  ): Promise<Array<{ lidNormalized: string; phoneE164: string }>>;
}

export function defaultWhatsAppLidMappingScope(
  explicit?: Partial<WhatsAppLidMappingScope>
): WhatsAppLidMappingScope {
  return {
    companyId: resolveCompanyId(explicit?.companyId),
    channelPhoneNumberId:
      explicit?.channelPhoneNumberId ?? WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
    sessionKey: explicit?.sessionKey ?? WHATSAPP_WEB_SESSION_DIR_NAME,
  };
}

export function normalizeLidJid(value: string | null | undefined): string | null {
  const jid = normalizeJid(String(value || ""));
  if (!jid || !jid.endsWith("@lid")) return null;
  return jid;
}

export function normalizeMappingPhoneE164(
  value: string | null | undefined
): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  // Accept phone JID or digits; never accept @lid hosts.
  if (raw.includes("@")) {
    if (raw.toLowerCase().endsWith("@lid")) return null;
    return jidToWaId(raw);
  }
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

function newMappingId(): string {
  return `wlid_${randomUUID()}`;
}

function scopeKey(scope: WhatsAppLidMappingScope, lid: string): string {
  return `${scope.companyId}\0${scope.channelPhoneNumberId}\0${scope.sessionKey}\0${lid}`;
}

function rowToRecord(row: Record<string, unknown>): WhatsAppLidMappingRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    channelPhoneNumberId: String(row.channel_phone_number_id),
    sessionKey: String(row.session_key),
    lidNormalized: String(row.lid_normalized),
    phoneE164: String(row.phone_e164),
    status: String(row.status) as LidMappingStatus,
    verifiedAt: String(row.verified_at),
    lastResolvedAt: String(row.last_resolved_at),
    conflictCount: Number(row.conflict_count ?? 0),
    supersededAt: (row.superseded_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function matchesScope(
  row: WhatsAppLidMappingRecord,
  scope: WhatsAppLidMappingScope
): boolean {
  return (
    row.companyId === scope.companyId &&
    row.channelPhoneNumberId === scope.channelPhoneNumberId &&
    row.sessionKey === scope.sessionKey
  );
}

/** In-memory durable store — behavioral twin of Supabase constraint policy. */
export class InMemoryWhatsAppLidPhoneMappingRepository
  implements WhatsAppLidPhoneMappingRepository
{
  private readonly byId = new Map<string, WhatsAppLidMappingRecord>();

  isActive(): boolean {
    return true;
  }

  /** Test helper: wipe all rows. */
  __reset(): void {
    this.byId.clear();
  }

  /** Test helper: inspect rows (never for production DTOs). */
  __all(): WhatsAppLidMappingRecord[] {
    return [...this.byId.values()];
  }

  private liveForLid(
    scope: WhatsAppLidMappingScope,
    lid: string
  ): WhatsAppLidMappingRecord | null {
    let found: WhatsAppLidMappingRecord | null = null;
    for (const row of this.byId.values()) {
      if (!matchesScope(row, scope)) continue;
      if (row.lidNormalized !== lid) continue;
      if (row.status !== "active" && row.status !== "stale") continue;
      found = row;
      break;
    }
    return found;
  }

  async resolvePhoneByLid(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<string | null> {
    const lid = normalizeLidJid(lidNormalized);
    if (!lid) return null;
    const scoped = {
      ...scope,
      companyId: resolveCompanyId(scope.companyId),
    };
    const live = this.liveForLid(scoped, lid);
    if (!live) return null;
    const now = new Date().toISOString();
    const updated = { ...live, lastResolvedAt: now, updatedAt: now };
    this.byId.set(updated.id, updated);
    return updated.phoneE164;
  }

  async upsertVerifiedMapping(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string,
    phoneE164: string
  ): Promise<UpsertVerifiedLidMappingResult> {
    const lid = normalizeLidJid(lidNormalized);
    const phone = normalizeMappingPhoneE164(phoneE164);
    if (!lid) return { kind: "rejected", reason: "invalid_lid" };
    if (!phone) return { kind: "rejected", reason: "invalid_phone" };
    const scoped = {
      ...scope,
      companyId: resolveCompanyId(scope.companyId),
    };
    const now = new Date().toISOString();
    const live = this.liveForLid(scoped, lid);

    if (!live) {
      const created: WhatsAppLidMappingRecord = {
        id: newMappingId(),
        companyId: scoped.companyId,
        channelPhoneNumberId: scoped.channelPhoneNumberId,
        sessionKey: scoped.sessionKey,
        lidNormalized: lid,
        phoneE164: phone,
        status: "active",
        verifiedAt: now,
        lastResolvedAt: now,
        conflictCount: 0,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.byId.set(created.id, created);
      return { kind: "created", mapping: created };
    }

    if (live.phoneE164 === phone) {
      const touched = {
        ...live,
        status: live.status === "stale" ? ("active" as const) : live.status,
        lastResolvedAt: now,
        updatedAt: now,
      };
      this.byId.set(touched.id, touched);
      return { kind: "unchanged", mapping: touched };
    }

    if (live.status === "stale") {
      const superseded: WhatsAppLidMappingRecord = {
        ...live,
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      };
      this.byId.set(superseded.id, superseded);
      const created: WhatsAppLidMappingRecord = {
        id: newMappingId(),
        companyId: scoped.companyId,
        channelPhoneNumberId: scoped.channelPhoneNumberId,
        sessionKey: scoped.sessionKey,
        lidNormalized: lid,
        phoneE164: phone,
        status: "active",
        verifiedAt: now,
        lastResolvedAt: now,
        conflictCount: 0,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.byId.set(created.id, created);
      return { kind: "remapped", mapping: created };
    }

    const conflicted = {
      ...live,
      conflictCount: live.conflictCount + 1,
      updatedAt: now,
    };
    this.byId.set(conflicted.id, conflicted);
    return { kind: "conflict", mapping: conflicted };
  }

  async markStale(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<boolean> {
    const lid = normalizeLidJid(lidNormalized);
    if (!lid) return false;
    const scoped = {
      ...scope,
      companyId: resolveCompanyId(scope.companyId),
    };
    const live = this.liveForLid(scoped, lid);
    if (!live || live.status !== "active") return false;
    const now = new Date().toISOString();
    this.byId.set(live.id, {
      ...live,
      status: "stale",
      updatedAt: now,
    });
    return true;
  }

  async listActiveForHydration(
    scope: WhatsAppLidMappingScope
  ): Promise<Array<{ lidNormalized: string; phoneE164: string }>> {
    const scoped = {
      ...scope,
      companyId: resolveCompanyId(scope.companyId),
    };
    const out: Array<{ lidNormalized: string; phoneE164: string }> = [];
    for (const row of this.byId.values()) {
      if (!matchesScope(row, scoped)) continue;
      if (row.status !== "active" && row.status !== "stale") continue;
      out.push({ lidNormalized: row.lidNormalized, phoneE164: row.phoneE164 });
    }
    return out;
  }
}

/**
 * Supabase-backed durable store. Always filters by company_id (+ channel/session).
 */
export class SupabaseWhatsAppLidPhoneMappingRepository
  implements WhatsAppLidPhoneMappingRepository
{
  constructor(private readonly client: SupabaseClient) {}

  isActive(): boolean {
    return true;
  }

  async resolvePhoneByLid(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<string | null> {
    const lid = normalizeLidJid(lidNormalized);
    if (!lid) return null;
    const companyId = resolveCompanyId(scope.companyId);
    const { data, error } = await this.client
      .from("whatsapp_lid_phone_mappings")
      .select("*")
      .eq("company_id", companyId)
      .eq("channel_phone_number_id", scope.channelPhoneNumberId)
      .eq("session_key", scope.sessionKey)
      .eq("lid_normalized", lid)
      .in("status", ["active", "stale"])
      .maybeSingle();
    if (error || !data) return null;
    const record = rowToRecord(data as Record<string, unknown>);
    const now = new Date().toISOString();
    await this.client
      .from("whatsapp_lid_phone_mappings")
      .update({ last_resolved_at: now, updated_at: now })
      .eq("company_id", companyId)
      .eq("id", record.id);
    return record.phoneE164;
  }

  async upsertVerifiedMapping(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string,
    phoneE164: string
  ): Promise<UpsertVerifiedLidMappingResult> {
    const lid = normalizeLidJid(lidNormalized);
    const phone = normalizeMappingPhoneE164(phoneE164);
    if (!lid) return { kind: "rejected", reason: "invalid_lid" };
    if (!phone) return { kind: "rejected", reason: "invalid_phone" };
    const companyId = resolveCompanyId(scope.companyId);
    const now = new Date().toISOString();

    const { data: existing, error: selectError } = await this.client
      .from("whatsapp_lid_phone_mappings")
      .select("*")
      .eq("company_id", companyId)
      .eq("channel_phone_number_id", scope.channelPhoneNumberId)
      .eq("session_key", scope.sessionKey)
      .eq("lid_normalized", lid)
      .in("status", ["active", "stale"])
      .maybeSingle();

    if (selectError) {
      return { kind: "error", errorCode: "select_failed" };
    }

    if (!existing) {
      const id = newMappingId();
      const payload = {
        id,
        company_id: companyId,
        channel_phone_number_id: scope.channelPhoneNumberId,
        session_key: scope.sessionKey,
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
      const { data, error } = await this.client
        .from("whatsapp_lid_phone_mappings")
        .insert(payload)
        .select("*")
        .single();
      if (error || !data) {
        // Unique race: reselect live row and re-apply policy.
        const { data: raced } = await this.client
          .from("whatsapp_lid_phone_mappings")
          .select("*")
          .eq("company_id", companyId)
          .eq("channel_phone_number_id", scope.channelPhoneNumberId)
          .eq("session_key", scope.sessionKey)
          .eq("lid_normalized", lid)
          .in("status", ["active", "stale"])
          .maybeSingle();
        if (!raced) return { kind: "error", errorCode: "insert_failed" };
        return this.applyAgainstExisting(
          rowToRecord(raced as Record<string, unknown>),
          phone,
          now,
          companyId
        );
      }
      return {
        kind: "created",
        mapping: rowToRecord(data as Record<string, unknown>),
      };
    }

    return this.applyAgainstExisting(
      rowToRecord(existing as Record<string, unknown>),
      phone,
      now,
      companyId
    );
  }

  private async applyAgainstExisting(
    live: WhatsAppLidMappingRecord,
    phone: string,
    now: string,
    companyId: string
  ): Promise<UpsertVerifiedLidMappingResult> {
    if (live.phoneE164 === phone) {
      const nextStatus = live.status === "stale" ? "active" : live.status;
      const { data, error } = await this.client
        .from("whatsapp_lid_phone_mappings")
        .update({
          status: nextStatus,
          last_resolved_at: now,
          updated_at: now,
          superseded_at: null,
        })
        .eq("company_id", companyId)
        .eq("id", live.id)
        .select("*")
        .single();
      if (error || !data) return { kind: "error", errorCode: "touch_failed" };
      return {
        kind: "unchanged",
        mapping: rowToRecord(data as Record<string, unknown>),
      };
    }

    if (live.status === "stale") {
      const { error: supersedeError } = await this.client
        .from("whatsapp_lid_phone_mappings")
        .update({
          status: "superseded",
          superseded_at: now,
          updated_at: now,
        })
        .eq("company_id", companyId)
        .eq("id", live.id);
      if (supersedeError) {
        return { kind: "error", errorCode: "supersede_failed" };
      }
      const payload = {
        id: newMappingId(),
        company_id: companyId,
        channel_phone_number_id: live.channelPhoneNumberId,
        session_key: live.sessionKey,
        lid_normalized: live.lidNormalized,
        phone_e164: phone,
        status: "active",
        verified_at: now,
        last_resolved_at: now,
        conflict_count: 0,
        superseded_at: null,
        created_at: now,
        updated_at: now,
      };
      const { data, error } = await this.client
        .from("whatsapp_lid_phone_mappings")
        .insert(payload)
        .select("*")
        .single();
      if (error || !data) return { kind: "error", errorCode: "remap_insert_failed" };
      return {
        kind: "remapped",
        mapping: rowToRecord(data as Record<string, unknown>),
      };
    }

    const { data, error } = await this.client
      .from("whatsapp_lid_phone_mappings")
      .update({
        conflict_count: live.conflictCount + 1,
        updated_at: now,
      })
      .eq("company_id", companyId)
      .eq("id", live.id)
      .select("*")
      .single();
    if (error || !data) return { kind: "error", errorCode: "conflict_update_failed" };
    return {
      kind: "conflict",
      mapping: rowToRecord(data as Record<string, unknown>),
    };
  }

  async markStale(
    scope: WhatsAppLidMappingScope,
    lidNormalized: string
  ): Promise<boolean> {
    const lid = normalizeLidJid(lidNormalized);
    if (!lid) return false;
    const companyId = resolveCompanyId(scope.companyId);
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("whatsapp_lid_phone_mappings")
      .update({ status: "stale", updated_at: now })
      .eq("company_id", companyId)
      .eq("channel_phone_number_id", scope.channelPhoneNumberId)
      .eq("session_key", scope.sessionKey)
      .eq("lid_normalized", lid)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    return !error && Boolean(data);
  }

  async listActiveForHydration(
    scope: WhatsAppLidMappingScope
  ): Promise<Array<{ lidNormalized: string; phoneE164: string }>> {
    const companyId = resolveCompanyId(scope.companyId);
    const { data, error } = await this.client
      .from("whatsapp_lid_phone_mappings")
      .select("lid_normalized,phone_e164,status,company_id")
      .eq("company_id", companyId)
      .eq("channel_phone_number_id", scope.channelPhoneNumberId)
      .eq("session_key", scope.sessionKey)
      .in("status", ["active", "stale"]);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      lidNormalized: String(row.lid_normalized),
      phoneE164: String(row.phone_e164),
    }));
  }
}

export function createWhatsAppLidPhoneMappingRepository(deps?: {
  client?: SupabaseClient | null;
  memoryOnly?: boolean;
}): WhatsAppLidPhoneMappingRepository {
  if (deps?.memoryOnly) {
    return new InMemoryWhatsAppLidPhoneMappingRepository();
  }
  if (deps?.client) {
    return new SupabaseWhatsAppLidPhoneMappingRepository(deps.client);
  }
  if (isSupabaseActive()) {
    const client = getSupabase();
    if (client) return new SupabaseWhatsAppLidPhoneMappingRepository(client);
  }
  return new InMemoryWhatsAppLidPhoneMappingRepository();
}

/** Re-export phone JID helper for hydration callers. */
export { waIdToChatJid };

export const __defaultCompanyIdForTests = DEFAULT_COMPANY_ID;

/** Stable key helper for tests (never log). */
export function __scopeLidKeyForTests(
  scope: WhatsAppLidMappingScope,
  lid: string
): string {
  return scopeKey(scope, lid);
}
