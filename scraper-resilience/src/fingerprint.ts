/**
 * Rotating request "fingerprints" (headers) to reduce the chance that a
 * source's bot-detection flags traffic purely because every request looks
 * byte-for-byte identical: same User-Agent, same header order, same Accept
 * values, forever.
 *
 * This is NOT about impersonating a specific user or evading legal terms of
 * service. It's about not being a textbook example of "obviously a script":
 * real browser traffic naturally varies across a population of users, and a
 * scraper that sends the exact same static header set on every single
 * request for weeks is a much easier signal to key off than a small rotating
 * pool of realistic, internally-consistent header sets.
 *
 * Each profile is internally consistent (the User-Agent, sec-ch-ua, and
 * Accept-Language values all describe the same plausible browser/OS/locale
 * combination) because *inconsistent* fingerprints (e.g. a Chrome UA paired
 * with Firefox-only headers) are themselves a strong bot signal.
 */

export interface RequestFingerprint {
  headers: Record<string, string>;
  label: string;
}

const PROFILES: RequestFingerprint[] = [
  {
    label: 'chrome-macos-en-us',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-platform': '"macOS"',
      'sec-ch-ua-mobile': '?0',
    },
  },
  {
    label: 'firefox-windows-en-us',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  },
  {
    label: 'safari-macos-en-us',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
  {
    label: 'edge-windows-en-gb',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-mobile': '?0',
    },
  },
];

/**
 * Picks a fingerprint profile. Deterministic given a seeded `rand` (so tests
 * can assert rotation happens), pseudo-random by default.
 *
 * `avoidLabel` lets a caller ask for "anything but the profile I just used,"
 * which is the common case: rotate on every retry rather than reusing the
 * same fingerprint that may have just been flagged.
 */
export function pickFingerprint(
  rand: () => number = Math.random,
  avoidLabel?: string,
): RequestFingerprint {
  const candidates = avoidLabel ? PROFILES.filter((p) => p.label !== avoidLabel) : PROFILES;
  const pool = candidates.length > 0 ? candidates : PROFILES;
  const index = Math.floor(rand() * pool.length);
  return pool[Math.min(index, pool.length - 1)];
}

export function listFingerprintLabels(): string[] {
  return PROFILES.map((p) => p.label);
}
