import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
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
      const options = filtered.slice(0, 50).map((f) => ({
        label: f.name,
        detail: f.path,
        apply: f.path,
        type: 'file' as const,
      }));
      return { from: partialStart, to: ctx.pos, options, validFor: /[^"\s{}=]*/ };
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
    const options = filtered.slice(0, 50).map((c) =>
      c.type === 'dir'
        ? { label: c.name + '/', detail: c.path, apply: c.path + '/', type: 'dir' as const }
        : { label: c.name, detail: c.path, apply: c.path, type: 'file' as const },
    );

    return { from: partialStart, to: ctx.pos, options, validFor: /[^"\s{}=]*/ };
  };
}

/**
 * Resolve a `dirPart` (with trailing `/`) to a vault-relative directory path.
 * Returns null for outside-vault paths (absolute `/` or `~`-prefixed).
 *
 * ponytail: single-level `../` only — nested parents need a loop if needed.
 * Matches the same limit in FilePreviewPlugin.tsx:resolveVaultPath.
 */
function resolveDirPart(dirPart: string, filePath: string): string | null {
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  if (dirPart.startsWith('./') || dirPart.startsWith('.\\')) {
    const raw = dirPart.slice(2);
    return fileDir ? `${fileDir}/${raw}` : raw;
  }
  if (dirPart.startsWith('../') || dirPart.startsWith('..\\')) {
    const raw = dirPart.slice(3);
    const parentDir = fileDir ? fileDir.substring(0, fileDir.lastIndexOf('/')) : '';
    return parentDir ? `${parentDir}/${raw}` : raw;
  }
  if (dirPart.startsWith('/') || dirPart.startsWith('~')) {
    return null;
  }
  return dirPart;
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
