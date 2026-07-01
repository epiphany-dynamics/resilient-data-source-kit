/**
 * Runnable demo: resilientFetch against a scripted, in-process "flaky
 * endpoint" (no real network calls). Shows three scenarios:
 *
 *  1. A source that soft-blocks a couple of times (CAPTCHA page on a 200)
 *     before succeeding: retry+backoff+fingerprint-rotation recovers cleanly.
 *  2. A source that hard-blocks with 429 + Retry-After: the server's
 *     suggested delay is honored instead of our own backoff schedule.
 *  3. A source that fails every single call: the circuit breaker trips open
 *     after `failureThreshold` consecutive failures and every subsequent
 *     call fails fast with NO network call at all, rather than continuing to
 *     hammer a source that has made its blocking intent obvious.
 *
 * Run with: npm run demo:scraper
 */
import { CircuitBreaker } from './circuit-breaker.js';
import { resilientFetch, type Transport } from './client.js';
import type { RawResponse } from './types.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const instantSleep = async (ms: number) => {
  console.log(`    (sleeping ${ms}ms, fast-forwarded for the demo)`);
};

function makeScriptedTransport(script: RawResponse[]): Transport {
  let callIndex = 0;
  return async (fingerprint) => {
    const response = script[Math.min(callIndex, script.length - 1)];
    callIndex += 1;
    console.log(`    -> transport call #${callIndex} using fingerprint "${fingerprint.label}"`);
    return response;
  };
}

const CAPTCHA_BODY = `<html><body><h1>Please verify you are human</h1><div class="captcha-widget"></div></body></html>`;
const REAL_CONTENT_BODY = `<html><body><main><h1>Business Directory Listing</h1><p>ACME Corp - 123 Main St - acme-example.com</p><p>${'x'.repeat(
  300,
)}</p></main></body></html>`;

async function scenarioSoftBlockThenRecover() {
  console.log('\n=== Scenario 1: soft-block (CAPTCHA) twice, then real content ===');
  const transport = makeScriptedTransport([
    { status: 200, headers: {}, body: CAPTCHA_BODY },
    { status: 200, headers: {}, body: CAPTCHA_BODY },
    { status: 200, headers: {}, body: REAL_CONTENT_BODY },
  ]);
  const breaker = new CircuitBreaker('directory-site-a', {
    failureThreshold: 3,
    initialCooldownMs: 5_000,
    maxCooldownMs: 60_000,
    cooldownBackoffMultiplier: 2,
  });

  const result = await resilientFetch(
    'directory-site-a',
    breaker,
    transport,
    (raw) => raw.body,
    { sleep: instantSleep, rand: mulberry32(1) },
  );

  printTrace(result.trace);
  console.log(`Result: ok=${result.ok} attempts=${result.attempts}`);
  console.log(`Circuit after run: ${breaker.describe()}`);
}

async function scenarioHardBlockWithRetryAfter() {
  console.log('\n=== Scenario 2: hard 429 with Retry-After, then success ===');
  const transport = makeScriptedTransport([
    { status: 429, headers: { 'retry-after': '2' }, body: 'Too Many Requests' },
    { status: 200, headers: {}, body: REAL_CONTENT_BODY },
  ]);
  const breaker = new CircuitBreaker('semi-public-api-b', {
    failureThreshold: 3,
    initialCooldownMs: 5_000,
    maxCooldownMs: 60_000,
    cooldownBackoffMultiplier: 2,
  });

  const result = await resilientFetch(
    'semi-public-api-b',
    breaker,
    transport,
    (raw) => raw.body,
    { sleep: instantSleep, rand: mulberry32(2) },
  );

  printTrace(result.trace);
  console.log(`Result: ok=${result.ok} attempts=${result.attempts}`);
  console.log(`Circuit after run: ${breaker.describe()}`);
}

async function scenarioCircuitTripsOpen() {
  console.log('\n=== Scenario 3: source blocks every call, circuit breaker trips ===');
  const alwaysBlocked = makeScriptedTransport([{ status: 200, headers: {}, body: CAPTCHA_BODY }]);
  const breaker = new CircuitBreaker('aggregator-site-c', {
    failureThreshold: 3,
    initialCooldownMs: 5_000,
    maxCooldownMs: 60_000,
    cooldownBackoffMultiplier: 2,
  });

  const result = await resilientFetch(
    'aggregator-site-c',
    breaker,
    alwaysBlocked,
    (raw) => raw.body,
    { sleep: instantSleep, rand: mulberry32(3), retryConfig: { maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 2000, jitter: 'full' } },
  );

  printTrace(result.trace);
  console.log(`Result: ok=${result.ok} attempts=${result.attempts}`);
  console.log(`Circuit after run: ${breaker.describe()}`);

  console.log('\n--- Immediately trying again against the same (still-tripped) source ---');
  const secondResult = await resilientFetch(
    'aggregator-site-c',
    breaker,
    alwaysBlocked,
    (raw) => raw.body,
    { sleep: instantSleep, rand: mulberry32(4) },
  );
  printTrace(secondResult.trace);
  console.log(
    `Result: ok=${secondResult.ok} attempts=${secondResult.attempts} (note: attempts=0 network calls because the circuit fast-failed)`,
  );
}

function printTrace(trace: { attempt: number; event: string; detail: string }[]) {
  for (const entry of trace) {
    console.log(`  [attempt ${entry.attempt}] ${entry.event}: ${entry.detail}`);
  }
}

async function main() {
  await scenarioSoftBlockThenRecover();
  await scenarioHardBlockWithRetryAfter();
  await scenarioCircuitTripsOpen();
  console.log('\nDone. No real network calls were made; the "flaky endpoint" is scripted in-process.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
