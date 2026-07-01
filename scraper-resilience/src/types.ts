/**
 * Shared types for the scraper-resilience module.
 *
 * Everything here is transport-agnostic on purpose: the real fetch/HTTP
 * client lives outside this module. That's what makes classify.ts,
 * backoff.ts, and circuit-breaker.ts unit-testable without a network.
 */

/** A normalized view of a raw HTTP response, independent of the HTTP client used. */
export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** How a single raw response was classified. */
export type ResponseClassification =
  | { kind: 'ok' }
  | { kind: 'hard-block'; reason: string; retryAfterMs?: number }
  | { kind: 'soft-block'; reason: string }
  | { kind: 'transient-error'; reason: string };

/** Configuration for exponential backoff with jitter. */
export interface RetryConfig {
  /** Maximum number of attempts, including the first one. */
  maxAttempts: number;
  /** Base delay in ms used for exponential growth (attempt 1 -> baseDelayMs). */
  baseDelayMs: number;
  /** Ceiling on any single computed delay, regardless of attempt number. */
  maxDelayMs: number;
  /**
   * Jitter strategy. 'full' picks a uniform random delay in [0, cappedDelay]
   * (AWS's recommended default: best at avoiding synchronized retry storms
   * across many clients). 'none' disables jitter (deterministic, for tests).
   */
  jitter: 'full' | 'none';
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 15_000,
  jitter: 'full',
};

/** Circuit breaker states, following the standard closed/open/half-open machine. */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures (soft-block or hard-block) before the circuit trips open. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a half-open probe. */
  initialCooldownMs: number;
  /** Cap on cooldown growth after repeated re-trips. */
  maxCooldownMs: number;
  /** Multiplier applied to the cooldown each time a half-open probe fails. */
  cooldownBackoffMultiplier: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  initialCooldownMs: 5_000,
  maxCooldownMs: 120_000,
  cooldownBackoffMultiplier: 2,
};

/** One entry in the decision trace produced by resilientFetch, useful for logs/demo output. */
export interface TraceEvent {
  attempt: number;
  timestampMs: number;
  event:
    | 'request-sent'
    | 'classified'
    | 'retry-scheduled'
    | 'circuit-open-fast-fail'
    | 'circuit-tripped'
    | 'circuit-half-open-probe'
    | 'circuit-closed'
    | 'success'
    | 'exhausted';
  detail: string;
}

export interface ResilientFetchResult<T> {
  ok: boolean;
  value?: T;
  trace: TraceEvent[];
  attempts: number;
}
