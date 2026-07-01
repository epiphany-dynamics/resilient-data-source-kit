import { CircuitBreaker } from './circuit-breaker.js';
import { classifyResponse } from './classify.js';
import { resolveDelayMs } from './backoff.js';
import { pickFingerprint, type RequestFingerprint } from './fingerprint.js';
import {
  DEFAULT_RETRY_CONFIG,
  type RawResponse,
  type ResilientFetchResult,
  type RetryConfig,
  type TraceEvent,
} from './types.js';

export type Transport = (fingerprint: RequestFingerprint) => Promise<RawResponse>;

export interface ResilientFetchOptions {
  retryConfig?: RetryConfig;
  /** Injectable sleep so tests/demos don't need to wait on real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG for deterministic tests. */
  rand?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches from a source with full resilience: circuit-breaker gate, rotated
 * fingerprint per attempt, response classification, and retry with backoff
 * (server Retry-After honored when present).
 *
 * `transport` is the actual I/O function (real fetch, a scraping library
 * call, etc.) - injected so this stays testable without a network and reusable
 * across different HTTP clients.
 *
 * Behavior summary:
 *  - If the circuit for `source` is open, fails fast immediately (no call).
 *  - On `ok`: records success on the breaker, returns the value.
 *  - On `hard-block` / `soft-block` / `transient-error`: records failure on
 *    the breaker, and retries with backoff up to `maxAttempts`, rotating the
 *    fingerprint on each retry. Once the breaker trips open mid-run (e.g.
 *    after enough soft-blocks), stops retrying immediately rather than
 *    burning the remaining attempt budget against a source that just closed
 *    the door.
 */
export async function resilientFetch<T>(
  source: string,
  breaker: CircuitBreaker,
  transport: Transport,
  parse: (raw: RawResponse) => T,
  options: ResilientFetchOptions = {},
): Promise<ResilientFetchResult<T>> {
  const retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  const sleep = options.sleep ?? realSleep;
  const rand = options.rand ?? Math.random;

  const trace: TraceEvent[] = [];
  let lastFingerprintLabel: string | undefined;

  const pushTrace = (attempt: number, event: TraceEvent['event'], detail: string) => {
    trace.push({ attempt, timestampMs: Date.now(), event, detail });
  };

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt += 1) {
    if (!breaker.canAttempt()) {
      pushTrace(
        attempt,
        'circuit-open-fast-fail',
        `circuit for "${source}" is open; failing fast without a network call`,
      );
      return { ok: false, trace, attempts: attempt - 1 };
    }

    const fingerprint = pickFingerprint(rand, lastFingerprintLabel);
    lastFingerprintLabel = fingerprint.label;

    pushTrace(attempt, 'request-sent', `fingerprint=${fingerprint.label}`);
    const raw = await transport(fingerprint);
    const classification = classifyResponse(raw);
    pushTrace(attempt, 'classified', `${classification.kind}: ${describeClassification(classification)}`);

    if (classification.kind === 'ok') {
      breaker.recordSuccess();
      pushTrace(attempt, 'success', `circuit closed; source "${source}" healthy`);
      return { ok: true, value: parse(raw), trace, attempts: attempt };
    }

    breaker.recordFailure();
    const stateAfterFailure = breaker.getState();
    if (stateAfterFailure === 'open') {
      pushTrace(
        attempt,
        'circuit-tripped',
        `too many consecutive failures for "${source}"; circuit opened, backing off the whole source`,
      );
      return { ok: false, trace, attempts: attempt };
    }

    if (attempt === retryConfig.maxAttempts) {
      pushTrace(attempt, 'exhausted', `max attempts (${retryConfig.maxAttempts}) reached for "${source}"`);
      return { ok: false, trace, attempts: attempt };
    }

    const retryAfterMs = classification.kind === 'hard-block' ? classification.retryAfterMs : undefined;
    const delayMs = resolveDelayMs(attempt, retryConfig, retryAfterMs, rand);
    pushTrace(
      attempt,
      'retry-scheduled',
      `waiting ${delayMs}ms before attempt ${attempt + 1}` +
        (retryAfterMs !== undefined ? ' (honoring server Retry-After)' : ' (exponential backoff + jitter)'),
    );
    await sleep(delayMs);
  }

  pushTrace(retryConfig.maxAttempts, 'exhausted', 'retry loop ended without success');
  return { ok: false, trace, attempts: retryConfig.maxAttempts };
}

function describeClassification(
  classification: ReturnType<typeof classifyResponse>,
): string {
  switch (classification.kind) {
    case 'ok':
      return 'looks like real content';
    case 'hard-block':
    case 'soft-block':
    case 'transient-error':
      return classification.reason;
    default:
      return 'unknown';
  }
}
