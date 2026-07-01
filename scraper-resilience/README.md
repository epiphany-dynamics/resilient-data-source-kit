# scraper-resilience

A small TypeScript module for pulling data from sources that actively try to
block automated access: public directory sites, aggregator pages, semi-public
APIs with undocumented rate limits, and anything else that treats "traffic
that looks like a script" as a threat to mitigate.

It does not scrape anything real. It is a set of composable, unit-tested
primitives, demonstrated against a mock flaky HTTP endpoint, that you drop
into a real fetch/HTTP-client layer.

## The problem this solves

A source that doesn't want to be scraped signals that in a few different ways,
and treating them all the same way is the most common mistake:

- **Hard block**: `403 Forbidden`, `429 Too Many Requests` with a `Retry-After`
  header, or a connection reset. The source is telling you unambiguously to
  stop or slow down.
- **Soft block**: an HTTP `200 OK` that contains a CAPTCHA challenge page, an
  "unusual traffic detected" interstitial, or a stripped-down rate-limit page
  instead of the real content. This is worse than a hard block because a naive
  scraper interprets `200 OK` as success, parses garbage, and either crashes
  downstream or (worse) silently stores wrong data.
- **Real transient failure**: a `500`, a timeout, a flaky network blip that has
  nothing to do with anti-bot defenses at all.

Each of these needs a different response. Retrying a hard `429` immediately
makes the block worse. Not detecting a soft block means "successfully"
ingesting a CAPTCHA page as if it were data. And hammering a source that has
soft-blocked you five times in a row, hoping the sixth try gets through, is
how IP ranges end up permanently blacklisted.

## Components

| File | Responsibility |
|---|---|
| `src/types.ts` | Shared types: `FetchResult`, `ResponseClassification`, `RetryConfig`, `CircuitState`. |
| `src/backoff.ts` | Exponential backoff with full jitter, capped at a max delay. Pure function, fully deterministic given a seeded RNG, so it's testable without real timers. |
| `src/fingerprint.ts` | Rotating request header sets (User-Agent, Accept-Language, Accept, sec-ch-ua, etc.) that model a small pool of realistic browser fingerprints, picked pseudo-randomly per request rather than reused identically on every call. |
| `src/classify.ts` | Classifies a raw response into `ok`, `hard-block`, `soft-block`, or `transient-error` by inspecting status code, headers, and body heuristics (CAPTCHA/challenge markers, suspiciously small body size, known rate-limit page fingerprints). |
| `src/circuit-breaker.ts` | Per-source circuit breaker: `closed` -> `open` -> `half-open` state machine. Trips open after N consecutive soft-blocks or hard-blocks *from the same source*, and stays open for a cooldown window before allowing a single probe request through. |
| `src/client.ts` | Wires the above together into a `resilientFetch(source, request, fn)` helper: classify -> decide retry/backoff/circuit action -> retry with backoff and rotated fingerprint, or fail fast if the circuit is open. |
| `src/demo.ts` | Runs `resilientFetch` against an in-process mock endpoint that is deliberately flaky (some soft-blocks, some hard 429s, some transient 500s, eventual success), and prints a trace of every decision made. |

## Why a circuit breaker on top of retries

Retry-with-backoff handles *one call's* resilience. It does not stop the
pipeline from making the next call, and the one after that, and the one after
that, against a source that has already shown a clear pattern of blocking you.
The circuit breaker adds resilience *across calls to the same source*:

- `closed`: requests flow normally; failures are counted.
- After `failureThreshold` consecutive soft/hard blocks from a source, the
  circuit trips to `open`: the source is treated as unavailable, and every
  call fails fast (no network request at all) for `cooldownMs`.
- After the cooldown, the circuit goes `half-open`: exactly one probe request
  is allowed through. Success closes the circuit and resets the counter.
  Failure re-opens it and doubles the cooldown (with a cap), so a source that
  is seriously blocking you gets backed off harder each time, not hammered
  every `cooldownMs` forever.

This is the standard distributed-systems circuit-breaker pattern (as used for
service-to-service calls) applied to an adversarial external source instead of
an internal dependency; the adversarial part just means the "failure" signal
includes soft-blocks (200 OK, wrong content) as well as hard errors.

## Running it

```bash
npm install
npm run demo:scraper
npm run test:scraper
```

The demo has no external network dependency; the "flaky endpoint" is a
function in `src/demo.ts` that returns scripted soft-block/hard-block/success
responses so the behavior is fully reproducible.
