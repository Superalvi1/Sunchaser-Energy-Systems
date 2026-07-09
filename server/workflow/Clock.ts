export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (ms < 0) {
      throw new RangeError("ManualClock cannot advance by a negative amount");
    }
    this.current += ms;
    return this.current;
  }

  set(timestamp: number): void {
    this.current = timestamp;
  }
}
