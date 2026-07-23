/**
 * Persistent WhatsApp connection credentials (RC-1.2.4B).
 *
 * Production: Supabase `whatsapp_connections` (service-role only).
 * Tests: in-memory repository.
 * Access tokens are AES-256-GCM encrypted before persistence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import {
  decryptWhatsAppToken,
  encryptWhatsAppToken,
  WhatsAppTokenCryptoError,
} from "./whatsappTokenCrypto.ts";

export type WhatsAppConnectionStateOverride =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "REAUTHORIZATION_REQUIRED"
  | "ERROR";

export type WhatsAppConnectionRecord = {
  companyId: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  /** Decrypted access token (never log). */
  accessToken: string | null;
  tokenExpiresAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  stateOverride: WhatsAppConnectionStateOverride | null;
  createdAt?: string;
  updatedAt?: string;
};

export type WhatsAppConnectionRepository = {
  get(companyId: string): Promise<WhatsAppConnectionRecord | null>;
  upsert(record: WhatsAppConnectionRecord): Promise<WhatsAppConnectionRecord>;
  clear(companyId: string): Promise<void>;
};

function infrastructureError(message: string): InboxServiceError {
  return new InboxServiceError("service_unavailable", message);
}

function mapRow(row: Record<string, unknown>): WhatsAppConnectionRecord {
  let accessToken: string | null = null;
  const raw = row.access_token;
  if (typeof raw === "string" && raw.trim()) {
    try {
      accessToken = decryptWhatsAppToken(raw);
    } catch (err) {
      if (err instanceof WhatsAppTokenCryptoError) {
        throw infrastructureError("Stored WhatsApp token could not be decrypted");
      }
      throw err;
    }
  }
  return {
    companyId: String(row.company_id || ""),
    wabaId: row.waba_id != null ? String(row.waba_id) : null,
    phoneNumberId:
      row.phone_number_id != null ? String(row.phone_number_id) : null,
    phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
    accessToken,
    tokenExpiresAt:
      row.token_expires_at != null ? String(row.token_expires_at) : null,
    lastWebhookAt:
      row.last_webhook_at != null ? String(row.last_webhook_at) : null,
    lastError: row.last_error != null ? String(row.last_error) : null,
    stateOverride:
      (row.state_override as WhatsAppConnectionStateOverride | null) ?? null,
    createdAt: row.created_at != null ? String(row.created_at) : undefined,
    updatedAt: row.updated_at != null ? String(row.updated_at) : undefined,
  };
}

function toDbPayload(record: WhatsAppConnectionRecord): Record<string, unknown> {
  let accessTokenEnc: string | null = null;
  if (record.accessToken) {
    try {
      accessTokenEnc = encryptWhatsAppToken(record.accessToken);
    } catch (err) {
      if (err instanceof WhatsAppTokenCryptoError) {
        throw infrastructureError(
          "WhatsApp token encryption is not configured"
        );
      }
      throw err;
    }
  }
  return {
    company_id: record.companyId,
    waba_id: record.wabaId,
    phone_number_id: record.phoneNumberId,
    phone_number: record.phoneNumber,
    access_token: accessTokenEnc,
    token_expires_at: record.tokenExpiresAt,
    last_webhook_at: record.lastWebhookAt,
    last_error: record.lastError,
    state_override: record.stateOverride,
    updated_at: new Date().toISOString(),
  };
}

export class InMemoryWhatsAppConnectionRepository
  implements WhatsAppConnectionRepository
{
  private readonly byCompany = new Map<string, WhatsAppConnectionRecord>();

  async get(companyId: string): Promise<WhatsAppConnectionRecord | null> {
    const id = String(companyId || "").trim();
    if (!id) return null;
    const row = this.byCompany.get(id);
    return row ? { ...row } : null;
  }

  async upsert(
    record: WhatsAppConnectionRecord
  ): Promise<WhatsAppConnectionRecord> {
    const id = String(record.companyId || "").trim();
    if (!id) {
      throw infrastructureError("companyId is required for connection upsert");
    }
    const next: WhatsAppConnectionRecord = {
      ...record,
      companyId: id,
      updatedAt: new Date().toISOString(),
      createdAt: record.createdAt ?? new Date().toISOString(),
    };
    this.byCompany.set(id, next);
    return { ...next };
  }

  async clear(companyId: string): Promise<void> {
    this.byCompany.delete(String(companyId || "").trim());
  }

  /** Test helper */
  clearAll(): void {
    this.byCompany.clear();
  }
}

export class SupabaseWhatsAppConnectionRepository
  implements WhatsAppConnectionRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async get(companyId: string): Promise<WhatsAppConnectionRecord | null> {
    const id = String(companyId || "").trim();
    if (!id) return null;
    const { data, error } = await this.client
      .from("whatsapp_connections")
      .select("*")
      .eq("company_id", id)
      .maybeSingle();
    if (error) {
      throw infrastructureError("WhatsApp connection lookup failed");
    }
    if (!data) return null;
    return mapRow(data as Record<string, unknown>);
  }

  async upsert(
    record: WhatsAppConnectionRecord
  ): Promise<WhatsAppConnectionRecord> {
    const id = String(record.companyId || "").trim();
    if (!id) {
      throw infrastructureError("companyId is required for connection upsert");
    }
    const payload = toDbPayload({ ...record, companyId: id });
    const { data, error } = await this.client
      .from("whatsapp_connections")
      .upsert(payload, { onConflict: "company_id" })
      .select("*")
      .maybeSingle();
    if (error || !data) {
      throw infrastructureError("WhatsApp connection persistence failed");
    }
    return mapRow(data as Record<string, unknown>);
  }

  async clear(companyId: string): Promise<void> {
    const id = String(companyId || "").trim();
    if (!id) return;
    const { error } = await this.client
      .from("whatsapp_connections")
      .delete()
      .eq("company_id", id);
    if (error) {
      throw infrastructureError("WhatsApp connection clear failed");
    }
  }
}

/**
 * Production: Supabase only — fail closed when inactive.
 * Tests: inject InMemoryWhatsAppConnectionRepository.
 */
export function createDefaultWhatsAppConnectionRepository(): WhatsAppConnectionRepository {
  if (!isSupabaseActive()) {
    throw infrastructureError(
      "WhatsApp connection storage requires an active Supabase backend"
    );
  }
  return new SupabaseWhatsAppConnectionRepository(getSupabase()!);
}
