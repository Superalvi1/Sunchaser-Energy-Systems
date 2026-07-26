/**
 * Bounded, session-safe queue for WhatsApp contact / LID persistence.
 * Limits concurrent DB writes; isolates per-task failures.
 * Optional per-key serialization: same key never runs concurrently.
 * Optional maxPending + coalesceKey bound memory for high-churn paths.
 */

export const WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY = 3;

export type ContactIdentityPersistTask<T> = () => Promise<T>;

export type ContactIdentityPersistEnqueueOptions = {
  /** When set, at most one task with this key runs at a time (FIFO among that key). */
  key?: string;
  /**
   * When set, duplicate pending/in-flight work with the same coalesce key shares
   * one execution. Callers all settle with that single result.
   */
  coalesceKey?: string;
};

export type ContactIdentityPersistQueueOptions = {
  concurrency?: number;
  onTaskError?: () => void;
  /**
   * Hard cap on pending[] length. When at capacity and the new work cannot be
   * coalesced, enqueue settles immediately (fail-closed overflow) and calls
   * onOverflow. Undefined = unlimited (legacy contact-identity path).
   */
  maxPending?: number;
  onOverflow?: () => void;
};

type PendingItem = {
  run: ContactIdentityPersistTask<unknown>;
  resolvers: Array<(value: unknown) => void>;
  key: string | null;
  coalesceKey: string | null;
};

/**
 * Small FIFO worker pool. Never throws out of enqueue(); failures are isolated.
 * `close()` drops pending work and refuses new enqueues (logout/shutdown).
 * Active tasks settle via `whenIdle()` / `closeAndDrain()` before a replacement
 * queue may run.
 */
export class ContactIdentityPersistQueue {
  private readonly concurrency: number;
  private readonly maxPending: number | null;
  private readonly onTaskError?: () => void;
  private readonly onOverflow?: () => void;
  private readonly pending: PendingItem[] = [];
  private readonly activeKeys = new Set<string>();
  private readonly activePerKey = new Map<string, number>();
  private readonly peakPerKey = new Map<string, number>();
  private readonly activeCoalesce = new Map<string, Promise<unknown>>();
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;
  private closed = false;
  /** Test observability: peak observed global concurrency. */
  peakActive = 0;
  /** Test observability: peak pending[] length. */
  peakPending = 0;
  /** Test observability: overflow drop count. */
  overflowCount = 0;
  /** Test observability: how many enqueues joined an existing coalesce slot. */
  coalesceCount = 0;

  constructor(options: ContactIdentityPersistQueueOptions = {}) {
    this.concurrency = Math.max(
      1,
      options.concurrency ?? WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY
    );
    this.maxPending =
      typeof options.maxPending === "number" && Number.isFinite(options.maxPending)
        ? Math.max(0, Math.floor(options.maxPending))
        : null;
    this.onTaskError = options.onTaskError;
    this.onOverflow = options.onOverflow;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.active;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Test observability: peak concurrency observed for a serialization key. */
  getPeakActiveForKey(key: string): number {
    return this.peakPerKey.get(key) ?? 0;
  }

  /**
   * Resolves when there are no active tasks. Pending-only queues with active=0
   * resolve immediately.
   */
  whenIdle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /**
   * Drop pending tasks and refuse new work. Active tasks finish but callers
   * should no-op themselves when the session is shutting down for work not
   * yet issued to the repository.
   * Every pending enqueue promise settles.
   */
  close(): void {
    this.closed = true;
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      for (const resolve of next.resolvers) resolve(undefined);
    }
    this.notifyIdleIfNeeded();
  }

  /** close() then wait until every active task has settled. */
  async closeAndDrain(): Promise<void> {
    this.close();
    await this.whenIdle();
  }

  /**
   * Schedule work. Resolves when the task finishes (success or failure), when
   * coalesced onto existing work, when overflow-dropped, or when the queue is
   * closed. Failures are swallowed after onTaskError — callers may still await.
   * Same `key` tasks never run concurrently; different keys share the global cap.
   */
  enqueue<T>(
    task: ContactIdentityPersistTask<T>,
    options: ContactIdentityPersistEnqueueOptions = {}
  ): Promise<T | undefined> {
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    const key =
      typeof options.key === "string" && options.key.trim()
        ? options.key.trim()
        : null;
    const coalesceKey =
      typeof options.coalesceKey === "string" && options.coalesceKey.trim()
        ? options.coalesceKey.trim()
        : null;

    return new Promise<T | undefined>((resolve) => {
      if (this.closed) {
        resolve(undefined);
        return;
      }

      if (coalesceKey) {
        const pendingMatch = this.pending.find(
          (item) => item.coalesceKey === coalesceKey
        );
        if (pendingMatch) {
          this.coalesceCount += 1;
          pendingMatch.resolvers.push((value) =>
            resolve(value as T | undefined)
          );
          return;
        }
        const activeMatch = this.activeCoalesce.get(coalesceKey);
        if (activeMatch) {
          this.coalesceCount += 1;
          void activeMatch.then(
            (value) => resolve(value as T | undefined),
            () => resolve(undefined)
          );
          return;
        }
      }

      if (this.maxPending != null && this.pending.length >= this.maxPending) {
        this.overflowCount += 1;
        this.onOverflow?.();
        resolve(undefined);
        return;
      }

      this.pending.push({
        run: task as ContactIdentityPersistTask<unknown>,
        resolvers: [(value) => resolve(value as T | undefined)],
        key,
        coalesceKey,
      });
      if (this.pending.length > this.peakPending) {
        this.peakPending = this.pending.length;
      }
      this.pump();
    });
  }

  private settleItem(item: PendingItem, value: unknown): void {
    for (const resolve of item.resolvers) resolve(value);
  }

  private notifyIdleIfNeeded(): void {
    if (this.active !== 0 || this.idleWaiters.length === 0) return;
    const waiters = this.idleWaiters.splice(0);
    for (const w of waiters) w();
  }

  private pump(): void {
    while (!this.closed && this.active < this.concurrency) {
      const idx = this.pending.findIndex(
        (item) => !item.key || !this.activeKeys.has(item.key)
      );
      if (idx < 0) break;
      const next = this.pending.splice(idx, 1)[0];
      if (!next) return;

      this.active += 1;
      if (this.active > this.peakActive) this.peakActive = this.active;

      if (next.key) {
        this.activeKeys.add(next.key);
        const per = (this.activePerKey.get(next.key) ?? 0) + 1;
        this.activePerKey.set(next.key, per);
        const peak = this.peakPerKey.get(next.key) ?? 0;
        if (per > peak) this.peakPerKey.set(next.key, per);
      }

      let settleActiveCoalesce: ((value: unknown) => void) | null = null;
      if (next.coalesceKey) {
        const coalescePromise = new Promise<unknown>((resolve) => {
          settleActiveCoalesce = resolve;
        });
        this.activeCoalesce.set(next.coalesceKey, coalescePromise);
      }

      void (async () => {
        let result: unknown = undefined;
        try {
          // Active work that already started continues even if close() races
          // after dequeue; only skip run() when closed before invocation.
          if (this.closed) {
            this.settleItem(next, undefined);
            return;
          }
          result = await next.run();
          this.settleItem(next, result);
        } catch {
          this.onTaskError?.();
          result = undefined;
          this.settleItem(next, undefined);
        } finally {
          if (next.coalesceKey) {
            settleActiveCoalesce?.(result);
            this.activeCoalesce.delete(next.coalesceKey);
          }
          if (next.key) {
            this.activeKeys.delete(next.key);
            const per = (this.activePerKey.get(next.key) ?? 1) - 1;
            if (per <= 0) this.activePerKey.delete(next.key);
            else this.activePerKey.set(next.key, per);
          }
          this.active -= 1;
          this.notifyIdleIfNeeded();
          this.pump();
        }
      })();
    }
  }
}
