/**
 * Pure string-similarity primitives used by the match confidence scorer.
 * No I/O, no randomness: everything here is a deterministic pure function,
 * which is what makes the scorer's output fully explainable and testable.
 */

/** Common legal-entity suffixes, normalized away before comparing "core" names. */
const LEGAL_SUFFIXES = [
  'llc',
  'l.l.c.',
  'inc',
  'inc.',
  'incorporated',
  'corp',
  'corp.',
  'corporation',
  'co',
  'co.',
  'company',
  'ltd',
  'ltd.',
  'limited',
  'lp',
  'l.p.',
  'llp',
  'l.l.p.',
  'plc',
];

/**
 * Normalizes a company/entity name for comparison: lowercases, strips
 * punctuation, collapses whitespace, and removes common legal suffixes.
 *
 * Deliberately does NOT strip geographic qualifiers like "of Texas" or
 * "- Dallas" - those are exactly the tokens that distinguish two otherwise
 * near-identical entity names, and stripping them would recreate the false
 * positive this module exists to prevent.
 */
export function normalizeName(raw: string): string {
  const lowered = raw.toLowerCase();
  const noPunctuation = lowered.replace(/[.,'"()]/g, ' ');
  const tokens = noPunctuation.split(/\s+/).filter(Boolean);
  const withoutSuffixes = tokens.filter((token) => !LEGAL_SUFFIXES.includes(token));
  return withoutSuffixes.join(' ').trim();
}

/** Normalizes an address for token comparison: lowercase, expand common abbreviations, strip punctuation. */
const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  hwy: 'highway',
  pkwy: 'parkway',
  ste: 'suite',
  apt: 'apartment',
  fl: 'floor',
};

export function normalizeAddress(raw: string): string {
  const lowered = raw.toLowerCase();
  const noPunctuation = lowered.replace(/[.,#'"]/g, ' ');
  const tokens = noPunctuation.split(/\s+/).filter(Boolean);
  const expanded = tokens.map((token) => ADDRESS_ABBREVIATIONS[token] ?? token);
  return expanded.join(' ').trim();
}

/** Classic Levenshtein edit distance between two strings. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          currentRow[j - 1] + 1, // insertion
          previousRow[j] + 1, // deletion
          previousRow[j - 1] + cost, // substitution
        ),
      );
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/**
 * Levenshtein similarity ratio, normalized to [0, 1] where 1 means identical.
 * Ratio form (rather than raw distance) so it composes cleanly with other
 * [0, 1] signals in the weighted scorer.
 */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Token-set ratio: order-independent similarity based on shared tokens
 * (Jaccard-style overlap over word sets), inspired by fuzzywuzzy's
 * token_set_ratio. This is what correctly gives high similarity to
 * "Smith Logistics LLC" vs "Logistics Smith LLC" (same tokens, different
 * order - should be treated as identical), while ALSO still giving a high
 * raw score to "Smith Logistics LLC" vs "Smith Logistics of Texas LLC"
 * (mostly overlapping tokens). That second case is exactly why name
 * similarity alone is never sufficient - see score.ts for how the
 * distinguishing "of texas" token is weighed elsewhere in the pipeline.
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = [...tokensA].filter((token) => tokensB.has(token));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.length / union.size;
}

/**
 * Detects whether B contains extra distinguishing tokens beyond A (or vice
 * versa) that are NOT filler words - the "of Texas" / "- Dallas" /
 * "North Division" style qualifiers that indicate a related-but-distinct
 * entity rather than a formatting variation of the same one.
 *
 * Returns the set of "extra" tokens present in the longer name after
 * removing the shared tokens and common filler/connector words. A non-empty
 * result is a signal (not proof) that these may be different entities under
 * a shared parent brand.
 */
const FILLER_TOKENS = new Set(['the', 'and', '&', 'a', 'of']);

export function extraDistinguishingTokens(a: string, b: string): string[] {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  const longer = tokensA.size >= tokensB.size ? tokensA : tokensB;
  const shorter = tokensA.size >= tokensB.size ? tokensB : tokensA;

  return [...longer].filter((token) => !shorter.has(token) && !FILLER_TOKENS.has(token));
}
