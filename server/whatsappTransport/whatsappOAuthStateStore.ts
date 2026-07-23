/**
 * OAuth CSRF state nonce management for Meta Embedded Signup.
 *
 * Flow:
 *   1. Admin calls POST /admin/whatsapp/embedded-signup/start → server generates
 *      a cryptographic nonce, stores it with a 15-minute TTL.
 *   2. Frontend embeds `state` in the Facebook Login SDK call.
 *   3. When the SDK callback fires, the code + state are POSTed to the server.
 *   4. Server validates the state nonce (single-use, unexpired) before exchanging.
 *
 * In production the store should be backed by Redis or the database. This
 * module ships a process-memory store suitable for single-instance deployments
 * and unit tests. The interface `OAuthStateStore` is exported so callers can
 * inject a persistent implementation.
 */

const NONCE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type OAuthStateEntry = {
  nonce: string;
  companyId: string;
  actorId: string;
  expiresAt: number;
  used: boolean;
};

export type OAuthStateStore = {
  create(companyId: string, actorId: string): string;
  consume(nonce: string, companyId: string): { ok: true } | { ok: false; reason: string };
  /** For tests: clear all state. */
  clear(): void;
};

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeMemoryOAuthStateStore(): OAuthStateStore {
  const store = new Map<string, OAuthStateEntry>();

  function prune() {
    const now = Date.now();
    for (const [nonce, entry] of store) {
      if (entry.expiresAt < now || entry.used) store.delete(nonce);
    }
  }

  return {
    create(companyId: string, actorId: string): string {
      prune();
      const nonce = generateNonce();
      store.set(nonce, {
        nonce,
        companyId,
        actorId,
        expiresAt: Date.now() + NONCE_TTL_MS,
        used: false,
      });
      return nonce;
    },

    consume(nonce: string, companyId: string): { ok: true } | { ok: false; reason: string } {
      const entry = store.get(nonce);
      if (!entry) return { ok: false, reason: "State nonce not found or already expired" };
      if (entry.used) return { ok: false, reason: "State nonce already consumed (replay detected)" };
      if (entry.expiresAt < Date.now()) {
        store.delete(nonce);
        return { ok: false, reason: "State nonce expired" };
      }
      if (entry.companyId !== companyId) {
        return { ok: false, reason: "State nonce company mismatch" };
      }
      // Mark as used (single-use)
      entry.used = true;
      return { ok: true };
    },

    clear() {
      store.clear();
    },
  };
}

/** Module-level singleton. Replace via dependency injection in tests. */
export const memoryOAuthStateStore: OAuthStateStore = makeMemoryOAuthStateStore();
