/**
 * toEscaped — produce a single-line JSON string literal.
 *
 * `JSON.stringify(value)` with no `replacer`/`space` returns the minimal
 * single-line form. The result is the "escaped" format that parseInput.ts
 * recognizes as the `escaped` input mode — useful for round-tripping
 * through paste.
 */
export function toEscaped(value: unknown): string {
  return JSON.stringify(value);
}
