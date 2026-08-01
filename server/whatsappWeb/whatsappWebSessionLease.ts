/**
 * Exclusive session-directory lease so only one process owns Baileys auth.
 * File-based heartbeat lease on the shared auth disk (Render persistent disk).
 * Never stores credentials, phones, QR, or message content.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { assertPathInsideRoot } from "./whatsappWebAuthDir.ts";

export const WHATSAPP_WEB_SESSION_LEASE_FILE = ".session-owner.lease";

/** Heartbeat refresh interval while lease is held. */
export const WHATSAPP_WEB_SESSION_LEASE_HEARTBEAT_MS = 10_000;

/** Lease is reclaimable when heartbeat is older than this. */
export const WHATSAPP_WEB_SESSION_LEASE_STALE_MS = 45_000;

export type WhatsAppWebSessionLeaseStatus =
  | "held"
  | "contested"
  | "absent"
  | "stale_reclaimed"
  | "released"
  | "unavailable";

export type WhatsAppWebSessionLeaseSnapshot = {
  status: WhatsAppWebSessionLeaseStatus;
  ownerMatch: boolean;
  ownerIdHash: string | null;
  acquiredAt: string | null;
  heartbeatAt: string | null;
};

type LeaseRecord = {
  ownerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  pid: number;
};

export type WhatsAppWebSessionLeaseOptions = {
  now?: () => Date;
  heartbeatMs?: number;
  staleMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function leasePath(sessionDir: string, authRoot: string): string {
  const filePath = path.join(
    path.resolve(sessionDir),
    WHATSAPP_WEB_SESSION_LEASE_FILE
  );
  assertPathInsideRoot(filePath, authRoot);
  return filePath;
}

async function readLease(filePath: string): Promise<LeaseRecord | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      typeof parsed.ownerId !== "string" ||
      !parsed.ownerId.trim() ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.heartbeatAt !== "string" ||
      typeof parsed.pid !== "number"
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      acquiredAt: parsed.acquiredAt,
      heartbeatAt: parsed.heartbeatAt,
      pid: parsed.pid,
    };
  } catch {
    return null;
  }
}

async function writeLeaseAtomic(
  filePath: string,
  record: LeaseRecord
): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fsp.rename(tmp, filePath);
}

function isFresh(
  record: LeaseRecord,
  nowMs: number,
  staleMs: number
): boolean {
  const hb = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(hb)) return false;
  return nowMs - hb <= staleMs;
}

export class WhatsAppWebSessionLease {
  private readonly ownerId: string;
  private readonly now: () => Date;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | null = null;
  private held = false;
  private lastStatus: WhatsAppWebSessionLeaseStatus = "absent";
  private lastAcquiredAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastOwnerId: string | null = null;
  private paths: { sessionDir: string; authRoot: string } | null = null;

  constructor(ownerId: string, options: WhatsAppWebSessionLeaseOptions = {}) {
    this.ownerId = ownerId;
    this.now = options.now ?? (() => new Date());
    this.heartbeatMs =
      options.heartbeatMs ?? WHATSAPP_WEB_SESSION_LEASE_HEARTBEAT_MS;
    this.staleMs = options.staleMs ?? WHATSAPP_WEB_SESSION_LEASE_STALE_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  getSnapshot(): WhatsAppWebSessionLeaseSnapshot {
    return {
      status: this.lastStatus,
      ownerMatch: this.held && this.lastOwnerId === this.ownerId,
      ownerIdHash: this.lastOwnerId
        ? this.lastOwnerId.length > 24
          ? this.lastOwnerId.slice(0, 24)
          : this.lastOwnerId
        : null,
      acquiredAt: this.lastAcquiredAt,
      heartbeatAt: this.lastHeartbeatAt,
    };
  }

  isHeld(): boolean {
    return this.held;
  }

  async acquire(paths: {
    sessionDir: string;
    authRoot: string;
  }): Promise<WhatsAppWebSessionLeaseSnapshot> {
    this.paths = paths;
    const filePath = leasePath(paths.sessionDir, paths.authRoot);
    const nowMs = this.now().getTime();
    const existing = await readLease(filePath);

    if (existing && isFresh(existing, nowMs, this.staleMs)) {
      if (existing.ownerId === this.ownerId) {
        this.held = true;
        this.lastStatus = "held";
        this.lastOwnerId = existing.ownerId;
        this.lastAcquiredAt = existing.acquiredAt;
        this.lastHeartbeatAt = existing.heartbeatAt;
        this.startHeartbeat();
        return this.getSnapshot();
      }
      this.held = false;
      this.lastStatus = "contested";
      this.lastOwnerId = existing.ownerId;
      this.lastAcquiredAt = existing.acquiredAt;
      this.lastHeartbeatAt = existing.heartbeatAt;
      return this.getSnapshot();
    }

    const acquiredAt =
      existing && existing.ownerId === this.ownerId
        ? existing.acquiredAt
        : nowIso(this.now);
    const record: LeaseRecord = {
      ownerId: this.ownerId,
      acquiredAt,
      heartbeatAt: nowIso(this.now),
      pid: process.pid,
    };

    try {
      await writeLeaseAtomic(filePath, record);
    } catch {
      this.held = false;
      this.lastStatus = "unavailable";
      this.lastOwnerId = null;
      this.lastAcquiredAt = null;
      this.lastHeartbeatAt = null;
      return this.getSnapshot();
    }

    const confirmed = await readLease(filePath);
    if (!confirmed || confirmed.ownerId !== this.ownerId) {
      this.held = false;
      this.lastStatus = "contested";
      this.lastOwnerId = confirmed?.ownerId ?? null;
      this.lastAcquiredAt = confirmed?.acquiredAt ?? null;
      this.lastHeartbeatAt = confirmed?.heartbeatAt ?? null;
      return this.getSnapshot();
    }

    this.held = true;
    this.lastStatus =
      existing && !isFresh(existing, nowMs, this.staleMs)
        ? "stale_reclaimed"
        : "held";
    this.lastOwnerId = confirmed.ownerId;
    this.lastAcquiredAt = confirmed.acquiredAt;
    this.lastHeartbeatAt = confirmed.heartbeatAt;
    this.startHeartbeat();
    return this.getSnapshot();
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.paths || !this.held) {
      this.held = false;
      if (this.lastStatus !== "contested" && this.lastStatus !== "unavailable") {
        this.lastStatus = "released";
      }
      return;
    }
    const filePath = leasePath(this.paths.sessionDir, this.paths.authRoot);
    try {
      const existing = await readLease(filePath);
      if (existing?.ownerId === this.ownerId) {
        await fsp.unlink(filePath);
      }
    } catch {
      /* ignore */
    }
    this.held = false;
    this.lastStatus = "released";
    this.lastOwnerId = null;
    this.lastHeartbeatAt = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = this.setIntervalFn(() => {
      void this.beat();
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

  private async beat(): Promise<void> {
    if (!this.held || !this.paths) return;
    const filePath = leasePath(this.paths.sessionDir, this.paths.authRoot);
    const existing = await readLease(filePath);
    if (!existing || existing.ownerId !== this.ownerId) {
      this.held = false;
      this.lastStatus = "contested";
      this.lastOwnerId = existing?.ownerId ?? null;
      this.stopHeartbeat();
      return;
    }
    const record: LeaseRecord = {
      ...existing,
      heartbeatAt: nowIso(this.now),
      pid: process.pid,
    };
    try {
      await writeLeaseAtomic(filePath, record);
      this.lastStatus = "held";
      this.lastHeartbeatAt = record.heartbeatAt;
    } catch {
      this.held = false;
      this.lastStatus = "unavailable";
      this.stopHeartbeat();
    }
  }
}
