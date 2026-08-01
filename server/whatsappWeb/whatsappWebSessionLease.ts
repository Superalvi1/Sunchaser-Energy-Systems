/**
 * Exclusive WhatsApp Web session lease (database CAS fencing).
 *
 * Design:
 * - Stable session_key + random owner_token + monotonic fencing_version.
 * - Acquire / heartbeat / release are store operations guarded by
 *   session_key + owner_token + fencing_version (no read-then-mutate TOCTOU).
 * - Ops are serialized; release invalidates in-flight heartbeats and awaits them.
 * - Intentional release never fires onLeaseLost.
 *
 * Ops: Render numInstances=1. Prefer DATABASE_URL + migration
 * `scripts/whatsapp-web-session-lease-migration.sql` (manual apply only).
 * Without a DB URL, a process-local in-memory store is used (tests/dev only).
 *
 * Never stores credentials, phones, QR, or message content.
 */
import { randomUUID } from "node:crypto";
import {
  getSharedInMemoryWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
  type WhatsAppWebLeaseRow,
  type WhatsAppWebSessionLeaseStore,
} from "./whatsappWebSessionLeaseStore.ts";

/** @deprecated Filesystem lock removed; kept for import compatibility. */
export const WHATSAPP_WEB_SESSION_LOCK_DIR = ".session-owner.lock";

/** @deprecated Legacy file lease name — unused. */
export const WHATSAPP_WEB_SESSION_LEASE_FILE = ".session-owner.lease";

/** Heartbeat refresh interval while lease is held. */
export const WHATSAPP_WEB_SESSION_LEASE_HEARTBEAT_MS = 10_000;

/** Lease TTL / stale reclaim window (DB expires_at). */
export const WHATSAPP_WEB_SESSION_LEASE_STALE_MS = 45_000;

export type WhatsAppWebSessionLeaseStatus =
  | "held"
  | "contested"
  | "absent"
  | "stale_reclaimed"
  | "released"
  | "unavailable";

export type WhatsAppWebLeaseLostReason =
  | "ownership_lost"
  | "heartbeat_failed";

export type WhatsAppWebSessionLeaseSnapshot = {
  status: WhatsAppWebSessionLeaseStatus;
  ownerMatch: boolean;
  ownerIdHash: string | null;
  fencingTokenHash: string | null;
  acquiredAt: string | null;
  heartbeatAt: string | null;
};

export type WhatsAppWebSessionLeaseTestHooks = {
  /** After local ownership verify, before guarded heartbeat mutate. */
  beforeHeartbeatMutate?: () => Promise<void>;
  /** After local ownership verify, before guarded release mutate. */
  beforeReleaseMutate?: () => Promise<void>;
};

export type WhatsAppWebSessionLeaseOptions = {
  now?: () => Date;
  heartbeatMs?: number;
  staleMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  store?: WhatsAppWebSessionLeaseStore;
  onLeaseLost?: (reason: WhatsAppWebLeaseLostReason) => void;
  /** Test-only deterministic race barriers. */
  testHooks?: WhatsAppWebSessionLeaseTestHooks;
};

function truncateId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 24 ? value.slice(0, 24) : value;
}

export class WhatsAppWebSessionLease {
  private readonly ownerId: string;
  private readonly now: () => Date;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly store: WhatsAppWebSessionLeaseStore;
  private readonly onLeaseLost:
    | ((reason: WhatsAppWebLeaseLostReason) => void)
    | null;
  private readonly testHooks: WhatsAppWebSessionLeaseTestHooks;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mutex: Promise<void> = Promise.resolve();
  private inFlightBeat: Promise<void> = Promise.resolve();
  private opEpoch = 0;
  private intentionalRelease = false;
  private leaseLostFired = false;
  private held = false;
  private ownerToken: string | null = null;
  private fencingVersion: number | null = null;
  private sessionKey: string | null = null;
  private lastStatus: WhatsAppWebSessionLeaseStatus = "absent";
  private lastAcquiredAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastOwnerId: string | null = null;

  constructor(ownerId: string, options: WhatsAppWebSessionLeaseOptions = {}) {
    this.ownerId = ownerId;
    this.now = options.now ?? (() => new Date());
    this.heartbeatMs =
      options.heartbeatMs ?? WHATSAPP_WEB_SESSION_LEASE_HEARTBEAT_MS;
    this.staleMs = options.staleMs ?? WHATSAPP_WEB_SESSION_LEASE_STALE_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.store = options.store ?? getSharedInMemoryWhatsAppWebSessionLeaseStore();
    this.onLeaseLost = options.onLeaseLost ?? null;
    this.testHooks = options.testHooks ?? {};
  }

  getSnapshot(): WhatsAppWebSessionLeaseSnapshot {
    return {
      status: this.lastStatus,
      ownerMatch:
        this.held &&
        this.lastOwnerId === this.ownerId &&
        this.ownerToken != null &&
        this.fencingVersion != null,
      ownerIdHash: truncateId(this.lastOwnerId),
      fencingTokenHash: truncateId(this.ownerToken),
      acquiredAt: this.lastAcquiredAt,
      heartbeatAt: this.lastHeartbeatAt,
    };
  }

  isHeld(): boolean {
    return (
      this.held === true &&
      this.ownerToken != null &&
      this.fencingVersion != null
    );
  }

  async acquire(paths: {
    sessionDir: string;
    authRoot: string;
  }): Promise<WhatsAppWebSessionLeaseSnapshot> {
    return this.withLock(async () => {
      this.sessionKey = resolveWhatsAppWebSessionLeaseKey(paths.sessionDir);
      const ownerToken = randomUUID();
      const result = await this.store.tryAcquire({
        sessionKey: this.sessionKey,
        ownerId: this.ownerId,
        ownerToken,
        staleMs: this.staleMs,
        pid: process.pid,
        currentOwnerToken: this.held ? this.ownerToken : null,
        currentFencingVersion: this.held ? this.fencingVersion : null,
      });

      if (result.outcome === "held" || result.outcome === "stale_reclaimed") {
        this.applyHeldRow(result.row, result.outcome);
        return this.getSnapshot();
      }

      if (result.outcome === "contested") {
        this.markNotHeld("contested", result.row);
        return this.getSnapshot();
      }

      this.markNotHeld("unavailable", null);
      return this.getSnapshot();
    });
  }

  async release(): Promise<void> {
    // Invalidate any in-flight heartbeat before/during barrier windows.
    await this.withLock(async () => {
      this.stopHeartbeat();
      this.intentionalRelease = true;
      this.opEpoch += 1;
    });

    await this.inFlightBeat.catch(() => undefined);

    let prepared: {
      sessionKey: string;
      ownerToken: string;
      fencingVersion: number;
    } | null = null;

    await this.withLock(async () => {
      if (
        !this.sessionKey ||
        !this.ownerToken ||
        this.fencingVersion == null ||
        !this.held
      ) {
        this.clearLocalOwnership("released");
        return;
      }
      prepared = {
        sessionKey: this.sessionKey,
        ownerToken: this.ownerToken,
        fencingVersion: this.fencingVersion,
      };
    });

    if (!prepared) return;

    if (this.testHooks.beforeReleaseMutate) {
      await this.testHooks.beforeReleaseMutate();
    }

    await this.withLock(async () => {
      // Guarded delete — older fencing version cannot remove a replacement.
      await this.store.release(prepared!);
      this.clearLocalOwnership("released");
    });
  }

  private applyHeldRow(
    row: WhatsAppWebLeaseRow,
    status: "held" | "stale_reclaimed"
  ): void {
    this.intentionalRelease = false;
    this.leaseLostFired = false;
    this.held = true;
    this.ownerToken = row.ownerToken;
    this.fencingVersion = row.fencingVersion;
    this.lastStatus = status;
    this.lastOwnerId = row.ownerId;
    this.lastAcquiredAt = row.acquiredAt;
    this.lastHeartbeatAt = row.heartbeatAt;
    this.startHeartbeat();
  }

  private markNotHeld(
    status: WhatsAppWebSessionLeaseStatus,
    row: WhatsAppWebLeaseRow | null
  ): void {
    this.stopHeartbeat();
    this.held = false;
    this.ownerToken = null;
    this.fencingVersion = null;
    this.lastStatus = status;
    this.lastOwnerId = row?.ownerId ?? null;
    this.lastAcquiredAt = row?.acquiredAt ?? null;
    this.lastHeartbeatAt = row?.heartbeatAt ?? null;
  }

  private clearLocalOwnership(status: WhatsAppWebSessionLeaseStatus): void {
    this.stopHeartbeat();
    this.held = false;
    this.ownerToken = null;
    this.fencingVersion = null;
    this.lastStatus = status;
    this.lastOwnerId = null;
    this.lastHeartbeatAt = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = this.setIntervalFn(() => {
      this.enqueueBeat();
    }, this.heartbeatMs) as ReturnType<typeof setInterval>;
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      try {
        (this.timer as NodeJS.Timeout).unref();
      } catch {
        /* ignore */
      }
    }
  }

  private stopHeartbeat(): void {
    if (this.timer != null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  private enqueueBeat(): void {
    this.inFlightBeat = this.inFlightBeat
      .then(() => this.beat())
      .catch(() => undefined);
  }

  private async beat(): Promise<void> {
    let prepared: {
      sessionKey: string;
      ownerToken: string;
      fencingVersion: number;
      epoch: number;
    } | null = null;

    await this.withLock(async () => {
      if (
        !this.held ||
        this.intentionalRelease ||
        !this.sessionKey ||
        !this.ownerToken ||
        this.fencingVersion == null
      ) {
        return;
      }
      prepared = {
        sessionKey: this.sessionKey,
        ownerToken: this.ownerToken,
        fencingVersion: this.fencingVersion,
        epoch: this.opEpoch,
      };
    });

    if (!prepared) return;

    // Deterministic race hook: ownership verified locally; mutate not yet issued.
    if (this.testHooks.beforeHeartbeatMutate) {
      await this.testHooks.beforeHeartbeatMutate();
    }

    await this.withLock(async () => {
      if (
        this.intentionalRelease ||
        this.opEpoch !== prepared!.epoch ||
        !this.held ||
        this.ownerToken !== prepared!.ownerToken ||
        this.fencingVersion !== prepared!.fencingVersion
      ) {
        // Release invalidated this beat — never fire onLeaseLost.
        return;
      }

      const result = await this.store.heartbeat({
        sessionKey: prepared!.sessionKey,
        ownerToken: prepared!.ownerToken,
        fencingVersion: prepared!.fencingVersion,
        staleMs: this.staleMs,
        pid: process.pid,
      });

      if (result === "ok") {
        this.lastStatus = "held";
        this.lastHeartbeatAt = this.now().toISOString();
        return;
      }
      if (result === "not_owner") {
        this.failLease("ownership_lost");
        return;
      }
      this.failLease("heartbeat_failed");
    });
  }

  private failLease(reason: WhatsAppWebLeaseLostReason): void {
    if (this.intentionalRelease) return;
    const wasHeld = this.held;
    this.stopHeartbeat();
    this.held = false;
    this.ownerToken = null;
    this.fencingVersion = null;
    this.lastStatus =
      reason === "heartbeat_failed" ? "unavailable" : "contested";
    if (!wasHeld) return;
    if (this.leaseLostFired) return;
    this.leaseLostFired = true;
    if (this.onLeaseLost) {
      try {
        this.onLeaseLost(reason);
      } catch {
        /* ignore callback errors */
      }
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.mutex;
    this.mutex = prev.then(() => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Drop local ownership after an external loss signal without mutating the store.
   * Used when the session tears down after a failed guarded heartbeat.
   */
  abandonLocalOwnership(
    status: WhatsAppWebSessionLeaseStatus = "contested"
  ): void {
    this.stopHeartbeat();
    this.held = false;
    this.ownerToken = null;
    this.fencingVersion = null;
    this.lastStatus = status;
    this.lastOwnerId = null;
    this.lastHeartbeatAt = null;
  }

  /** Test-only: run one serialized heartbeat immediately. */
  async __testBeatNow(): Promise<void> {
    await this.beat();
  }

  /** Test-only: current fencing token (never expose via status API). */
  __testGetFencingToken(): string | null {
    return this.ownerToken;
  }

  /** Test-only: current fencing version. */
  __testGetFencingVersion(): number | null {
    return this.fencingVersion;
  }
}
