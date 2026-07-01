import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch } from '../src/score.js';

test('the centerpiece false-positive trap: similar names, conflicting addresses -> low confidence, human review required', () => {
  const a = { name: 'Smith Logistics LLC', address: '123 Main St, Austin, TX' };
  const b = { name: 'Smith Logistics of Texas LLC', address: '456 Commerce Blvd, Dallas, TX' };

  const result = scoreMatch(a, b);

  assert.equal(result.band, 'low', `expected low confidence, got ${result.band} (score ${result.score})`);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.signals.hasDistinguishingQualifier, true);
  assert.ok(result.signals.distinguishingTokens.includes('texas'));
  assert.notEqual(result.band, 'high', 'must never auto-accept this pair as a confident match');
});

test('a naive substring matcher would have wrongly auto-matched the trap case (documents the bug this replaces)', () => {
  const nameA = 'smith logistics';
  const nameB = 'smith logistics of texas';
  const naiveWouldMatch = nameB.includes(nameA);
  assert.equal(naiveWouldMatch, true, 'sanity check: confirms the naive approach really does produce a false positive here');
});

test('true positive: minor formatting/legal-suffix noise with matching address and domain -> high confidence', () => {
  const a = { name: 'Acme Corp', address: '789 Industrial Pkwy, Reno, NV', domain: 'acme-example.com' };
  const b = { name: 'Acme, Inc.', address: '789 Industrial Parkway, Reno, NV', domain: 'www.acme-example.com' };

  const result = scoreMatch(a, b);

  assert.equal(result.band, 'high');
  assert.equal(result.requiresHumanReview, false);
});

test('name-only near-exact match with no corroborating data never reaches high (name alone cannot auto-accept)', () => {
  const a = { name: 'Riverbend Manufacturing Co' };
  const b = { name: 'Riverbend Manufacturing' };

  const result = scoreMatch(a, b);

  assert.notEqual(result.band, 'high', 'name similarity alone must not be sufficient for auto-accept');
  assert.equal(result.requiresHumanReview, true);
});

test('clearly distinct companies with partial name overlap -> low confidence', () => {
  const a = { name: 'National Freight Solutions', address: '10 Port Rd, Newark, NJ' };
  const b = { name: 'National Freight Partners', address: '900 Harbor Way, Miami, FL' };

  const result = scoreMatch(a, b);

  assert.equal(result.band, 'low');
});

test('domain match corroborates a name match even when the street address changed', () => {
  const a = {
    name: 'Bluepoint Analytics LLC',
    address: '1 Old Address Ln, Columbus, OH',
    domain: 'bluepoint-analytics.com',
  };
  const b = {
    name: 'Bluepoint Analytics LLC',
    address: '99 New Campus Dr, Columbus, OH',
    domain: 'bluepoint-analytics.com',
  };

  const result = scoreMatch(a, b);

  assert.equal(result.band, 'high');
  assert.equal(result.signals.domainMatch, 'match');
});

test('missing address on both sides is reported as insufficient data, not as a mismatch penalty', () => {
  const a = { name: 'Acme Corp' };
  const b = { name: 'Acme Inc' };

  const result = scoreMatch(a, b);

  assert.equal(result.signals.addressSimilarity, null);
});

test('exact identical records score a perfect 1.0 with high confidence', () => {
  const a = { name: 'Acme Corp', address: '1 Main St, Austin, TX', domain: 'acme.com' };
  const b = { name: 'Acme Corp', address: '1 Main St, Austin, TX', domain: 'acme.com' };

  const result = scoreMatch(a, b);

  assert.equal(result.score, 1);
  assert.equal(result.band, 'high');
});

test('completely unrelated companies score low with no distinguishing-qualifier noise', () => {
  const a = { name: 'Pacific Rim Seafood Distributors', address: '1 Bay St, Seattle, WA' };
  const b = { name: 'Golden Valley Dairy Cooperative', address: '200 Farm Rd, Madison, WI' };

  const result = scoreMatch(a, b);

  assert.equal(result.band, 'low');
});

test('explanation array always documents every signal considered', () => {
  const result = scoreMatch({ name: 'Acme Corp' }, { name: 'Acme Inc' });
  assert.ok(result.explanation.some((line) => line.includes('name similarity')));
  assert.ok(result.explanation.some((line) => line.includes('address similarity')));
  assert.ok(result.explanation.some((line) => line.includes('domain')));
});
