/**
 * toXml — convert a parsed JS value to an XML string.
 *
 * Uses `fast-xml-parser`'s `XMLBuilder` (also used by parseInput.ts for
 * parsing). The attribute convention is the same as the parser's:
 *   - attributes live under keys prefixed with `@_`
 *   - text content lives under `#text` (the default text-node name)
 *
 * Arbitrary JSON → XML is convention-dependent. We pick the simplest rule
 * that produces a valid XML document for any object/array/primitive:
 *   - Objects: each key becomes a child element. `@_`-prefixed keys become
 *     attributes; `#text` becomes text content.
 *   - Arrays: each element is wrapped in the parent's singular key. The
 *     caller must pass `{ root: 'data' }` semantics by wrapping the value
 *     in a root object before calling this function (we do that here).
 *   - Primitives: wrapped in a `<root>` element with text content.
 */
export async function toXml(value: unknown): Promise<string> {
  const mod = await import('fast-xml-parser');
  const XMLBuilder = mod.XMLBuilder;
  if (typeof XMLBuilder !== 'function') {
    throw new Error('XMLBuilder is not available');
  }
  const builder = new XMLBuilder({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    format: true,
    // Emit `#text` for primitive leaves instead of inlining them; this
    // keeps mixed content readable.
    textNodeName: '#text',
    suppressEmptyNode: false,
  });

  // Wrap non-object values so the builder always has a root element.
  const wrapped =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { root: value }
      : { root: { '#text': value === null ? 'null' : String(value) } };
  return builder.build(wrapped) as string;
}
