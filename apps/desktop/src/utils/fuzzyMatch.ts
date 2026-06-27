/**
 * Built-in subsequence fuzzy scorer.
 *
 * Matches `query` as a case-insensitive subsequence of `target`. Returns the
 * match indices (into the original `target` string) plus a score, or `null`
 * when `query` is not a subsequence of `target`.
 *
 * Scoring bonuses (higher is better):
 *   - Contiguous match (current index == previous match + 1): +8
 *   - Word-boundary match (start of target, or previous char is a separator
 *     `/`, `_`, `-`, space): +6
 *   - Plain match: +1 (base)
 * Earlier matches score higher via a small position penalty so that, all else
 * equal, a match near the start of the target outranks one further in.
 *
 * Empty query returns `{ score: 0, matches: [] }` — the caller treats empty as
 * "no filter" rather than as a match against everything.
 */

const SEPARATORS = new Set(['/', '_', '-', ' ', '.', '\t', '\n']);

export interface FuzzyMatchResult {
  score: number;
  /** Indices into the original `target` string that matched the query. */
  matches: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  if (query.length === 0) return { score: 0, matches: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Fast path: query longer than target cannot be a subsequence.
  if (q.length > t.length) return null;

  const matches: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === qc) {
        found = ti;
        ti++; // consume, advance past matched index for next char
        break;
      }
    }
    if (found === -1) return null;
    matches.push(found);
  }

  // Score the matched positions.
  let score = 0;
  let prevIdx = -2;
  for (const idx of matches) {
    let charScore = 1; // base plain match
    const isBoundary = idx === 0 || SEPARATORS.has(t[idx - 1]);
    const isContiguous = idx === prevIdx + 1;
    if (isBoundary) charScore += 6;
    if (isContiguous) charScore += 8;
    // Earlier matches score higher: small penalty proportional to position.
    charScore -= idx * 0.1;
    score += charScore;
    prevIdx = idx;
  }

  // Prefer shorter targets (tighter match) when query length is identical.
  score -= (t.length - q.length) * 0.01;

  return { score, matches };
}
