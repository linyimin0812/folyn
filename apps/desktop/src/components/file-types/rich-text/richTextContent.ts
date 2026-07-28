import type { JSONContent } from '@tiptap/react';

// ponytail: disk format = tiptap native JSON string. serialize/deserialize
// are identity on the string layer, but split out as pure functions so
// round-trip and the anti-loop predicate are unit-testable without a live
// prosemirror view (jsdom can't host one — see file-type-editors.md dbml
// ceiling). The empty-doc fallback keeps setContent from choking on blanks.

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Parse a raw disk string into a tiptap JSONContent doc. Returns undefined
 * for empty/invalid JSON so the caller (useEditor / setContent) can fall
 * back to the editor's default empty doc. Never throws.
 */
export function deserializeToContent(raw: string): JSONContent | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? (json as JSONContent) : undefined;
  } catch {
    return undefined;
  }
}

/** Empty-doc fallback used by the editor when deserialize yields undefined. */
export function emptyDoc(): JSONContent {
  return EMPTY_DOC;
}

/**
 * Serialize a tiptap JSONContent (or the editor's getJSON() output) to the
 * on-disk string form. Identity at the JSON layer.
 */
export function serializeToDisk(json: JSONContent): string {
  return JSON.stringify(json);
}

/**
 * JSON.stringify with keys sorted at every level. Lets the anti-loop
 * predicate compare two docs structurally regardless of key-ordering /
 * whitespace diffs (an AI's Write tool may emit keys in a different order
 * than tiptap's getJSON, which would otherwise false-trigger a reload and
 * clobber cursor + undo history on the user's own save flowing back).
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = (v as Record<string, unknown>)[key];
            return acc;
          }, {})
      : v,
  );
}

/**
 * Anti-loop predicate (drawio loadedXmlRef pattern, adapted to JSON).
 * Returns true only when `incomingContent` represents a genuinely different
 * document from what we last handed to the editor (tracked in
 * `loadedContentRef.current`). Normalizes both sides via stable-stringify
 * so whitespace / key-ordering diffs don't false-trigger an in-place reload
 * (which would clobber cursor + undo history on every user save flowing back
 * through updateTabContent).
 */
export function shouldApplyExternalContent(
  incomingContent: string,
  loadedContentRef: { current: string },
): boolean {
  if (incomingContent === loadedContentRef.current) return false;
  const incoming = deserializeToContent(incomingContent);
  const loaded = deserializeToContent(loadedContentRef.current);
  // Both blank → no real change; skip reload.
  if (incoming === undefined && loaded === undefined) return false;
  // One side blank, the other not → real change.
  if (incoming === undefined || loaded === undefined) return true;
  return stableStringify(incoming) !== stableStringify(loaded);
}
