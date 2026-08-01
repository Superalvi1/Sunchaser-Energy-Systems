/**
 * Exclusive session-directory lease so only one process owns Baileys auth.
 *
 * Design:
 * - Canonical lock is a directory: `.session-owner.lock/`
 * - Acquisition uses mkdir (atomic on the filesystem).
 * - Never overwrites the canonical lock path with rename-from-temp.
 * - Stale reclaim: rename existing lock to a unique tombstone, then mkdir.
 * - Each acquisition has a random fencing token; heartbeats/releases verify it.
 *
 * Ops: Render numInstances=1. This filesystem lease only protects processes that
 * share the same physical session directory. Cross-host without shared storage
 * requires an atomic database lease instead.
 *
 * Never stores credentials, phones, QR, or message content.
 */
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { assertPathInsideRoot } from "./whatsappWebAuthDir.ts";

/** Canonical exclusive lock directory name under the session dir. */
export const WHATSAPP_WEB_SESSION_LOCK_DIR = ".session-owner.lock";

/** @deprecated Legacy file lease name — quarantined on sight. */
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

type LeaseRecord = {
  ownerId: string;
  fencingToken: string;
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
  /** Called when a held lease is lost (ownership stolen / heartbeat failure). */
  onLeaseLost?: (reason: WhatsAppWebLeaseLostReason) => void;
};

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function truncateId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 24 ? value.slice(0, 24) : value;
}

function lockDirPath(sessionDir: string, authRoot: string): string {
  const dir = path.join(path.resolve(sessionDir), WHATSAPP_WEB_SESSION_LOCK_DIR);
  assertPathInsideRoot(dir, authRoot);
  return dir;
}

function ownerMetaPath(lockDir: string, authRoot: string): string {
  const filePath = path.join(lockDir, "owner.json");
  assertPathInsideRoot(filePath, authRoot);
  return filePath;
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

/** Fail-closed: only reclaim missing/malformed meta when the lock dir itself is old. */
async function isLockDirectoryStale(
  lockDir: string,
  nowMs: number,
  staleMs: number
): Promise<boolean> {
  try {
    const st = await fsp.stat(lockDir);
    return nowMs - st.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

async function readOwnerMeta(
  lockDir: string,
  authRoot: string
): Promise<LeaseRecord | null> {
  try {
    const raw = await fsp.readFile(ownerMetaPath(lockDir, authRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      typeof parsed.ownerId !== "string" ||
      !parsed.ownerId.trim() ||
      typeof parsed.fencingToken !== "string" ||
      !parsed.fencingToken.trim() ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.heartbeatAt !== "string" ||
      typeof parsed.pid !== "number"
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      fencingToken: parsed.fencingToken,
      acquiredAt: parsed.acquiredAt,
      heartbeatAt: parsed.heartbeatAt,
      pid: parsed.pid,
    };
  } catch {
    return null;
  }
}

async function writeOwnerMeta(
  lockDir: string,
  authRoot: string,
  record: LeaseRecord
): Promise<void> {
  const metaPath = ownerMetaPath(lockDir, authRoot);
  const tmp = path.join(
    lockDir,
    `owner.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`
  );
  assertPathInsideRoot(tmp, authRoot);
  // Temp + rename is safe only inside the owned lock directory.
  await fsp.writeFile(tmp, JSON.stringify(record), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fsp.rename(tmp, metaPath);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function removeTreeBestEffort(target: string): Promise<void> {
  try {
    await fsp.rm(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export class WhatsAppWebSessionLease {
  private readonly ownerId: string;
  private readonly now: () => Date;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly onLeaseLost: ((reason: WhatsAppWebLeaseLostReason) => void) | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private beatChain: Promise<void> = Promise.resolve();
  private held = false;
  private fencingToken: string | null = null;
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
    this.onLeaseLost = options.onLeaseLost ?? null;
  }

  getSnapshot(): WhatsAppWebSessionLeaseSnapshot {
    return {
      status: this.lastStatus,
      ownerMatch:
        this.held &&
        this.lastOwnerId === this.ownerId &&
        this.fencingToken != null,
      ownerIdHash: truncateId(this.lastOwnerId),
      fencingTokenHash: truncateId(this.fencingToken),
      acquiredAt: this.lastAcquiredAt,
      heartbeatAt: this.lastHeartbeatAt,
    };
  }

  isHeld(): boolean {
    return this.held === true && this.fencingToken != null;
  }

  async acquire(paths: {
    sessionDir: string;
    authRoot: string;
  }): Promise<WhatsAppWebSessionLeaseSnapshot> {
    this.paths = paths;
    await this.quarantineLegacyLeaseFile(paths);

    const lockDir = lockDirPath(paths.sessionDir, paths.authRoot);
    const mkdirResult = await this.tryMkdirLock(lockDir);
    if (mkdirResult === "created") {
      return this.becomeOwner(lockDir, paths.authRoot, "held");
    }
    if (mkdirResult === "error") {
      return this.getSnapshot();
    }

    // Lock directory exists — inspect freshness / reclaim.
    const existing = await readOwnerMeta(lockDir, paths.authRoot);
    const nowMs = this.now().getTime();

    if (existing) {
      if (isFresh(existing, nowMs, this.staleMs)) {
        if (
          existing.ownerId === this.ownerId &&
          this.fencingToken != null &&
          existing.fencingToken === this.fencingToken
        ) {
          // Same acquisition refreshing.
          this.held = true;
          this.lastStatus = "held";
          this.lastOwnerId = existing.ownerId;
          this.lastAcquiredAt = existing.acquiredAt;
          this.lastHeartbeatAt = existing.heartbeatAt;
          this.startHeartbeat();
          return this.getSnapshot();
        }
        this.markContested(existing);
        return this.getSnapshot();
      }
    } else {
      // Missing/malformed meta: never reclaim a fresh lock dir (mkdir→write race).
      const dirStale = await isLockDirectoryStale(lockDir, nowMs, this.staleMs);
      if (!dirStale) {
        this.held = false;
        this.fencingToken = null;
        this.lastStatus = "contested";
        this.lastOwnerId = null;
        this.lastAcquiredAt = null;
        this.lastHeartbeatAt = null;
        return this.getSnapshot();
      }
    }

    // Proven stale (old heartbeat) or proven-stale empty/malformed lock → reclaim.
    const reclaimed = await this.reclaimStaleLock(lockDir, paths);
    if (reclaimed) {
      return this.becomeOwner(lockDir, paths.authRoot, "stale_reclaimed");
    }

    // Lost the mkdir race after quarantine, or reclaim failed closed.
    const after = await readOwnerMeta(lockDir, paths.authRoot);
    if (after && isFresh(after, this.now().getTime(), this.staleMs)) {
      this.markContested(after);
      return this.getSnapshot();
    }
    this.held = false;
    this.fencingToken = null;
    this.lastStatus = "unavailable";
    this.lastOwnerId = after?.ownerId ?? null;
    this.lastAcquiredAt = after?.acquiredAt ?? null;
    this.lastHeartbeatAt = after?.heartbeatAt ?? null;
    return this.getSnapshot();
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    const token = this.fencingToken;
    const paths = this.paths;
    if (!paths || !this.held || !token) {
      this.held = false;
      this.fencingToken = null;
      if (this.lastStatus !== "contested" && this.lastStatus !== "unavailable") {
        this.lastStatus = "released";
      }
      return;
    }

    const lockDir = lockDirPath(paths.sessionDir, paths.authRoot);
    try {
      const existing = await readOwnerMeta(lockDir, paths.authRoot);
      // Never delete a replacement owner's lock.
      if (!existing || existing.fencingToken !== token) {
        this.held = false;
        this.fencingToken = null;
        this.lastStatus = "released";
        this.lastOwnerId = null;
        this.lastHeartbeatAt = null;
        return;
      }

      const releasedName = `${WHATSAPP_WEB_SESSION_LOCK_DIR}.released.${token.slice(0, 8)}.${Date.now()}`;
      const releasedPath = path.join(path.resolve(paths.sessionDir), releasedName);
      assertPathInsideRoot(releasedPath, paths.authRoot);
      // Atomic hand-off of our lock dir; only then delete the quarantined copy.
      await fsp.rename(lockDir, releasedPath);
      await removeTreeBestEffort(releasedPath);
    } catch {
      /* ignore — another reclaim may have already moved the lock */
    }

    this.held = false;
    this.fencingToken = null;
    this.lastStatus = "released";
    this.lastOwnerId = null;
    this.lastHeartbeatAt = null;
  }

  private async becomeOwner(
    lockDir: string,
    authRoot: string,
    status: "held" | "stale_reclaimed"
  ): Promise<WhatsAppWebSessionLeaseSnapshot> {
    const fencingToken = randomUUID();
    const acquiredAt = nowIso(this.now);
    const record: LeaseRecord = {
      ownerId: this.ownerId,
      fencingToken,
      acquiredAt,
      heartbeatAt: acquiredAt,
      pid: process.pid,
    };
    try {
      await writeOwnerMeta(lockDir, authRoot, record);
    } catch {
      // Failed to publish — only remove if the lock is still ours / empty.
      try {
        const cur = await readOwnerMeta(lockDir, authRoot);
        if (!cur || cur.fencingToken === fencingToken) {
          const tomb = `${lockDir}.orphan.${fencingToken.slice(0, 8)}.${Date.now()}`;
          assertPathInsideRoot(tomb, authRoot);
          await fsp.rename(lockDir, tomb);
          await removeTreeBestEffort(tomb);
        }
      } catch {
        /* another reclaim may have moved the lock */
      }
      this.held = false;
      this.fencingToken = null;
      this.lastStatus = "unavailable";
      this.lastOwnerId = null;
      this.lastAcquiredAt = null;
      this.lastHeartbeatAt = null;
      return this.getSnapshot();
    }

    // Confirm fencing token still ours (another reclaim could race).
    const confirmed = await readOwnerMeta(lockDir, authRoot);
    if (!confirmed || confirmed.fencingToken !== fencingToken) {
      this.held = false;
      this.fencingToken = null;
      this.lastStatus = "contested";
      this.lastOwnerId = confirmed?.ownerId ?? null;
      this.lastAcquiredAt = confirmed?.acquiredAt ?? null;
      this.lastHeartbeatAt = confirmed?.heartbeatAt ?? null;
      return this.getSnapshot();
    }

    this.held = true;
    this.fencingToken = fencingToken;
    this.lastStatus = status;
    this.lastOwnerId = confirmed.ownerId;
    this.lastAcquiredAt = confirmed.acquiredAt;
    this.lastHeartbeatAt = confirmed.heartbeatAt;
    this.startHeartbeat();
    return this.getSnapshot();
  }

  private markContested(existing: LeaseRecord): void {
    this.held = false;
    this.fencingToken = null;
    this.lastStatus = "contested";
    this.lastOwnerId = existing.ownerId;
    this.lastAcquiredAt = existing.acquiredAt;
    this.lastHeartbeatAt = existing.heartbeatAt;
  }

  private async tryMkdirLock(
    lockDir: string
  ): Promise<"created" | "exists" | "error"> {
    try {
      await fsp.mkdir(lockDir);
      return "created";
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") return "exists";
      this.held = false;
      this.fencingToken = null;
      this.lastStatus = "unavailable";
      return "error";
    }
  }

  /**
   * Quarantine an existing lock directory, then compete for mkdir.
   * Rename is used only to move the old lock aside — never onto the canonical path.
   */
  private async reclaimStaleLock(
    lockDir: string,
    paths: { sessionDir: string; authRoot: string }
  ): Promise<boolean> {
    const tombstone = path.join(
      path.resolve(paths.sessionDir),
      `${WHATSAPP_WEB_SESSION_LOCK_DIR}.tombstone.${Date.now()}.${randomUUID().slice(0, 8)}`
    );
    assertPathInsideRoot(tombstone, paths.authRoot);

    if (await pathExists(lockDir)) {
      try {
        await fsp.rename(lockDir, tombstone);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          // Cannot prove safe reclaim.
          return false;
        }
        // Already moved by a concurrent reclaimer — fall through to mkdir.
      }
    }

    const mkdirResult = await this.tryMkdirLock(lockDir);
    // Best-effort cleanup of our tombstone (or orphaned ones).
    await removeTreeBestEffort(tombstone);
    return mkdirResult === "created";
  }

  private async quarantineLegacyLeaseFile(paths: {
    sessionDir: string;
    authRoot: string;
  }): Promise<void> {
    const legacy = path.join(
      path.resolve(paths.sessionDir),
      WHATSAPP_WEB_SESSION_LEASE_FILE
    );
    try {
      assertPathInsideRoot(legacy, paths.authRoot);
      const st = await fsp.lstat(legacy);
      if (st.isFile()) {
        const tomb = `${legacy}.tombstone.${Date.now()}`;
        assertPathInsideRoot(tomb, paths.authRoot);
        await fsp.rename(legacy, tomb);
        await removeTreeBestEffort(tomb);
      }
    } catch {
      /* ignore */
    }
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
    this.beatChain = this.beatChain
      .then(() => this.beat())
      .catch(() => undefined);
  }

  private async beat(): Promise<void> {
    if (!this.held || !this.paths || !this.fencingToken) return;
    const token = this.fencingToken;
    const lockDir = lockDirPath(this.paths.sessionDir, this.paths.authRoot);

    let existing: LeaseRecord | null = null;
    try {
      existing = await readOwnerMeta(lockDir, this.paths.authRoot);
    } catch {
      this.failLease("heartbeat_failed");
      return;
    }

    if (!existing || existing.fencingToken !== token) {
      this.failLease("ownership_lost");
      return;
    }

    const record: LeaseRecord = {
      ...existing,
      heartbeatAt: nowIso(this.now),
      pid: process.pid,
    };
    try {
      await writeOwnerMeta(lockDir, this.paths.authRoot, record);
      // Re-verify fencing token after write.
      const confirmed = await readOwnerMeta(lockDir, this.paths.authRoot);
      if (!confirmed || confirmed.fencingToken !== token) {
        this.failLease("ownership_lost");
        return;
      }
      this.lastStatus = "held";
      this.lastHeartbeatAt = record.heartbeatAt;
    } catch {
      this.failLease("heartbeat_failed");
    }
  }

  private failLease(reason: WhatsAppWebLeaseLostReason): void {
    const wasHeld = this.held;
    this.stopHeartbeat();
    this.held = false;
    this.fencingToken = null;
    this.lastStatus = reason === "heartbeat_failed" ? "unavailable" : "contested";
    if (wasHeld && this.onLeaseLost) {
      try {
        this.onLeaseLost(reason);
      } catch {
        /* ignore callback errors */
      }
    }
  }

  /** Test-only: run one serialized heartbeat immediately. */
  async __testBeatNow(): Promise<void> {
    await this.beat();
  }

  /** Test-only: current fencing token (never expose via status API). */
  __testGetFencingToken(): string | null {
    return this.fencingToken;
  }
}
