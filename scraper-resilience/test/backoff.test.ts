import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoffDelayMs, parseRetryAfterMs, resolveDelayMs } from '../src/backoff.js';
import type { RetryConfig } from '../src/types.js';

const config: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  jitter: 'none',
};

test('computeBackoffDelayMs grows exponentially without jitter', () => {
  assert.equal(computeBackoffDelayMs(1, config), 100);
  assert.equal(computeBackoffDelayMs(2, config), 200);
  assert.equal(computeBackoffDelayMs(3, config), 400);
  assert.equal(computeBackoffDelayMs(4, config), 800);
  assert.equal(computeBackoffDelayMs(5, config), 1600);
});

test('computeBackoffDelayMs caps at maxDelayMs', () => {
  assert.equal(computeBackoffDelayMs(10, config), 2000);
  assert.equal(computeBackoffDelayMs(20, config), 2000);
});

test('computeBackoffDelayMs rejects attempt < 1', () => {
  assert.throws(() => computeBackoffDelayMs(0, config));
});

test('computeBackoffDelayMs full jitter stays within [0, cappedDelay]', () => {
  const jitteredConfig: RetryConfig = { ...config, jitter: 'full' };
  for (let i = 0; i < 200; i += 1) {
    const attempt = (i % 6) + 1;
    const delay = computeBackoffDelayMs(attempt, jitteredConfig, Math.random);
    const cap = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
    assert.ok(delay >= 0 && delay <= cap, `delay ${delay} out of range [0, ${cap}] for attempt ${attempt}`);
  }
});

test('computeBackoffDelayMs full jitter is deterministic given a fixed rand', () => {
  const jitteredConfig: RetryConfig = { ...config, jitter: 'full' };
  const fixedRand = () => 0.5;
  assert.equal(computeBackoffDelayMs(1, jitteredConfig, fixedRand), 50);
  assert.equal(computeBackoffDelayMs(2, jitteredConfig, fixedRand), 100);
});

test('parseRetryAfterMs handles delay-seconds form', () => {
  assert.equal(parseRetryAfterMs('120'), 120_000);
  assert.equal(parseRetryAfterMs('0'), 0);
});

test('parseRetryAfterMs handles missing/garbage header', () => {
  assert.equal(parseRetryAfterMs(undefined), undefined);
  assert.equal(parseRetryAfterMs('not-a-real-value'), undefined);
});

test('parseRetryAfterMs handles HTTP-date form', () => {
  const future = new Date(Date.now() + 60_000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed !== undefined && parsed > 0 && parsed <= 61_000);
});

test('resolveDelayMs prefers server Retry-After over computed backoff', () => {
  const delay = resolveDelayMs(1, config, 500, () => 0.99);
  assert.equal(delay, 500);
});

test('resolveDelayMs falls back to computed backoff when no Retry-After', () => {
  const delay = resolveDelayMs(2, config, undefined);
  assert.equal(delay, 200);
});

test('resolveDelayMs caps an extreme server Retry-After value', () => {
  const delay = resolveDelayMs(1, config, 10_000_000);
  assert.equal(delay, config.maxDelayMs * 4);
});
