import type { DelayState } from "./types.ts";
import type { Clock } from "./Clock.ts";

export class DelayScheduler {
  constructor(private readonly clock: Clock) {}

  schedule(stepId: string, durationMs: number): DelayState {
    if (durationMs < 0) {
      throw new RangeError("durationMs cannot be negative");
    }
    const scheduledAt = this.clock.now();
    return { stepId, scheduledAt, resumeAt: scheduledAt + durationMs };
  }

  isDue(state: DelayState): boolean {
    return this.clock.now() >= state.resumeAt;
  }

  remaining(state: DelayState): number {
    return Math.max(0, state.resumeAt - this.clock.now());
  }
}
