import type { RawResponse, ResponseClassification } from './types.js';
import { parseRetryAfterMs } from './backoff.js';

/**
 * Markers that show up in known CAPTCHA/challenge/rate-limit interstitial
 * pages. This is intentionally a small, generic illustrative list, not a
 * comprehensive fingerprint database: in a real system this would be tuned
 * per-source based on observed block pages.
 */
const SOFT_BLOCK_BODY_MARKERS = [
  'captcha',
  'are you a human',
  'verify you are human',
  'unusual traffic',
  'automated requests',
  'please enable javascript and cookies',
  'access to this page has been denied',
  'checking your browser before accessing',
  'rate limit exceeded',
  'request blocked',
];

/** A body this short is almost never a real content page for a directory/listing site. */
const SUSPICIOUSLY_SMALL_BODY_BYTES = 200;

/**
 * Classifies a raw HTTP response into one of four buckets:
 *
 * - `ok`: looks like real content.
 * - `hard-block`: the source unambiguously told us to stop (403/429/451, or
 *   a Retry-After header on any error status).
 * - `soft-block`: status looks fine (200) but the body is a CAPTCHA/challenge
 *   page, or is suspiciously small/empty for content that should be
 *   substantial. This is the dangerous case: a naive scraper treats this as
 *   success and stores garbage.
 * - `transient-error`: 5xx or a status that doesn't indicate blocking,
 *   consistent with a normal server hiccup rather than anti-bot defense.
 */
export function classifyResponse(response: RawResponse): ResponseClassification {
  const { status, headers, body } = response;
  const retryAfterMs = parseRetryAfterMs(headers['retry-after'] ?? headers['Retry-After']);

  if (status === 403 || status === 429 || status === 451) {
    return {
      kind: 'hard-block',
      reason: `status ${status} (${statusLabel(status)})`,
      retryAfterMs,
    };
  }

  if (status >= 500) {
    return { kind: 'transient-error', reason: `status ${status} server error` };
  }

  if (status >= 200 && status < 300) {
    const bodyLower = body.toLowerCase();
    const matchedMarker = SOFT_BLOCK_BODY_MARKERS.find((marker) => bodyLower.includes(marker));
    if (matchedMarker) {
      return { kind: 'soft-block', reason: `body contains challenge marker: "${matchedMarker}"` };
    }
    if (body.trim().length < SUSPICIOUSLY_SMALL_BODY_BYTES) {
      return {
        kind: 'soft-block',
        reason: `body suspiciously small (${body.trim().length} bytes) for a 200 response`,
      };
    }
    return { kind: 'ok' };
  }

  if (status >= 400) {
    return { kind: 'transient-error', reason: `status ${status} client error (non-blocking)` };
  }

  return { kind: 'transient-error', reason: `unexpected status ${status}` };
}

function statusLabel(status: number): string {
  switch (status) {
    case 403:
      return 'Forbidden';
    case 429:
      return 'Too Many Requests';
    case 451:
      return 'Unavailable For Legal Reasons';
    default:
      return 'blocked';
  }
}
