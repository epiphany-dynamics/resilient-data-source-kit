/**
 * Website domain normalization and comparison.
 *
 * Domain match is a strong signal when both records have one, but it's
 * frequently *absent* (many source records simply don't carry a website
 * field), so the scorer treats a missing domain on either side as
 * "no evidence either way," never as a mismatch. Absence of a domain field
 * must not be scored as if it were a domain conflict - that's the same
 * "gap != negative signal" principle covered in ../../data-gap-handling.md,
 * applied at the field level instead of the source level.
 */

export function normalizeDomain(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;

  let domain = trimmed.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split('/')[0];
  domain = domain.split('?')[0];
  domain = domain.replace(/\.$/, '');

  return domain.length > 0 ? domain : undefined;
}

export type DomainComparison =
  | { status: 'match'; domain: string }
  | { status: 'mismatch'; domainA: string; domainB: string }
  | { status: 'insufficient-data' };

export function compareDomains(rawA: string | undefined | null, rawB: string | undefined | null): DomainComparison {
  const a = normalizeDomain(rawA);
  const b = normalizeDomain(rawB);

  if (!a || !b) {
    return { status: 'insufficient-data' };
  }

  if (a === b) {
    return { status: 'match', domain: a };
  }

  return { status: 'mismatch', domainA: a, domainB: b };
}
