import type { RetryConfig } from './types.js';

/**
 * Computes the delay (ms) before a given retry attempt using exponential
 * backoff with optional full jitter.
 *
 * attempt is 1-indexed: attempt=1 is the delay before the *second* try
 * (i.e. after the first failure).
 *
 * Exponential growth: baseDelayMs * 2^(attempt-1), capped at maxDelayMs.
 * Full jitter (AWS Architecture Blog, "Exponential Backoff And Jitter"):
 * sample uniformly from [0, cappedDelay] rather than using the capped delay
 * directly. This spreads out retries from many concurrent callers instead of
 * having them all retry in lockstep, which is exactly the kind of
 * synchronized-retry-storm pattern that gets a whole IP range blocked.
 *
 * `rand` is injectable so the function is deterministic in tests.
 */
export function computeBackoffDelayMs(
  attempt: number,
  config: RetryConfig,
  rand: () => number = Math.random,
): number {
  if (attempt < 1) {
    throw new Error(`attempt must be >= 1, got ${attempt}`);
  }

  const exponential = config.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, config.maxDelayMs);

  if (config.jitter === 'none') {
    return capped;
  }

  // Full jitter: uniform in [0, capped]. Guarantees non-negative and never
  // exceeds the cap while still avoiding synchronized retries.
  return Math.floor(rand() * capped);
}

/**
 * Extracts a server-suggested retry delay from a Retry-After header value.
 * Supports both the delay-seconds form ("120") and the HTTP-date form.
 * Returns undefined if the header is missing or unparseable, so callers can
 * fall back to their own backoff schedule.
 */
export function parseRetryAfterMs(headerValue: string | undefined): number | undefined {
  if (!headerValue) return undefined;

  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? deltaMs : 0;
  }

  return undefined;
}

/**
 * Resolves the actual delay to use for a retry: prefer an explicit
 * server-provided Retry-After value (the source told us exactly what it
 * wants), otherwise fall back to computed exponential backoff with jitter.
 */
export function resolveDelayMs(
  attempt: number,
  config: RetryConfig,
  serverRetryAfterMs: number | undefined,
  rand: () => number = Math.random,
): number {
  if (serverRetryAfterMs !== undefined) {
    return Math.min(serverRetryAfterMs, config.maxDelayMs * 4);
  }
  return computeBackoffDelayMs(attempt, config, rand);
}
