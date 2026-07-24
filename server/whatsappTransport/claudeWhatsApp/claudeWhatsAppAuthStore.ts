/**
 * Supabase-backed Baileys AuthenticationState.
 * Render disks are ephemeral — a multi-day live test needs session survival.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../../../dbManager.ts";
import {
  CLAUDE_WHATSAPP_SESSION_ID,
} from "./claudeWhatsAppConstants.ts";

type SignalKeyStoreData = Record<string, Record<string, unknown>>;

export type ClaudeWhatsAppAuthStoreDeps = {
  clientFactory?: () => SupabaseClient | null;
  sessionId?: string;
  /** Injected Baileys helpers (tests). */
  baileys?: {
    initAuthCreds: () => Record<string, unknown>;
    BufferJSON: {
      reviver: (key: string, value: unknown) => unknown;
      replacer: (key: string, value: unknown) => unknown;
    };
  };
};

async function loadBaileysHelpers(deps: ClaudeWhatsAppAuthStoreDeps) {
  if (deps.baileys) return deps.baileys;
  const mod = await import("@whiskeysockets/baileys");
  return {
    initAuthCreds: mod.initAuthCreds as () => Record<string, unknown>,
    BufferJSON: mod.BufferJSON as {
      reviver: (key: string, value: unknown) => unknown;
      replacer: (key: string, value: unknown) => unknown;
    },
  };
}

function parseJsonb<T>(
  value: unknown,
  reviver: (key: string, value: unknown) => unknown,
  fallback: T
): T {
  if (value == null) return fallback;
  try {
    const raw =
      typeof value === "string" ? value : JSON.stringify(value);
    return JSON.parse(raw, reviver) as T;
  } catch {
    return fallback;
  }
}

/**
 * Custom AuthenticationState backed by `claude_whatsapp_sessions`.
 * Mirrors useMultiFileAuthState semantics with jsonb persistence.
 */
export async function useClaudeWhatsAppAuthStore(
  deps: ClaudeWhatsAppAuthStoreDeps = {}
): Promise<{
  state: {
    creds: Record<string, unknown>;
    keys: {
      get: (
        type: string,
        ids: string[]
      ) => Promise<{ [id: string]: unknown }>;
      set: (data: SignalKeyStoreData) => Promise<void>;
    };
  };
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
}> {
  const sessionId = deps.sessionId ?? CLAUDE_WHATSAPP_SESSION_ID;
  const clientFactory = deps.clientFactory ?? getSupabase;
  const { initAuthCreds, BufferJSON } = await loadBaileysHelpers(deps);

  const client = clientFactory();
  if (!client) {
    throw new Error(
      "Claude WhatsApp auth store requires an active Supabase client"
    );
  }

  const { data: row, error } = await client
    .from("claude_whatsapp_sessions")
    .select("id, creds, keys")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`claude_whatsapp_sessions read failed: ${error.message}`);
  }

  let creds: Record<string, unknown> = row?.creds
    ? parseJsonb(row.creds, BufferJSON.reviver, initAuthCreds())
    : initAuthCreds();

  let keysBlob: SignalKeyStoreData = row?.keys
    ? parseJsonb(row.keys, BufferJSON.reviver, {})
    : {};

  if (!row) {
    const { error: insertError } = await client
      .from("claude_whatsapp_sessions")
      .upsert(
        {
          id: sessionId,
          creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
          keys: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    if (insertError) {
      throw new Error(
        `claude_whatsapp_sessions insert failed: ${insertError.message}`
      );
    }
  }

  async function persist(): Promise<void> {
    const supabase = clientFactory();
    if (!supabase) {
      throw new Error("Supabase unavailable while saving Claude WhatsApp session");
    }
    const { error: upsertError } = await supabase
      .from("claude_whatsapp_sessions")
      .upsert(
        {
          id: sessionId,
          creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
          keys: JSON.parse(JSON.stringify(keysBlob, BufferJSON.replacer)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    if (upsertError) {
      throw new Error(
        `claude_whatsapp_sessions upsert failed: ${upsertError.message}`
      );
    }
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out: { [id: string]: unknown } = {};
          const bucket = keysBlob[type] || {};
          for (const id of ids) {
            if (Object.prototype.hasOwnProperty.call(bucket, id)) {
              out[id] = bucket[id];
            }
          }
          return out;
        },
        set: async (data) => {
          for (const [type, entries] of Object.entries(data || {})) {
            keysBlob[type] = keysBlob[type] || {};
            for (const [id, value] of Object.entries(entries || {})) {
              if (value == null) {
                delete keysBlob[type][id];
              } else {
                keysBlob[type][id] = value as unknown;
              }
            }
          }
          await persist();
        },
      },
    },
    saveCreds: async () => {
      await persist();
    },
    clearSession: async () => {
      creds = initAuthCreds();
      keysBlob = {};
      const supabase = clientFactory();
      if (!supabase) return;
      await supabase.from("claude_whatsapp_sessions").upsert(
        {
          id: sessionId,
          creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
          keys: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    },
  };
}
