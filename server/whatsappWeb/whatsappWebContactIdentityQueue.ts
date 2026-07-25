/**
 * Bounded, session-safe queue for WhatsApp contact identity persistence.
 * Limits concurrent DB writes; isolates per-contact failures.
 * Optional per-key serialization: same key never runs concurrently.
 */

export const WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY = 3;

export type ContactIdentityPersistTask<T> = () => Promise<T>;

export type ContactIdentityPersistEnqueueOptions = {
  /** When set, at most one task with this key runs at a time (FIFO among that key). */
  key?: string;
};

export type ContactIdentityPersistQueueOptions = {
  concurrency?: number;
  onTaskError?: () => void;
};

type PendingItem = {
  run: ContactIdentityPersistTask<unknown>;
  resolve: (value: unknown) => void;
  key: string | null;
};

/**
 * Small FIFO worker pool. Never throws out of enqueue(); failures are isolated.
 * `close()` drops pending work and rejects new enqueues (logout/shutdown).
 */
export class ContactIdentityPersistQueue {
  private readonly concurrency: number;
  private readonly onTaskError?: () => void;
  private readonly pending: PendingItem[] = [];
  private readonly activeKeys = new Set<string>();
  private readonly activePerKey = new Map<string, number>();
  private readonly peakPerKey = new Map<string, number>();
  private active = 0;
  private closed = false;
  /** Test observability: peak observed global concurrency. */
  peakActive = 0;

  constructor(options: ContactIdentityPersistQueueOptions = {}) {
    this.concurrency = Math.max(
      1,
      options.concurrency ?? WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY
    );
    this.onTaskError = options.onTaskError;
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
   * Drop pending tasks and refuse new work. Active tasks finish but callers
   * should no-op themselves when the session is shutting down.
   */
  close(): void {
    this.closed = true;
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      next?.resolve(undefined);
    }
  }

  /**
   * Schedule work. Resolves when the task finishes (success or failure).
   * Failures are swallowed after onTaskError — callers may still await outcome.
   * After close(), resolves immediately with undefined.
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
    return new Promise<T | undefined>((resolve) => {
      if (this.closed) {
        resolve(undefined);
        return;
      }
      this.pending.push({
        run: task as ContactIdentityPersistTask<unknown>,
        resolve: (value) => resolve(value as T | undefined),
        key,
      });
      this.pump();
    });
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
        try {
          if (this.closed) {
            next.resolve(undefined);
            return;
          }
          const result = await next.run();
          next.resolve(result);
        } catch {
          this.onTaskError?.();
          next.resolve(undefined);
        } finally {
          if (next.key) {
            this.activeKeys.delete(next.key);
            const per = (this.activePerKey.get(next.key) ?? 1) - 1;
            if (per <= 0) this.activePerKey.delete(next.key);
            else this.activePerKey.set(next.key, per);
          }
          this.active -= 1;
          this.pump();
        }
      })();
    }
  }
}
