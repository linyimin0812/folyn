/**
 * Recursively sort object keys alphabetically.
 *
 * - Plain objects: returns a new object whose keys are sorted alphabetically
 *   (stable, case-sensitive lexicographic comparison via `<`/`>`).
 * - Arrays: order preserved; each element is recursively sorted.
 * - Primitives, `null`, dates, regexes, etc.: returned as-is.
 *
 * Hand-rolled (no dep) per PR2 spec.
 */
export function sortKeysDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as unknown as T;
  }

  // Guard against Date / RegExp / other class instances — treat as primitives.
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sortedKeys = Object.keys(source).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = sortKeysDeep(source[key]);
  }
  return result as unknown as T;
}
