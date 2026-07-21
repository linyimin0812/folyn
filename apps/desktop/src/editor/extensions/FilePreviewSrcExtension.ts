import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { useVaultStore } from '@/store/vaultStore';
import { flattenFileTree } from '@/utils/treeUtils';
import type { VaultEntry } from '@quill/vault-provider';

/**
 * Factory: returns a completion source for the `src` attribute of
 * `:::file-preview{src="..."}` directives, closing over the current document's
 * `filePath` so `./` and `../` resolve relative to the document's directory.
 *
 * Behavior:
 * - partial has no `/` → substring filter across all vault files (legacy).
 * - partial has `/` → list immediate children of the resolved directory,
 *   filtered by the segment after the last `/`. Directories apply with a
 *   trailing `/` so the user can keep drilling.
 */
export function createFilePreviewSrcCompletion(filePath: string) {
  return function filePreviewSrcCompletion(ctx: CompletionContext): CompletionResult | null {
    const windowStart = Math.max(0, ctx.pos - 500);
    const textBefore = ctx.state.sliceDoc(windowStart, ctx.pos);
    const m = textBefore.match(/:::file-preview\b[^{]*\{[^}]*?src="([^"]*)$/);
    if (!m) return null;

    const partial = m[1];
    const partialStart = windowStart + (m.index ?? 0) + m[0].length - m[1].length;

    const slashIdx = Math.max(partial.lastIndexOf('/'), partial.lastIndexOf('\\'));
    if (slashIdx === -1) {
      // No `/` → legacy behavior: substring filter across all vault files.
      const fileTree = useVaultStore.getState().fileTree;
      const files = flattenFileTree(fileTree);
      const lower = partial.toLowerCase();
      const filtered = partial
        ? files.filter(
            (f) => f.path.toLowerCase().includes(lower) || f.name.toLowerCase().includes(lower),
          )
        : files;
      // ponytail: cap at 50 matches — vault can have thousands of files, the
      // dropdown is unusable past that. Replace with ranked/scored search
      // (fuzzy, recency) if/when the cap bites.
      const options = filtered.slice(0, 50).map((f) => {
        // ponytail: detail = parent dir only — full path ends with `name`, so
        // label+detail would show the filename twice per row.
        const lastSlash = f.path.lastIndexOf('/');
        return {
          label: f.name,
          detail: lastSlash === -1 ? '' : f.path.slice(0, lastSlash),
          apply: f.path,
          type: 'file' as const,
        };
      });
      // ponytail: invalidate the moment the partial grows a `/` — that
      // transitions to the directory-children branch below, which needs a
      // fresh query (different options, different `from`).
      return {
        from: partialStart,
        to: ctx.pos,
        options,
        validFor: (text: string) => !/[/\\]/.test(text),
      };
    }

    const dirPart = partial.slice(0, slashIdx + 1);
    const filenameFilter = partial.slice(slashIdx + 1);
    const dirPath = resolveDirPart(dirPart, filePath);
    if (dirPath === null) return null;

    const fileTree = useVaultStore.getState().fileTree;
    const children = findDirChildren(fileTree, dirPath);
    if (!children) return null;

    const lower = filenameFilter.toLowerCase();
    const filtered = lower
      ? children.filter((c) => c.name.toLowerCase().includes(lower))
      : children;
    // ponytail: cap at 50 matches — same reasoning as the no-`/` branch above.
    // ponytail: `from` is the position AFTER the last `/` in the partial, so
    // CodeMirror's fuzzy matcher uses just the filename filter as the pattern
    // (not the full `./<dir>/filter`), which actually matches the child-name
    // labels. `apply` is the bare child name so picking replaces only the
    // filter text and preserves the typed directory prefix (e.g. `./<dir>/`).
    const filterStart = partialStart + slashIdx + 1;
    const options = filtered.slice(0, 50).map((c) =>
      // ponytail: detail = resolved dir (same for every row) — full path would
      // repeat the filename from `label`.
      c.type === 'dir'
        ? { label: c.name + '/', detail: dirPath, apply: c.name + '/', type: 'dir' as const }
        : { label: c.name, detail: dirPath, apply: c.name, type: 'file' as const },
    );
    // ponytail: invalidate when the directory part of the partial changes
    // (drilling into a subdir must re-query). Filter-only typing within the
    // same dir keeps the result, so the popup doesn't flicker per keystroke.
    const validFor = (_text: string, _from: number, to: number, state: EditorState) => {
      const currentPartial = state.sliceDoc(partialStart, to);
      const newSlash = Math.max(currentPartial.lastIndexOf('/'), currentPartial.lastIndexOf('\\'));
      return currentPartial.slice(0, newSlash + 1) === dirPart;
    };
    return { from: filterStart, to: ctx.pos, options, validFor };
  };
}

/**
 * Resolve a `dirPart` (with trailing `/`) to a vault-relative directory path.
 * Returns null for absolute `/` or `~`-prefixed paths (no vault-inside-home
 * completion — matches the existing early-return).
 *
 * ponytail: segment-walk loop — handles N-level `../../`, replacing the old
 * single-level `../` slice. Bare paths (no `./` or `../` prefix) stay
 * vault-relative, matching the runtime resolver in FilePreviewPlugin.tsx.
 */
function resolveDirPart(dirPart: string, filePath: string): string | null {
  if (dirPart.startsWith('/') || dirPart.startsWith('~')) return null;
  // Bare path (no ./ ../ prefix) → vault-relative.
  if (
    !dirPart.startsWith('./') && !dirPart.startsWith('.\\') &&
    !dirPart.startsWith('../') && !dirPart.startsWith('..\\')
  ) {
    return dirPart;
  }
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const segments = fileDir.split('/').filter(Boolean);
  const parts = dirPart.replace(/\\/g, '/').split('/').filter((s) => s !== '.' && s !== '');
  for (const seg of parts) {
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/** Walk `tree` by `/`-separated segments to find the target directory's
 *  immediate children. Returns null if the directory is not found. */
function findDirChildren(tree: VaultEntry[], dirPath: string): VaultEntry[] | null {
  if (!dirPath) return tree;
  const segs = dirPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  let nodes: VaultEntry[] | undefined = tree;
  for (const seg of segs) {
    const found: VaultEntry | undefined = nodes?.find((n) => n.type === 'dir' && n.name === seg);
    if (!found) return null;
    nodes = found.children;
  }
  return nodes ?? null;
}
