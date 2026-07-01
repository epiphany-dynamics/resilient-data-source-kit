import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFingerprint, listFingerprintLabels } from '../src/fingerprint.js';

test('pickFingerprint returns a profile with internally consistent headers', () => {
  const fp = pickFingerprint(() => 0);
  assert.ok(fp.headers['User-Agent']);
  assert.ok(fp.headers['Accept-Language']);
  assert.ok(listFingerprintLabels().includes(fp.label));
});

test('pickFingerprint rotates: avoidLabel excludes the previous profile', () => {
  const first = pickFingerprint(() => 0);
  for (let i = 0; i < 20; i += 1) {
    const next = pickFingerprint(Math.random, first.label);
    assert.notEqual(next.label, first.label, 'should never repeat the immediately previous fingerprint');
  }
});

test('pickFingerprint with rand=0 and rand close to 1 both return valid profiles', () => {
  const low = pickFingerprint(() => 0);
  const high = pickFingerprint(() => 0.999999);
  assert.ok(listFingerprintLabels().includes(low.label));
  assert.ok(listFingerprintLabels().includes(high.label));
});

test('listFingerprintLabels returns more than one profile (rotation is meaningful)', () => {
  assert.ok(listFingerprintLabels().length > 1);
});
