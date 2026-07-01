# fuzzy-match-confidence

A multi-signal entity match confidence scorer for deciding whether two
records from different sources represent the same real-world entity (a
company, in the examples here, though the same approach applies to any
entity-resolution problem: people, addresses, products).

## The problem this solves

The naive approach to entity matching is a single equality or substring
check on the name field:

```ts
const isMatch = recordA.name.toLowerCase() === recordB.name.toLowerCase();
// or, worse:
const isMatch = recordB.name.toLowerCase().includes(recordA.name.toLowerCase());
```

Both versions fail in production, in opposite directions:

- **Exact match** is too strict: `"Acme Corp"` vs `"Acme Corporation"`, or
  `"Acme, Inc."` vs `"ACME INC"`, are almost certainly the same company but
  will never match on equality, producing false negatives that make a
  pipeline think a known entity is new.
- **Substring match** is too loose, and this is the more dangerous direction:
  `"Smith Logistics LLC"` is a substring-adjacent match of `"Smith Logistics
  of Texas LLC"`, but these are two different legal entities that happen to
  share a common parent brand name. A substring or high-raw-similarity check
  will confidently call this a match. That's a false positive, and
  false positives are worse than false negatives in most entity-resolution
  contexts: they silently merge two different companies' data, records,
  or risk history into one, and nobody notices until it causes a real
  problem downstream.

## The fix: weighted multi-signal scoring into confidence bands

Instead of one fragile check, `scoreMatch()` combines several independent,
individually weak signals into a single confidence score, then buckets that
score into `high` / `medium` / `low`:

| Signal | What it measures | Why it's only part of the picture alone |
|---|---|---|
| Name similarity | Token-set-based similarity (order-independent, so "Logistics Smith LLC" still compares fairly against "Smith Logistics LLC") plus a normalized Levenshtein ratio as a secondary check. | Two different companies can share most name tokens ("Smith Logistics" vs "Smith Logistics of Texas"). Name alone cannot tell franchise/subsidiary/unrelated-lookalike cases apart. |
| Address similarity | Normalized street-address token overlap. | Two branches of the same chain can share a name but sit at different addresses; two unrelated companies can share a building (shared office space, registered agent addresses). Address alone is also weak. |
| Domain match | Exact or near-exact match on a normalized website domain. | Strong signal when present, but a huge fraction of real records simply don't have a domain field populated, so it can't be relied on alone or required. |

No single signal is trusted on its own. The combined, weighted score is what
gets bucketed into a confidence band:

- **`high`**: multiple strong, independent signals agree (e.g. name is very
  similar AND domain matches, or name + address both agree strongly).
  Safe to auto-accept in most pipelines, though even here the tool reports
  *why* so it stays auditable.
- **`medium`**: some signals agree, but not enough independent corroboration,
  or there's an explicit signal conflict (e.g. names are very similar but
  addresses clearly differ). Routed to a human review queue, not auto-decided
  either way.
- **`low`**: signals mostly disagree or are too weak to say anything.
  Treated as "probably not the same entity" but still not silently discarded;
  it's reported so a human or a downstream audit can see the near-miss.

## The demonstrated failure mode

`src/demo.ts` runs the scorer against a set of record pairs including the
canonical trap case:

```
Record A: "Smith Logistics LLC",        123 Main St, Austin, TX
Record B: "Smith Logistics of Texas LLC", 456 Commerce Blvd, Dallas, TX
```

A naive substring/exact matcher calls this a confident match (or even just a
raw name-similarity score without banding would score it artificially high,
since the token overlap is large). The demo prints both:

1. **What a naive matcher would conclude** (substring match on normalized
   names): `MATCH`.
2. **What `scoreMatch()` concludes**: `low` confidence, with an explicit
   breakdown showing the name signal is moderately high but the address
   signal actively conflicts (different street, different city), plus a
   flagged distinguishing name qualifier ("texas"), and a
   `requiresHumanReview: true` flag rather than an auto-accept.

This is the concrete "we solved a real hard problem" case: the naive path
would have silently merged two different legal entities' records. The scored
path catches the disagreement and routes it to a human instead of guessing.

## Components

| File | Responsibility |
|---|---|
| `src/similarity.ts` | Pure string-similarity primitives: Levenshtein distance/ratio, token-set-ratio (order-independent token overlap), and a name/address normalizer (case-folding, punctuation stripping, legal-suffix normalization like `LLC`/`Inc`/`Corp`). |
| `src/domain.ts` | Website domain normalization (strips protocol/www/trailing slash) and exact/near-match comparison. |
| `src/score.ts` | `scoreMatch(recordA, recordB)`: combines the signals with configurable weights into a 0-1 confidence score and a `high`/`medium`/`low` band, with a full breakdown of each signal's contribution. |
| `src/demo.ts` | Runs the scorer against sample record pairs, including the "Smith Logistics" false-positive trap, and prints the naive-vs-scored comparison. |

## Running it

```bash
npm install
npm run demo:match
npm run test:match
```
