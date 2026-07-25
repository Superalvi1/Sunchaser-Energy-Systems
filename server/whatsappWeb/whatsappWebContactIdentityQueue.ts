/**
 * Bounded, session-safe queue for WhatsApp contact identity persistence.
 * Limits concurrent DB writes; isolates per-contact failures.
 */

export const WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY = 3;

export type ContactIdentityPersistTask<T> = () => Promise<T>;

export type ContactIdentityPersistQueueOptions = {
  concurrency?: number;
  onTaskError?: () => void;
};

/**
 * Small FIFO worker pool. Never throws out of enqueue(); failures are isolated.
 */
export class ContactIdentityPersistQueue {
  private readonly concurrency: number;
  private readonly onTaskError?: () => void;
  private readonly pending: Array<{
    run: ContactIdentityPersistTask<unknown>;
    resolve: (value: unknown) => void;
  }> = [];
  private active = 0;
  /** Test observability: peak observed concurrency. */
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

  /**
   * Schedule work. Resolves when the task finishes (success or failure).
   * Failures are swallowed after onTaskError — callers may still await outcome.
   */
  enqueue<T>(task: ContactIdentityPersistTask<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      this.pending.push({
        run: task as ContactIdentityPersistTask<unknown>,
        resolve: (value) => resolve(value as T | undefined),
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) return;
      this.active += 1;
      if (this.active > this.peakActive) this.peakActive = this.active;
      void (async () => {
        try {
          const result = await next.run();
          next.resolve(result);
        } catch {
          this.onTaskError?.();
          next.resolve(undefined);
        } finally {
          this.active -= 1;
          this.pump();
        }
      })();
    }
  }
}
