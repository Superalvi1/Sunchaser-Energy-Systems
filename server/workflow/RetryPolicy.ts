import type { BackoffStrategy, RetryPolicyConfig } from "./types.ts";

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly backoff: BackoffStrategy;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: boolean;

  constructor(config: RetryPolicyConfig) {
    if (config.maxAttempts < 1) {
      throw new RangeError("maxAttempts must be at least 1");
    }
    if (config.baseDelayMs < 0) {
      throw new RangeError("baseDelayMs cannot be negative");
    }
    this.maxAttempts = config.maxAttempts;
    this.backoff = config.backoff;
    this.baseDelayMs = config.baseDelayMs;
    this.maxDelayMs = config.maxDelayMs ?? Number.POSITIVE_INFINITY;
    this.jitter = config.jitter ?? false;
  }

  shouldRetry(attemptsMade: number): boolean {
    return attemptsMade < this.maxAttempts;
  }

  computeDelay(attemptsMade: number, random: () => number = Math.random): number {
    let delay: number;
    switch (this.backoff) {
      case "fixed":
        delay = this.baseDelayMs;
        break;
      case "linear":
        delay = this.baseDelayMs * attemptsMade;
        break;
      case "exponential":
        delay = this.baseDelayMs * 2 ** (attemptsMade - 1);
        break;
      default: {
        const exhaustive: never = this.backoff;
        throw new Error(`Unsupported backoff strategy: ${String(exhaustive)}`);
      }
    }
    delay = Math.min(delay, this.maxDelayMs);
    if (this.jitter) {
      delay = delay * (0.5 + random() * 0.5);
    }
    return Math.max(0, Math.round(delay));
  }
}
