import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../src/types.js';

const config: CircuitBreakerConfig = {
  failureThreshold: 3,
  initialCooldownMs: 1000,
  maxCooldownMs: 8000,
  cooldownBackoffMultiplier: 2,
};

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('starts closed and allows attempts', () => {
  const breaker = new CircuitBreaker('source-a', config);
  assert.equal(breaker.getState(), 'closed');
  assert.equal(breaker.canAttempt(), true);
});

test('stays closed below the failure threshold', () => {
  const breaker = new CircuitBreaker('source-a', config);
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'closed');
  assert.equal(breaker.canAttempt(), true);
});

test('trips open at the failure threshold', () => {
  const breaker = new CircuitBreaker('source-a', config);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'open');
  assert.equal(breaker.canAttempt(), false);
});

test('a success resets the failure counter', () => {
  const breaker = new CircuitBreaker('source-a', config);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordSuccess();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'closed', 'two failures after a reset should not trip a threshold-3 breaker');
});

test('transitions to half-open after the cooldown elapses', () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker('source-a', config, clock.now);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'open');

  clock.advance(500);
  assert.equal(breaker.getState(), 'open', 'should still be open before cooldown elapses');

  clock.advance(600); // total 1100ms > 1000ms cooldown
  assert.equal(breaker.getState(), 'half-open');
});

test('half-open allows exactly one probe at a time', () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker('source-a', config, clock.now);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  clock.advance(1500);

  assert.equal(breaker.canAttempt(), true, 'first probe should be allowed');
  assert.equal(breaker.canAttempt(), false, 'a second concurrent probe should be blocked');
});

test('a successful half-open probe closes the circuit and resets cooldown', () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker('source-a', config, clock.now);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  clock.advance(1500);
  assert.equal(breaker.canAttempt(), true);

  breaker.recordSuccess();
  assert.equal(breaker.getState(), 'closed');

  // Verify cooldown was reset to initial by tripping again and checking timing.
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  clock.advance(999);
  assert.equal(breaker.getState(), 'open', 'cooldown should have reset to initialCooldownMs (1000ms)');
  clock.advance(2);
  assert.equal(breaker.getState(), 'half-open');
});

test('a failed half-open probe re-opens with an increased cooldown', () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker('source-a', config, clock.now);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  clock.advance(1500);
  assert.equal(breaker.canAttempt(), true);

  breaker.recordFailure(); // probe fails
  assert.equal(breaker.getState(), 'open');

  // New cooldown should be 1000 * 2 = 2000ms, not the original 1000ms.
  clock.advance(1500);
  assert.equal(breaker.getState(), 'open', 'should still be open: cooldown doubled to 2000ms');
  clock.advance(600);
  assert.equal(breaker.getState(), 'half-open');
});

test('cooldown growth is capped at maxCooldownMs', () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker('source-a', config, clock.now);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure(); // trip -> cooldown 1000

  for (let i = 0; i < 6; i += 1) {
    // Jump forward enough to reach half-open, then fail the probe again.
    clock.advance(10_000);
    assert.equal(breaker.getState(), 'half-open');
    breaker.canAttempt();
    breaker.recordFailure();
  }

  // Cooldown should have capped at 8000ms rather than growing unbounded
  // (1000 -> 2000 -> 4000 -> 8000 -> 8000 -> 8000 -> 8000).
  clock.advance(7999);
  assert.equal(breaker.getState(), 'open');
  clock.advance(2);
  assert.equal(breaker.getState(), 'half-open');
});

test('describe() produces a readable summary', () => {
  const breaker = new CircuitBreaker('source-a', config);
  const summary = breaker.describe();
  assert.match(summary, /source-a/);
  assert.match(summary, /state=closed/);
});
