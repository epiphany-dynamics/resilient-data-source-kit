import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extraDistinguishingTokens,
  levenshteinDistance,
  levenshteinRatio,
  normalizeAddress,
  normalizeName,
  tokenSetRatio,
} from '../src/similarity.js';

test('normalizeName lowercases, strips punctuation, and removes legal suffixes', () => {
  assert.equal(normalizeName('Acme, Inc.'), 'acme');
  assert.equal(normalizeName('Acme Corp'), 'acme');
  assert.equal(normalizeName('ACME LLC'), 'acme');
});

test('normalizeName preserves distinguishing geographic qualifiers', () => {
  assert.equal(normalizeName('Smith Logistics of Texas LLC'), 'smith logistics of texas');
  assert.notEqual(normalizeName('Smith Logistics LLC'), normalizeName('Smith Logistics of Texas LLC'));
});

test('normalizeAddress expands common abbreviations', () => {
  assert.equal(normalizeAddress('123 Main St'), '123 main street');
  assert.equal(normalizeAddress('456 Commerce Blvd'), '456 commerce boulevard');
});

test('levenshteinDistance is 0 for identical strings and symmetric', () => {
  assert.equal(levenshteinDistance('abc', 'abc'), 0);
  assert.equal(levenshteinDistance('kitten', 'sitting'), levenshteinDistance('sitting', 'kitten'));
  assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
});

test('levenshteinDistance handles empty strings', () => {
  assert.equal(levenshteinDistance('', 'abc'), 3);
  assert.equal(levenshteinDistance('abc', ''), 3);
  assert.equal(levenshteinDistance('', ''), 0);
});

test('levenshteinRatio returns 1 for identical strings and 0 for maximally different equal-length strings', () => {
  assert.equal(levenshteinRatio('acme', 'acme'), 1);
  assert.equal(levenshteinRatio('abcd', 'wxyz'), 0);
});

test('tokenSetRatio is order-independent', () => {
  const a = tokenSetRatio('smith logistics', 'logistics smith');
  assert.equal(a, 1);
});

test('tokenSetRatio penalizes a superset name (the false-positive trap case)', () => {
  const ratio = tokenSetRatio('smith logistics', 'smith logistics of texas');
  assert.ok(ratio > 0 && ratio < 1, `expected partial overlap, got ${ratio}`);
  assert.ok(ratio <= 0.75, 'should not be treated as near-identical despite heavy token overlap');
});

test('tokenSetRatio handles empty strings without throwing', () => {
  assert.equal(tokenSetRatio('', ''), 1);
  assert.equal(tokenSetRatio('acme', ''), 0);
});

test('extraDistinguishingTokens finds the geographic qualifier that differentiates two names', () => {
  const tokens = extraDistinguishingTokens('smith logistics', 'smith logistics of texas');
  assert.deepEqual(tokens, ['texas']);
});

test('extraDistinguishingTokens ignores filler words like "of" and "the"', () => {
  const tokens = extraDistinguishingTokens('riverbend manufacturing', 'the riverbend manufacturing of ohio');
  assert.deepEqual(tokens.sort(), ['ohio']);
});

test('extraDistinguishingTokens returns empty when names are token-identical', () => {
  const tokens = extraDistinguishingTokens('acme', 'acme');
  assert.deepEqual(tokens, []);
});
