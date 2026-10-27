/**
 * Login attempt limit (WBS 1.2.2, Figure 7.3, E0103): after `max` failed sign-ins for the same key
 * within `windowMs` the key is locked until the window has passed. A successful sign-in clears it.
 * Kept in memory: a restart of the single API process resets the counters.
 */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > since);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isLocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}
