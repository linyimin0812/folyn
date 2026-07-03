/**
 * toYaml — convert a parsed JS value to a YAML string.
 *
 * Lazy-loads the `yaml` library (also used by parseInput.ts) so the YAML
 * serializer is only pulled into the chunk when the user actually clicks
 * the YAML converter button.
 */
export async function toYaml(value: unknown): Promise<string> {
  const mod = await import('yaml');
  const stringify = mod.stringify;
  if (typeof stringify !== 'function') {
    throw new Error('yaml.stringify is not available');
  }
  // `nullStr: 'null'` makes nulls explicit; `lineWidth: 0` disables
  // line-wrapping for predictable output in a <pre>.
  return stringify(value, { nullStr: 'null', lineWidth: 0 }) ?? '';
}
