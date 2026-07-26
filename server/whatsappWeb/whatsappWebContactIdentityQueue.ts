/**
 * Bounded, session-safe queue for WhatsApp contact / LID persistence.
 * Limits concurrent DB writes; isolates per-task failures.
 * Optional per-key serialization: same key never runs concurrently.
 * Optional maxPending + coalesceKey bound memory for high-churn paths.
 *
 * Coalesce uses one shared completion promise per key — duplicate enqueues
 * return that same promise and do not append per-caller resolvers.
 */

export const WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY = 3;

export type ContactIdentityPersistTask<T> = () => Promise<T>;

export type ContactIdentityPersistEnqueueOptions = {
  /** When set, at most one task with this key runs at a time (FIFO among that key). */
  key?: string;
  /**
   * When set, duplicate pending/in-flight work with the same coalesce key shares
   * one completion promise (returned by reference).
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

type Deferred<T> = {
  promise: Promise<T>;
  settle: (value: T) => void;
};

type PendingItem = {
  run: ContactIdentityPersistTask<unknown>;
  deferred: Deferred<unknown>;
  key: string | null;
  coalesceKey: string | null;
};

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });
  return { promise, settle };
}

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
  /**
   * One shared completion promise per coalesce key while that work is
   * pending or in-flight. Size is O(distinct in-flight coalesce keys).
   */
  private readonly coalescePromises = new Map<string, Promise<unknown>>();
  /** Settle handles for coalesce/non-coalesce work still outstanding. */
  private readonly openSettles = new Set<(value: unknown) => void>();
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
  /** Test observability: peak coalescePromises map size. */
  peakCoalesceBookkeeping = 0;
  /** Test observability: peak open settle-handle count (queue-side only). */
  peakStoredSettles = 0;

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

  /** Queue-side coalesce bookkeeping entries (pending + in-flight). */
  get coalesceBookkeepingCount(): number {
    return this.coalescePromises.size;
  }

  /** Queue-side stored completion settles (one per outstanding slot). */
  get storedSettleCount(): number {
    return this.openSettles.size;
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
   * Drop pending work and refuse new enqueues. Settles every outstanding
   * completion promise (pending + active-coalesced) so callers never strand.
   * In-flight tasks may still finish; their settle is idempotent.
   */
  close(): void {
    this.closed = true;
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      this.finishDeferred(next.deferred, undefined, next.coalesceKey);
    }
    // Settle any remaining coalesce/active completion handles.
    for (const settle of [...this.openSettles]) {
      settle(undefined);
    }
    this.openSettles.clear();
    this.coalescePromises.clear();
    this.notifyIdleIfNeeded();
  }

  /** close() then wait until every active task has settled. */
  async closeAndDrain(): Promise<void> {
    this.close();
    await this.whenIdle();
  }

  /**
   * Schedule work. Returns a shared completion promise for coalesceKey (same
   * object for duplicates). Never rejects. Failures are swallowed after
   * onTaskError. Same `key` tasks never run concurrently.
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

    if (coalesceKey) {
      const existing = this.coalescePromises.get(coalesceKey);
      if (existing) {
        this.coalesceCount += 1;
        // Return the shared promise by reference — no per-duplicate resolver.
        return existing as Promise<T | undefined>;
      }
    }

    if (this.maxPending != null && this.pending.length >= this.maxPending) {
      this.overflowCount += 1;
      this.invokeOverflowSafely();
      return Promise.resolve(undefined);
    }

    const deferred = createDeferred<unknown>();
    this.openSettles.add(deferred.settle);
    if (this.openSettles.size > this.peakStoredSettles) {
      this.peakStoredSettles = this.openSettles.size;
    }

    if (coalesceKey) {
      this.coalescePromises.set(coalesceKey, deferred.promise);
      if (this.coalescePromises.size > this.peakCoalesceBookkeeping) {
        this.peakCoalesceBookkeeping = this.coalescePromises.size;
      }
    }

    this.pending.push({
      run: task as ContactIdentityPersistTask<unknown>,
      deferred,
      key,
      coalesceKey,
    });
    if (this.pending.length > this.peakPending) {
      this.peakPending = this.pending.length;
    }
    this.pump();
    return deferred.promise as Promise<T | undefined>;
  }

  private finishDeferred(
    deferred: Deferred<unknown>,
    value: unknown,
    coalesceKey: string | null
  ): void {
    this.openSettles.delete(deferred.settle);
    deferred.settle(value);
    if (coalesceKey) {
      this.coalescePromises.delete(coalesceKey);
    }
  }

  private invokeOverflowSafely(): void {
    try {
      this.onOverflow?.();
    } catch {
      // Callback exceptions must never strand enqueue promises.
    }
  }

  private invokeTaskErrorSafely(): void {
    try {
      this.onTaskError?.();
    } catch {
      // Callback exceptions must never strand enqueue promises.
    }
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

      void (async () => {
        let result: unknown = undefined;
        try {
          // Active work that already started continues even if close() races
          // after dequeue; only skip run() when closed before invocation.
          if (this.closed) {
            this.finishDeferred(next.deferred, undefined, next.coalesceKey);
            return;
          }
          result = await next.run();
          this.finishDeferred(next.deferred, result, next.coalesceKey);
        } catch {
          this.invokeTaskErrorSafely();
          result = undefined;
          this.finishDeferred(next.deferred, undefined, next.coalesceKey);
        } finally {
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
