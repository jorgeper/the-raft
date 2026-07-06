export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * A clock that can be frozen at a fixed time (for tests) and falls back to
 * the system clock when not set.
 */
export class FixedClock implements Clock {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  set(date: Date): void {
    this.fixed = new Date(date);
  }

  advance(ms: number): void {
    this.fixed = new Date(this.now().getTime() + ms);
  }

  clear(): void {
    this.fixed = null;
  }
}
