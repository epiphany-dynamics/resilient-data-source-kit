# Data gap handling: absence of evidence is not evidence of absence

A short, generalizable lesson that applies to almost any pipeline built on
top of external data sources: what a system does when a source returns
**nothing** matters as much as what it does when a source returns data.

## The anti-pattern

Say a pipeline checks an entity (a company, a person, a product) against
several external sources and rolls the results into a risk, trust, or
confidence score. A common and seriously damaging bug looks like this:

```
for each source in [source_a, source_b, source_c]:
    result = query(source, entity)
    if result.found:
        score += evaluate(result)
    else:
        score -= NO_DATA_PENALTY   # <-- the bug
```

The moment "we found nothing" gets treated as a negative data point, the
scoring system has quietly encoded a false assumption: **that every
legitimate entity must have a footprint on every source you check.**

That assumption is false, and it fails in a specific, predictable direction:
it penalizes exactly the entities that are smaller, newer, more private, or
simply outside a given source's coverage. This isn't a hypothetical edge
case; it's most of the long tail. A small regional business, a newly
incorporated company, a privacy-conscious individual, or an entity that
simply isn't indexed by one particular directory or aggregator can all have
zero footprint on a specific source while being completely legitimate.

Concrete failure: a supplier verification, KYC, or fraud-scoring pipeline
that treats "no public records found on Source B" as a red flag will
systematically flag smaller and newer legitimate businesses as higher-risk
than large, well-established ones, purely because of source coverage gaps
that have nothing to do with actual risk. That's not just a data-quality bug;
it's a bias the scoring system now bakes into every decision downstream,
and it gets worse the more sources you add if each one repeats the same
mistake independently.

## Why this is easy to introduce by accident

It happens because "no data" and "negative data" often arrive through the
same code path. An API that returns `404` for "no records found" looks
identical, structurally, to an API that returns `404` for "this ID is
invalid" or an empty array for "explicitly checked, zero matches" vs. "this
source doesn't cover this entity type at all." If a developer writes the
happy path first (source found something, here's how to score it) and adds
the "not found" branch later as an afterthought, that afterthought is where
the penalty sneaks in, usually with good intentions: "if we can't verify
them anywhere, that should count against them," which is intuitively
appealing and empirically wrong.

## The fix: three-way outcomes, not two

Every check against an external source should produce one of three
outcomes, not two:

| Outcome | Meaning | Scoring impact |
|---|---|---|
| **Positive evidence** | The source has data, and it corroborates or supports the entity's legitimacy/identity. | Score up. |
| **Negative evidence** | The source has data, and it actively contradicts or flags the entity (a real, substantive negative signal: a fraud report, an active complaint record, a confirmed mismatch). | Score down. |
| **Unknown / gap** | The source has no data on this entity at all: no record found, source doesn't cover this entity type, or the query legitimately couldn't be completed. | **No scoring impact by itself.** Recorded as a gap, not folded into the score. |

The critical design rule: **a gap on one source, by itself, must never move
the score.** It should be logged, surfaced, and counted, but not scored as if
it were a finding.

## Corroboration before penalizing

Where gaps *do* legitimately matter is in aggregate, across multiple
independent sources, and only when there's a specific, articulable reason
gaps should be suspicious for that particular entity type:

- One directory site having no listing: not suspicious. Directories have
  incomplete, inconsistent coverage; that's normal and expected.
- Zero results across every source that would normally be expected to carry
  a record for an entity of this type, size, and age, combined with an
  independent, actual negative signal from at least one source: that's a
  pattern worth surfacing for human review, not an automatic score penalty
  applied by a single missing lookup.

In other words: require **corroborating negative signal**, not just
corroborating absence, before a gap pattern is allowed to influence a score.
"Nobody has any data on this entity" and "multiple sources actively flagged
this entity" are different findings and should never collapse into the same
number.

## How this connects to the rest of this repo

This is the same principle behind the confidence-banding approach in
[`fuzzy-match-confidence/`](./fuzzy-match-confidence): don't force
ambiguous, partial, or missing evidence into a binary decision. A missing
field (no address on file, no domain on file) is scored as "insufficient
data," not silently treated as a 0 or a mismatch, in the exact same spirit as
this document's rule for missing source data. Uncertainty is a first-class
state in both, not something that gets rounded off to `true` or `false` for
convenience.

## Practical checklist

When building or reviewing a pipeline that scores entities against external
sources, check for:

- [ ] Does "no data found" ever get treated as a data point in the scoring
      math (a subtraction, a boolean flip, a default-to-negative)?
- [ ] Is there a distinct, loggable state for "source has no coverage for
      this entity" separate from "source has coverage and found nothing
      wrong"?
- [ ] Does the system require more than one signal before a gap-based
      pattern can move a score, or can a single missing lookup alone tip a
      decision?
- [ ] Are gap rates tracked per source over time? A source whose gap rate
      changes suddenly (an outage, a schema change, a scraper starting to
      get blocked, see [`scraper-resilience/`](./scraper-resilience)) can
      silently masquerade as "everyone suddenly has bad data," when the real
      cause is that the pipeline stopped successfully reaching the source at
      all.
