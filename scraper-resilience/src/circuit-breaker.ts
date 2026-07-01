import type { CircuitBreakerConfig, CircuitState } from './types.js';

/**
 * Per-source circuit breaker.
 *
 * Retry+backoff (backoff.ts) makes a single logical request resilient.
 * It does NOT stop a pipeline from immediately making the *next* request
 * against a source that has just demonstrated, repeatedly, that it's
 * blocking you. That's what this circuit breaker is for: it tracks
 * consecutive failures (soft-block or hard-block) *per source* and, once a
 * threshold is crossed, stops sending requests to that source entirely for a
 * cooldown window, then allows exactly one probe through to test recovery.
 *
 * States:
 *  - closed: normal operation. Failures increment a counter; a success
 *    resets it to zero.
 *  - open: fast-fail every call, no network request attempted, until the
 *    cooldown elapses.
 *  - half-open: exactly one probe call is allowed through. Success -> closed
 *    (counter reset, cooldown reset to initial). Failure -> open again, with
 *    the cooldown multiplied (capped), so a source still blocking us gets
 *    backed off harder each cycle instead of being probed at a fixed rate
 *    forever.
 *
 * One instance should be created per external source (not shared globally),
 * since the whole point is isolating a misbehaving source rather than
 * penalizing unrelated sources for its problems.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private currentCooldownMs: number;
  private openedAtMs = 0;
  private halfOpenProbeInFlight = false;

  constructor(
    private readonly sourceName: string,
    private readonly config: CircuitBreakerConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.currentCooldownMs = config.initialCooldownMs;
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  getSourceName(): string {
    return this.sourceName;
  }

  /**
   * Call before attempting a request. Returns true if the request may
   * proceed (state is closed, or state is half-open and no probe is
   * currently in flight). Returns false if the circuit is open and the
   * caller should fast-fail without hitting the network.
   */
  canAttempt(): boolean {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'closed') return true;

    if (this.state === 'half-open') {
      if (this.halfOpenProbeInFlight) return false;
      this.halfOpenProbeInFlight = true;
      return true;
    }

    return false; // open
  }

  /** Record a successful call (real content, not a block). */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.currentCooldownMs = this.config.initialCooldownMs;
    this.halfOpenProbeInFlight = false;
    this.state = 'closed';
  }

  /** Record a failure: a soft-block or hard-block response from this source. */
  recordFailure(): void {
    if (this.state === 'half-open') {
      // The probe failed: the source is still blocking us. Back off harder.
      this.halfOpenProbeInFlight = false;
      this.currentCooldownMs = Math.min(
        this.currentCooldownMs * this.config.cooldownBackoffMultiplier,
        this.config.maxCooldownMs,
      );
      this.trip();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = 'open';
    this.openedAtMs = this.now();
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'open') return;
    const elapsed = this.now() - this.openedAtMs;
    if (elapsed >= this.currentCooldownMs) {
      this.state = 'half-open';
      this.halfOpenProbeInFlight = false;
    }
  }

  /** Introspection helper for logging/demo output. */
  describe(): string {
    return `[${this.sourceName}] state=${this.getState()} consecutiveFailures=${this.consecutiveFailures} cooldownMs=${this.currentCooldownMs}`;
  }
}
