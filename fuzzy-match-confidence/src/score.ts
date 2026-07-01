import {
  extraDistinguishingTokens,
  levenshteinRatio,
  normalizeAddress,
  normalizeName,
  tokenSetRatio,
} from './similarity.js';
import { compareDomains } from './domain.js';

export interface EntityRecord {
  name: string;
  address?: string;
  domain?: string;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface SignalBreakdown {
  nameSimilarity: number; // 0-1
  addressSimilarity: number | null; // null = insufficient data on one/both sides
  domainMatch: 'match' | 'mismatch' | 'insufficient-data';
  hasDistinguishingQualifier: boolean; // e.g. "of Texas" present in one name but not the other
  distinguishingTokens: string[];
}

export interface MatchScoreResult {
  score: number; // 0-1 combined confidence score
  band: ConfidenceBand;
  requiresHumanReview: boolean;
  signals: SignalBreakdown;
  explanation: string[];
}

export interface ScoreWeights {
  name: number;
  address: number;
  domain: number;
}

/**
 * Default weights. Name carries the most weight because it's present on
 * essentially every record, but it is deliberately capped well below 1.0 so
 * that name similarity alone can never push a pair into the `high` band -
 * see the `high` band's explicit signal-agreement requirement in
 * bandFromScore(). Address and domain exist to corroborate or contradict it.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  name: 0.5,
  address: 0.3,
  domain: 0.2,
};

/** Score thresholds for banding. Tuned so that name-only high similarity cannot alone reach `high`. */
const HIGH_THRESHOLD = 0.78;
const MEDIUM_THRESHOLD = 0.5;

/**
 * Scores whether two entity records represent the same real-world entity.
 *
 * This intentionally does NOT return a boolean. A boolean match/no-match
 * forces every ambiguous case into a guess. Instead it returns a confidence
 * band so a caller can auto-accept `high`, route `medium` to human review,
 * and treat `low` as "probably distinct" while still keeping the evidence
 * available for audit.
 */
export function scoreMatch(
  a: EntityRecord,
  b: EntityRecord,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): MatchScoreResult {
  const normA = normalizeName(a.name);
  const normB = normalizeName(b.name);

  // Name similarity: blend token-set ratio (robust to word order and to one
  // name being a superset of the other's tokens) with Levenshtein ratio
  // (catches close misspellings/abbreviations that token overlap alone
  // would miss, e.g. "Acme" vs "Acmee").
  const tokenSim = tokenSetRatio(normA, normB);
  const editSim = levenshteinRatio(normA, normB);
  const nameSimilarity = tokenSim * 0.7 + editSim * 0.3;

  const distinguishingTokens = extraDistinguishingTokens(normA, normB);
  const hasDistinguishingQualifier = distinguishingTokens.length > 0;

  // Address similarity: null (not 0) when data is missing on either side,
  // so "no address data" is visibly different from "addresses disagree."
  let addressSimilarity: number | null = null;
  if (a.address && b.address) {
    const normAddrA = normalizeAddress(a.address);
    const normAddrB = normalizeAddress(b.address);
    addressSimilarity = tokenSetRatio(normAddrA, normAddrB) * 0.6 + levenshteinRatio(normAddrA, normAddrB) * 0.4;
  }

  const domainComparison = compareDomains(a.domain, b.domain);
  const domainMatch = domainComparison.status;

  // Build the weighted score. Missing signals are excluded from both the
  // numerator and the denominator (re-normalized weights) rather than
  // silently scored as 0 or 1 - a missing address must not count as either
  // "addresses match" or "addresses conflict."
  let weightedSum = nameSimilarity * weights.name;
  let weightUsed = weights.name;

  if (addressSimilarity !== null) {
    weightedSum += addressSimilarity * weights.address;
    weightUsed += weights.address;
  }

  if (domainMatch === 'match') {
    weightedSum += 1 * weights.domain;
    weightUsed += weights.domain;
  } else if (domainMatch === 'mismatch') {
    weightedSum += 0 * weights.domain;
    weightUsed += weights.domain;
  }
  // 'insufficient-data': domain weight excluded entirely, same principle as address.

  const rawScore = weightUsed > 0 ? weightedSum / weightUsed : 0;

  // Explicit conflict override: if a distinguishing qualifier is present in
  // the name AND we have corroborating address or domain data that disagrees,
  // that combination is a strong "these are different entities" signal, not
  // just a slightly-lower-similarity one. Cap the score to force it below the
  // high threshold even if raw token overlap alone would have been high.
  let score = rawScore;
  const explanation: string[] = [];

  explanation.push(
    `name similarity ${nameSimilarity.toFixed(2)} (token-set ${tokenSim.toFixed(2)}, edit-distance ${editSim.toFixed(2)})`,
  );

  if (addressSimilarity !== null) {
    explanation.push(`address similarity ${addressSimilarity.toFixed(2)}`);
  } else {
    explanation.push('address similarity: insufficient data (not counted as a match or a conflict)');
  }

  if (domainMatch === 'match') {
    explanation.push('domain: exact match');
  } else if (domainMatch === 'mismatch') {
    explanation.push('domain: mismatch (different domains on file)');
  } else {
    explanation.push('domain: insufficient data (not counted as a match or a conflict)');
  }

  if (hasDistinguishingQualifier) {
    explanation.push(
      `name contains distinguishing qualifier(s) not shared by the other record: [${distinguishingTokens.join(', ')}]`,
    );

    const hasCorroboratingConflict = addressSimilarity !== null && addressSimilarity < 0.4;
    const hasDomainConflict = domainMatch === 'mismatch';

    if (hasCorroboratingConflict || hasDomainConflict) {
      const capped = Math.min(score, MEDIUM_THRESHOLD - 0.01);
      if (capped < score) {
        explanation.push(
          'distinguishing name qualifier + corroborating conflict in address/domain: capping score below the medium threshold rather than trusting raw name overlap',
        );
      }
      score = capped;
    } else if (addressSimilarity === null && domainMatch === 'insufficient-data') {
      // Distinguishing qualifier present but no corroborating data either way:
      // don't cap outright, but don't let it reach `high` on name alone either.
      const capped = Math.min(score, HIGH_THRESHOLD - 0.01);
      if (capped < score) {
        explanation.push(
          'distinguishing name qualifier with no corroborating address/domain data: capping below the high threshold, this needs a human to resolve',
        );
      }
      score = capped;
    }
  }

  const band = bandFromScore(score, { addressSimilarity, domainMatch });
  const requiresHumanReview = band === 'medium' || (band === 'low' && hasDistinguishingQualifier);

  return {
    score: round2(score),
    band,
    requiresHumanReview,
    signals: {
      nameSimilarity: round2(nameSimilarity),
      addressSimilarity: addressSimilarity === null ? null : round2(addressSimilarity),
      domainMatch,
      hasDistinguishingQualifier,
      distinguishingTokens,
    },
    explanation,
  };
}

/**
 * Bands a raw score into high/medium/low. `high` additionally requires at
 * least one corroborating signal beyond name alone (a matching domain, or a
 * strong address match) - a pipeline should never auto-accept a match on
 * name similarity in isolation, no matter how high that one number is.
 */
function bandFromScore(
  score: number,
  context: { addressSimilarity: number | null; domainMatch: 'match' | 'mismatch' | 'insufficient-data' },
): ConfidenceBand {
  const hasCorroboration =
    context.domainMatch === 'match' || (context.addressSimilarity !== null && context.addressSimilarity >= 0.7);

  if (score >= HIGH_THRESHOLD && hasCorroboration) return 'high';
  if (score >= HIGH_THRESHOLD && !hasCorroboration) return 'medium'; // strong name-only similarity: still needs review
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
