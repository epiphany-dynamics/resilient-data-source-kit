# Resilient Data Source Kit

Patterns for building data pipelines that pull from external sources that don't
want to be scraped, and for correlating entities across those sources without
drowning in false positives.

Every real-world data pipeline that reaches outside its own database eventually
runs into the same two problems:

1. **The source fights back.** Public directories, aggregator sites, and
   semi-public APIs rate-limit you, serve CAPTCHA pages instead of data, and
   return `403`/`429` the moment your traffic pattern looks automated. Naive
   retry logic (retry-forever, or retry-with-fixed-delay) either gets your IP
   banned faster or hammers a source that has already told you to back off.

2. **The entities don't line up cleanly.** You're trying to decide whether "the
   ACME Corp you found on Source A" is "the ACME Corp you already have on file,"
   using nothing but noisy fields like a business name, an address, or a
   domain. Exact-string or substring matching produces confident-looking
   answers that are frequently wrong: `"Smith Logistics LLC"` and `"Smith
   Logistics of Texas LLC"` share nearly every token, and are two different
   legal entities.

This repo is a small, runnable demonstration of how to handle both problems
without either paper cut sinking a production pipeline. It is deliberately
generic: no real client, vendor, or data source is referenced anywhere. Where
a concrete example is useful, it uses illustrative stand-ins like "Source A" /
"a public business directory site."

## What's in here

| Directory | Demonstrates |
|---|---|
| [`scraper-resilience/`](./scraper-resilience) | Exponential backoff + jitter, header/fingerprint rotation, soft-block vs. hard-block detection, and a per-source circuit breaker. Includes a demo against a mock flaky endpoint. |
| [`fuzzy-match-confidence/`](./fuzzy-match-confidence) | A multi-signal entity match confidence scorer (name similarity + address similarity + domain match combined into high/medium/low confidence bands) that replaces a single fragile equality check. Includes a demo of the exact false-positive it's designed to catch. |
| [`data-gap-handling.md`](./data-gap-handling.md) | Why "no data found" must be scored as `unknown`, not as a negative signal, and the anti-pattern that turns absence-of-evidence into false fraud/risk flags. |

## Why this matters (the actual engineering problem)

Both halves of this repo are really the same lesson wearing different clothes:
**treat uncertainty as uncertainty, not as a clean binary.** A scraper that
gets blocked isn't necessarily "the data doesn't exist"; it might mean "try
again later, more carefully, and eventually admit defeat and say so." A record
that doesn't match exactly isn't necessarily "these are different companies"
or "these are the same company"; it's evidence that should be weighed, scored
on a spectrum, and routed to a human when the spectrum lands in the middle.

Systems that collapse "we don't know" into a hard `true`/`false` are the
single most common source of silent data-quality bugs in pipelines that
integrate external sources: false-positive entity matches that merge two
different companies' records, false-negative risk flags that miss a real
match, and false "negative signal" conclusions drawn from a source that simply
didn't have the data.

## Quick start

```bash
npm install
npm run demo:scraper   # runs the retry/backoff/circuit-breaker demo against a mock flaky endpoint
npm run demo:match     # runs the fuzzy match confidence scorer against sample record pairs
npm test               # runs the test suite for both modules
```

Requires Node.js 18+ (uses native `fetch` types; no network calls are made,
the scraper demo runs entirely against an in-process mock server function).

## Design principles used throughout

- **Fail loud internally, degrade gracefully externally.** Every retry,
  backoff, and circuit-breaker trip is logged with a reason. Nothing silently
  swallows an error.
- **Confidence bands over booleans.** Match results are `high` / `medium` /
  `low`, not `match` / `no-match`. Low and medium confidence route to a human
  review queue rather than auto-deciding.
- **Absence of data is `unknown`, never `negative`.** See
  [`data-gap-handling.md`](./data-gap-handling.md).
- **Everything is unit-testable without hitting the network.** The scraper
  resilience demo uses an injectable mock transport so retry/backoff logic can
  be verified deterministically in CI.

## License

MIT, see [`LICENSE`](./LICENSE).
