/**
 * DB-backed kill switch for Claude WhatsApp.
 * Polls `settings.claude_whatsapp_enabled` so abort takes effect in ~2s
 * without a redeploy. Not env-var-backed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../../../dbManager.ts";
import {
  CLAUDE_WHATSAPP_ENABLED_SETTINGS_KEY,
  CLAUDE_WHATSAPP_KILL_SWITCH_POLL_MS,
} from "./claudeWhatsAppConstants.ts";

export type ClaudeWhatsAppKillSwitchDeps = {
  clientFactory?: () => SupabaseClient | null;
  pollMs?: number;
  /** In-memory override for tests (bypasses Supabase). */
  memoryStore?: { enabled: boolean };
  now?: () => number;
  onChange?: (enabled: boolean) => void;
};

function parseEnabledValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.enabled === "boolean") return obj.enabled;
    if (typeof obj.value === "boolean") return obj.value;
  }
  return false;
}

export class ClaudeWhatsAppKillSwitch {
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly clientFactory: () => SupabaseClient | null;
  private readonly pollMs: number;
  private readonly memoryStore?: { enabled: boolean };
  private onChange?: (enabled: boolean) => void;
  private lastFetchedAt = 0;

  constructor(deps: ClaudeWhatsAppKillSwitchDeps = {}) {
    this.clientFactory = deps.clientFactory ?? getSupabase;
    this.pollMs = deps.pollMs ?? CLAUDE_WHATSAPP_KILL_SWITCH_POLL_MS;
    this.memoryStore = deps.memoryStore;
    this.onChange = deps.onChange;
  }

  setOnChange(handler: ((enabled: boolean) => void) | undefined): void {
    this.onChange = handler;
  }

  isEnabled(): boolean {
    if (this.memoryStore) return this.memoryStore.enabled;
    return this.enabled;
  }

  lastCheckAt(): number {
    return this.lastFetchedAt;
  }

  async refresh(): Promise<boolean> {
    if (this.memoryStore) {
      this.lastFetchedAt = Date.now();
      return this.memoryStore.enabled;
    }
    const client = this.clientFactory();
    if (!client) {
      // Fail closed when persistence is unavailable during a live test.
      this.enabled = false;
      this.lastFetchedAt = Date.now();
      return false;
    }
    const { data, error } = await client
      .from("settings")
      .select("value")
      .eq("key", CLAUDE_WHATSAPP_ENABLED_SETTINGS_KEY)
      .maybeSingle();
    this.lastFetchedAt = Date.now();
    if (error) {
      console.error(
        "[claude-whatsapp] kill switch read failed:",
        error.message
      );
      this.enabled = false;
      return false;
    }
    const next = parseEnabledValue(data?.value);
    if (next !== this.enabled) {
      this.enabled = next;
      this.onChange?.(next);
    } else {
      this.enabled = next;
    }
    return this.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.memoryStore) {
      this.memoryStore.enabled = enabled;
      this.enabled = enabled;
      this.lastFetchedAt = Date.now();
      this.onChange?.(enabled);
      return;
    }
    const client = this.clientFactory();
    if (!client) {
      throw new Error("Supabase unavailable — cannot update kill switch");
    }
    const { error } = await client.from("settings").upsert(
      {
        key: CLAUDE_WHATSAPP_ENABLED_SETTINGS_KEY,
        value: enabled,
      },
      { onConflict: "key" }
    );
    if (error) {
      throw new Error(`kill switch write failed: ${error.message}`);
    }
    this.enabled = enabled;
    this.lastFetchedAt = Date.now();
    this.onChange?.(enabled);
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.pollMs);
    // Unref so the poller does not keep the process alive in tests.
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

let singleton: ClaudeWhatsAppKillSwitch | null = null;

export function getClaudeWhatsAppKillSwitch(
  deps?: ClaudeWhatsAppKillSwitchDeps
): ClaudeWhatsAppKillSwitch {
  if (!singleton) {
    singleton = new ClaudeWhatsAppKillSwitch(deps);
  }
  return singleton;
}

/** Test helper — reset singleton between cases. */
export function resetClaudeWhatsAppKillSwitchForTests(): void {
  singleton?.stop();
  singleton = null;
}
