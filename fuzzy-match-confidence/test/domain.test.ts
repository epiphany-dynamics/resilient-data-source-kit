import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDomains, normalizeDomain } from '../src/domain.js';

test('normalizeDomain strips protocol, www, path, and trailing slash', () => {
  assert.equal(normalizeDomain('https://www.acme-example.com/'), 'acme-example.com');
  assert.equal(normalizeDomain('http://acme-example.com/about'), 'acme-example.com');
  assert.equal(normalizeDomain('acme-example.com'), 'acme-example.com');
});

test('normalizeDomain returns undefined for missing/empty input', () => {
  assert.equal(normalizeDomain(undefined), undefined);
  assert.equal(normalizeDomain(null), undefined);
  assert.equal(normalizeDomain(''), undefined);
  assert.equal(normalizeDomain('   '), undefined);
});

test('compareDomains reports match for equivalent domains regardless of formatting', () => {
  const result = compareDomains('https://www.acme-example.com', 'acme-example.com');
  assert.equal(result.status, 'match');
});

test('compareDomains reports mismatch for genuinely different domains', () => {
  const result = compareDomains('acme-example.com', 'different-company.com');
  assert.equal(result.status, 'mismatch');
});

test('compareDomains reports insufficient-data rather than mismatch when one side is missing', () => {
  const result = compareDomains('acme-example.com', undefined);
  assert.equal(result.status, 'insufficient-data');
});

test('compareDomains reports insufficient-data when both sides are missing', () => {
  const result = compareDomains(undefined, null);
  assert.equal(result.status, 'insufficient-data');
});
