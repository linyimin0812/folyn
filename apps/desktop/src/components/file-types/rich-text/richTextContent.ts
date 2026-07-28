import type { JSONContent } from '@tiptap/react';
import { isExternalPath } from '@/utils/isExternalPath';

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

/**
 * True if `src` carries a URL scheme that loads directly in an `<img>` — no
 * `convertFileSrc` translation. Used by the Image NodeView to decide whether
 * to pass `src` through (http/https/data/asset/tauri/blob) or resolve it
 * against the vault root and feed the absolute path to `convertFileSrc`
 * (vault-relative `assets/...` and absolute filesystem paths). Mirrors the
 * `src.startsWith('http') || src.startsWith('data:')` short-circuit in
 * MarkdownPreview's `VaultImage`. Pure so it's unit-testable.
 */
export function isLoadableUrlScheme(src: string): boolean {
  return (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('asset:') ||
    src.startsWith('tauri:') ||
    src.startsWith('blob:')
  );
}

/**
 * Resolve an Image node `src` (persisted vault-relative, e.g.
 * `assets/images/<hash>.png`) to an on-disk absolute path, so the editor can
 * feed it to `convertFileSrc(...)` → a loadable `asset://` URL (the same
 * mechanism MarkdownPreview uses for `![](pic.png)` — see MarkdownPreview's
 * `VaultImage` + `convertFileSrc`).
 *
 * `resolvedVaultRoot` MUST already be resolved (no `~`/`$HOME` — the caller
 * runs it through `resolveBasePath` first, mirroring MarkdownPreview). Pure +
 * synchronous so it's unit-testable without Tauri / jsdom ceilings.
 *
 * - Already-absolute / `~` / `$HOME` / `http(s)://` / `data:` / `asset:` /
 *   `blob:` srcs pass through unchanged (external image links and data URLs
 *   are stored verbatim, not vault-written).
 * - `./` prefix is stripped before joining (markdown-style relative refs).
 * - Empty src → empty string (the NodeView renders its placeholder).
 */
export function resolveVaultRelativePath(
  src: string,
  resolvedVaultRoot: string,
): string {
  if (!src) return '';
  if (isExternalPath(src)) return src;
  if (isLoadableUrlScheme(src)) return src;
  if (!resolvedVaultRoot) return src; // ponytail: can't resolve without root; show raw src (won't load, but no crash). Upgrade: surface a broken-image state.
  const base = resolvedVaultRoot.replace(/\/+$/, '');
  return `${base}/${src.replace(/^\.\//, '').replace(/^\/+/, '')}`;
}
