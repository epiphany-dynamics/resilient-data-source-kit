import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resilientFetch } from '../src/client.js';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import type { CircuitBreakerConfig, RawResponse, RetryConfig } from '../src/types.js';

const noopSleep = async (_ms: number) => {};

const retryConfig: RetryConfig = { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100, jitter: 'none' };
const breakerConfig: CircuitBreakerConfig = {
  failureThreshold: 3,
  initialCooldownMs: 1000,
  maxCooldownMs: 8000,
  cooldownBackoffMultiplier: 2,
};

const REAL_CONTENT: RawResponse = {
  status: 200,
  headers: {},
  body: `<html><body>${'real content '.repeat(20)}</body></html>`,
};
const CAPTCHA: RawResponse = { status: 200, headers: {}, body: '<html>please verify you are human</html>' };
const HARD_BLOCK: RawResponse = { status: 429, headers: {}, body: 'Too Many Requests' };

function scriptedTransport(script: RawResponse[]) {
  let i = 0;
  return async () => {
    const r = script[Math.min(i, script.length - 1)];
    i += 1;
    return r;
  };
}

test('succeeds immediately on a healthy source', async () => {
  const breaker = new CircuitBreaker('s', breakerConfig);
  const result = await resilientFetch('s', breaker, scriptedTransport([REAL_CONTENT]), (r) => r.body, {
    retryConfig,
    sleep: noopSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
});

test('recovers after soft-blocks via retry', async () => {
  const breaker = new CircuitBreaker('s', breakerConfig);
  const result = await resilientFetch(
    's',
    breaker,
    scriptedTransport([CAPTCHA, CAPTCHA, REAL_CONTENT]),
    (r) => r.body,
    { retryConfig, sleep: noopSleep },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(breaker.getState(), 'closed');
});

test('trips the circuit before exhausting the full retry budget when failures persist', async () => {
  const breaker = new CircuitBreaker('s', breakerConfig); // threshold 3
  const result = await resilientFetch('s', breaker, scriptedTransport([CAPTCHA]), (r) => r.body, {
    retryConfig: { maxAttempts: 10, baseDelayMs: 10, maxDelayMs: 100, jitter: 'none' },
    sleep: noopSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3, 'should stop at the failure threshold, not run all 10 configured attempts');
  assert.equal(breaker.getState(), 'open');
});

test('a subsequent call against an open circuit fails fast with zero network attempts', async () => {
  const breaker = new CircuitBreaker('s', breakerConfig);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'open');

  let transportCalls = 0;
  const countingTransport = async () => {
    transportCalls += 1;
    return REAL_CONTENT;
  };

  const result = await resilientFetch('s', breaker, countingTransport, (r) => r.body, {
    retryConfig,
    sleep: noopSleep,
  });

  assert.equal(result.ok, false);
  assert.equal(transportCalls, 0, 'circuit-open should prevent any network call');
});

test('honors a hard-block Retry-After header rather than exponential backoff', async () => {
  const breaker = new CircuitBreaker('s', breakerConfig);
  const withRetryAfter: RawResponse = { status: 429, headers: { 'retry-after': '1' }, body: 'slow down' };
  const sleeps: number[] = [];
  // maxDelayMs must be high enough that the 1000ms Retry-After isn't clipped
  // by resolveDelayMs's safety cap (maxDelayMs * 4) - see backoff.test.ts's
  // "caps an extreme server Retry-After value" test for that cap in isolation.
  const generousRetryConfig: RetryConfig = { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 5000, jitter: 'none' };
  const result = await resilientFetch(
    's',
    breaker,
    scriptedTransport([withRetryAfter, REAL_CONTENT]),
    (r) => r.body,
    {
      retryConfig: generousRetryConfig,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(sleeps[0], 1000, 'should wait exactly the server-provided Retry-After (1s), not compute its own');
});

test('exhausts attempts and reports failure without ever tripping if threshold is high', async () => {
  const looseBreaker = new CircuitBreaker('s', { ...breakerConfig, failureThreshold: 100 });
  const result = await resilientFetch('s', looseBreaker, scriptedTransport([HARD_BLOCK]), (r) => r.body, {
    retryConfig: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, jitter: 'none' },
    sleep: noopSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(looseBreaker.getState(), 'closed', 'threshold of 100 should not trip after only 3 failures');
});
