/**
 * OAuth CSRF state nonces for Meta Embedded Signup (RC-1.2.4B).
 *
 * Production: Supabase `whatsapp_oauth_states` with atomic consume RPC.
 * Tests: in-memory async store.
 *
 * Nonces are stored as SHA-256 hashes. Consume is single-use, TTL-bound,
 * and company/actor scoped — no read-then-update race.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

const NONCE_TTL_MS = 15 * 60 * 1000;

export type OAuthStateConsumeResult =
  | { ok: true }
  | { ok: false; reason: string };

export type OAuthStateStore = {
  create(companyId: string, actorId: string): Promise<string>;
  consume(
    nonce: string,
    companyId: string,
    actorId?: string
  ): Promise<OAuthStateConsumeResult>;
  clear(): Promise<void>;
};

function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export function hashOAuthNonce(nonce: string): string {
  return createHash("sha256").update(String(nonce), "utf8").digest("hex");
}

function infrastructureError(message: string): InboxServiceError {
  return new InboxServiceError("service_unavailable", message);
}

type MemoryEntry = {
  nonceHash: string;
  companyId: string;
  actorId: string;
  expiresAt: number;
  used: boolean;
};

export function makeMemoryOAuthStateStore(): OAuthStateStore {
  const store = new Map<string, MemoryEntry>();

  function prune() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt < now || entry.used) store.delete(key);
    }
  }

  return {
    async create(companyId: string, actorId: string): Promise<string> {
      prune();
      const nonce = generateNonce();
      const nonceHash = hashOAuthNonce(nonce);
      store.set(nonceHash, {
        nonceHash,
        companyId,
        actorId,
        expiresAt: Date.now() + NONCE_TTL_MS,
        used: false,
      });
      return nonce;
    },

    async consume(
      nonce: string,
      companyId: string,
      actorId?: string
    ): Promise<OAuthStateConsumeResult> {
      prune();
      const nonceHash = hashOAuthNonce(nonce);
      const entry = store.get(nonceHash);
      if (!entry) {
        return { ok: false, reason: "State nonce not found or already expired" };
      }
      if (entry.used) {
        return {
          ok: false,
          reason: "State nonce already consumed (replay detected)",
        };
      }
      if (entry.expiresAt < Date.now()) {
        store.delete(nonceHash);
        return { ok: false, reason: "State nonce expired" };
      }
      if (entry.companyId !== companyId) {
        return { ok: false, reason: "State nonce company mismatch" };
      }
      if (actorId != null && entry.actorId !== actorId) {
        return { ok: false, reason: "State nonce actor mismatch" };
      }
      entry.used = true;
      return { ok: true };
    },

    async clear() {
      store.clear();
    },
  };
}

/** Module-level memory singleton for tests. */
export const memoryOAuthStateStore: OAuthStateStore = makeMemoryOAuthStateStore();

/**
 * Supabase-backed store. Atomic consume via RPC `whatsapp_oauth_consume_state`.
 * Nonce column stores SHA-256(hex) of the raw nonce returned to the client.
 */
export class SupabaseOAuthStateStore implements OAuthStateStore {
  constructor(private readonly client: SupabaseClient) {}

  async create(companyId: string, actorId: string): Promise<string> {
    const nonce = generateNonce();
    const nonceHash = hashOAuthNonce(nonce);
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();

    // Opportunistic prune of expired rows
    await this.client
      .from("whatsapp_oauth_states")
      .delete()
      .lt("expires_at", new Date().toISOString());

    const { error } = await this.client.from("whatsapp_oauth_states").insert({
      nonce: nonceHash,
      company_id: companyId,
      actor_id: actorId,
      expires_at: expiresAt,
      used: false,
    });
    if (error) {
      throw infrastructureError("OAuth state persistence failed");
    }
    return nonce;
  }

  async consume(
    nonce: string,
    companyId: string,
    actorId?: string
  ): Promise<OAuthStateConsumeResult> {
    const nonceHash = hashOAuthNonce(nonce);
    const { data, error } = await this.client.rpc("whatsapp_oauth_consume_state", {
      p_nonce_hash: nonceHash,
      p_company_id: companyId,
      p_actor_id: actorId ?? null,
    });

    if (error) {
      if (/Could not find the function|PGRST202|does not exist/i.test(error.message)) {
        throw infrastructureError(
          "OAuth state consume RPC is missing — apply scripts/whatsapp-hardening-rc124.sql"
        );
      }
      throw infrastructureError("OAuth state consume failed");
    }

    // RPC returns boolean or { ok, reason }
    if (data === true) return { ok: true };
    if (data && typeof data === "object" && (data as { ok?: boolean }).ok === true) {
      return { ok: true };
    }
    if (data && typeof data === "object" && typeof (data as { reason?: string }).reason === "string") {
      return { ok: false, reason: String((data as { reason: string }).reason) };
    }
    if (data === false) {
      return { ok: false, reason: "State nonce not found or already expired" };
    }
    return { ok: false, reason: "State nonce validation failed" };
  }

  async clear(): Promise<void> {
    const { error } = await this.client
      .from("whatsapp_oauth_states")
      .delete()
      .neq("nonce", "");
    if (error) {
      throw infrastructureError("OAuth state clear failed");
    }
  }
}

export function createDefaultOAuthStateStore(): OAuthStateStore {
  if (!isSupabaseActive()) {
    throw infrastructureError(
      "OAuth state storage requires an active Supabase backend"
    );
  }
  return new SupabaseOAuthStateStore(getSupabase()!);
}
