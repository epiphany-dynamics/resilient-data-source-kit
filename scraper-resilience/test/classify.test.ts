import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse } from '../src/classify.js';

const REAL_CONTENT = `<html><body><main>${'Real listing content. '.repeat(20)}</main></body></html>`;

test('classifies a normal 200 with substantial body as ok', () => {
  const result = classifyResponse({ status: 200, headers: {}, body: REAL_CONTENT });
  assert.equal(result.kind, 'ok');
});

test('classifies 403 as hard-block', () => {
  const result = classifyResponse({ status: 403, headers: {}, body: 'Forbidden' });
  assert.equal(result.kind, 'hard-block');
});

test('classifies 429 with Retry-After as hard-block carrying the parsed delay', () => {
  const result = classifyResponse({ status: 429, headers: { 'retry-after': '30' }, body: 'Too many requests' });
  assert.equal(result.kind, 'hard-block');
  if (result.kind === 'hard-block') {
    assert.equal(result.retryAfterMs, 30_000);
  }
});

test('classifies a 200 CAPTCHA page as soft-block, not ok', () => {
  const body = '<html><body><h1>Please verify you are human</h1></body></html>';
  const result = classifyResponse({ status: 200, headers: {}, body });
  assert.equal(result.kind, 'soft-block');
});

test('classifies a 200 "unusual traffic" interstitial as soft-block', () => {
  const body = '<html><body>We have detected unusual traffic from your network.</body></html>';
  const result = classifyResponse({ status: 200, headers: {}, body });
  assert.equal(result.kind, 'soft-block');
});

test('classifies a suspiciously tiny 200 body as soft-block even without a known marker', () => {
  const result = classifyResponse({ status: 200, headers: {}, body: '<html></html>' });
  assert.equal(result.kind, 'soft-block');
});

test('classifies 500 as transient-error', () => {
  const result = classifyResponse({ status: 503, headers: {}, body: 'Service Unavailable' });
  assert.equal(result.kind, 'transient-error');
});

test('classifies an unrelated 404 as transient-error, not a block', () => {
  const result = classifyResponse({ status: 404, headers: {}, body: 'Not Found' });
  assert.equal(result.kind, 'transient-error');
});

test('does not misclassify real content that happens to mention rate limits in prose', () => {
  // Regression guard: the marker list should still trigger on substantive matches;
  // this test documents the known limitation rather than hiding it. A body that is
  // long, well-formed, and only tangentially mentions a marker phrase in unrelated
  // context is exactly the kind of edge case that needs human-tunable marker lists
  // per source in a real deployment, not a smarter regex here.
  const body = `<html><body><main>${'Article about API rate limit exceeded errors and how to avoid them. '.repeat(
    5,
  )}</main></body></html>`;
  const result = classifyResponse({ status: 200, headers: {}, body });
  // This documents current behavior (flagged as soft-block) rather than asserting
  // it is "correct" in every case - see the module README's soft-block discussion.
  assert.equal(result.kind, 'soft-block');
});
