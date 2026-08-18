export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * One breaker per upstream host.
 *
 * The point is not to fail faster; it is to stop sending traffic that is
 * certainly going to fail, so a dependency that has fallen over does not spend
 * the caller's connection pool and timeout budget too. Without one, a dead
 * upstream takes the caller down with it — every request waits the full
 * timeout, and the queue in front of it grows until nothing is served.
 *
 * Time is injected rather than read, so the transitions are tested by
 * arithmetic instead of by sleeping.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAtMs: number | null = null;
  private probing = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly resetAfterMs: number,
    private readonly nowMs: () => number,
  ) {}

  get state(): CircuitState {
    if (this.openedAtMs === null) {
      return 'closed';
    }
    return this.probing ? 'half-open' : 'open';
  }

  /**
   * Whether a call may proceed. Transitions open → half-open once the reset
   * window has elapsed, and lets exactly one probe through — a thundering herd
   * of probes is how a recovering service is knocked over a second time.
   */
  allow(): boolean {
    if (this.openedAtMs === null) {
      return true;
    }
    if (this.probing) {
      return false;
    }
    if (this.nowMs() - this.openedAtMs >= this.resetAfterMs) {
      this.probing = true;
      return true;
    }
    return false;
  }

  succeeded(): void {
    this.failures = 0;
    this.openedAtMs = null;
    this.probing = false;
  }

  failed(): void {
    // A failed probe re-opens for a fresh window rather than counting towards
    // a threshold it has already crossed.
    if (this.probing) {
      this.probing = false;
      this.openedAtMs = this.nowMs();
      return;
    }

    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openedAtMs = this.nowMs();
    }
  }
}
