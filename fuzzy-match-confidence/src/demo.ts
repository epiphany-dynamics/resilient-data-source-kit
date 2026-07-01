/**
 * Runnable demo: compares a naive substring matcher against scoreMatch()
 * across several record pairs, centered on the canonical false-positive
 * trap case (two different real companies that share most of their name).
 *
 * Run with: npm run demo:match
 */
import { scoreMatch, type EntityRecord } from './score.js';
import { normalizeName } from './similarity.js';

function naiveSubstringMatch(a: EntityRecord, b: EntityRecord): boolean {
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  return nameA.includes(nameB) || nameB.includes(nameA) || nameA === nameB;
}

interface Scenario {
  label: string;
  a: EntityRecord;
  b: EntityRecord;
  note: string;
}

const scenarios: Scenario[] = [
  {
    label: 'The false-positive trap: two different real companies, one a substring of the other',
    a: { name: 'Smith Logistics LLC', address: '123 Main St, Austin, TX' },
    b: { name: 'Smith Logistics of Texas LLC', address: '456 Commerce Blvd, Dallas, TX' },
    note: 'Different street, different city. Likely two distinct legal entities sharing a common brand name.',
  },
  {
    label: 'A true positive with formatting noise (should score high)',
    a: { name: 'Acme Corp', address: '789 Industrial Pkwy, Reno, NV', domain: 'acme-example.com' },
    b: { name: 'Acme, Inc.', address: '789 Industrial Parkway, Reno, NV', domain: 'www.acme-example.com' },
    note: 'Same address (modulo abbreviation), same domain, minor legal-suffix noise in the name.',
  },
  {
    label: 'A true positive with only a name to go on (no address/domain on file)',
    a: { name: 'Riverbend Manufacturing Co' },
    b: { name: 'Riverbend Manufacturing' },
    note: 'No corroborating data at all. Name is a near-exact match but nothing else can confirm it.',
  },
  {
    label: 'A clear non-match with superficially similar names',
    a: { name: 'National Freight Solutions', address: '10 Port Rd, Newark, NJ' },
    b: { name: 'National Freight Partners', address: '900 Harbor Way, Miami, FL' },
    note: 'Shares two of three name tokens but is a different company at a different address entirely.',
  },
  {
    label: 'Same name, domain confirms, but different address on file (e.g. HQ moved)',
    a: { name: 'Bluepoint Analytics LLC', address: '1 Old Address Ln, Columbus, OH', domain: 'bluepoint-analytics.com' },
    b: { name: 'Bluepoint Analytics LLC', address: '99 New Campus Dr, Columbus, OH', domain: 'bluepoint-analytics.com' },
    note: 'Domain match is a strong corroborating signal even though the street address changed.',
  },
];

function printResult(scenario: Scenario) {
  console.log(`\n=== ${scenario.label} ===`);
  console.log(`  A: "${scenario.a.name}" | ${scenario.a.address ?? '(no address)'} | ${scenario.a.domain ?? '(no domain)'}`);
  console.log(`  B: "${scenario.b.name}" | ${scenario.b.address ?? '(no address)'} | ${scenario.b.domain ?? '(no domain)'}`);
  console.log(`  Context: ${scenario.note}`);

  const naive = naiveSubstringMatch(scenario.a, scenario.b);
  console.log(`  Naive substring/exact matcher says: ${naive ? 'MATCH (auto-accept)' : 'no match'}`);

  const result = scoreMatch(scenario.a, scenario.b);
  console.log(`  scoreMatch() says: score=${result.score} band=${result.band.toUpperCase()} requiresHumanReview=${result.requiresHumanReview}`);
  for (const line of result.explanation) {
    console.log(`    - ${line}`);
  }
}

function main() {
  console.log('fuzzy-match-confidence demo: naive matcher vs. multi-signal confidence scorer\n');
  for (const scenario of scenarios) {
    printResult(scenario);
  }

  console.log('\n--- Why this matters ---');
  console.log(
    'Scenario 1 is the failure mode this module exists to catch: the naive matcher confidently\n' +
      'merges two different real companies because one name is a near-superset of the other.\n' +
      'scoreMatch() sees the same name overlap but weighs it against conflicting address evidence\n' +
      'and refuses to auto-accept, flagging it for human review instead.',
  );
}

main();
