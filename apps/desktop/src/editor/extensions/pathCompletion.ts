/**
 * Shared path-completion primitives.
 *
 * Extracted from FilePreviewSrcExtension so both the file-preview `src`
 * directive and the markdown image `![]()` syntax reuse the same directory
 * resolution, apply/close, and file-tree lookup logic.
 *
 * Supports vault-relative, `./` `../`, and `~/` (home-relative) paths.
 * `~/` paths are resolved asynchronously via Tauri fs APIs — the completion
 * source returns a Promise<CompletionResult> in that case.
 */

import { closeCompletion, type Completion } from '@codemirror/autocomplete';
import { Transaction, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useVaultStore } from '@/store/vaultStore';
import { flattenFileTree } from '@/utils/treeUtils';
import type { VaultEntry } from '@folyn/vault-provider';

/** Insert `insert` over [from, to) and CLOSE the dropdown. Deliberately NOT
 *  annotated as a user event — CodeMirror's default string-apply dispatches
 *  with userEvent "input.complete", which re-triggers completion after every
 *  pick and leaves the dropdown open on the just-inserted path. */
export function applyFileAndClose(insert: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    closeCompletion(view);
  };
}

/** Apply that keeps the dropdown open (for drilling into a directory). */
export function applyDirDrill(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const insert = name + '/';
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      annotations: Transaction.userEvent.of('input.type'),
    });
  };
}

/** True if the path is home-relative (`~/...`) or absolute (`/...`, `$HOME/...`). */
export function isHomeOrAbsolute(p: string): boolean {
  return p.startsWith('~') || p.startsWith('/') || p.startsWith('$HOME') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Resolve a `dirPart` (with trailing `/`) to a vault-relative directory path.
 * Returns 'EXTERNAL' sentinel for absolute/home-relative paths (handled by
 * the async branch in `buildPathCompletionAsync`).
 */
export function resolveDirPart(dirPart: string, filePath: string): string | null {
  if (isHomeOrAbsolute(dirPart)) return null;
  if (
    !dirPart.startsWith('./') && !dirPart.startsWith('.\\') &&
    !dirPart.startsWith('../') && !dirPart.startsWith('..\\')
  ) {
    return dirPart;
  }
  // Normalize backslashes to forward slashes so Windows paths (C:\Users\...)
  // split correctly. Vault-internal paths already use / on all platforms.
  const fileDir = filePath
    ? filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))).replace(/\\/g, '/')
    : '';
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
export function findDirChildren(tree: VaultEntry[], dirPath: string): VaultEntry[] | null {
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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'tiff', 'tif']);

/** True if `path` has an image extension. */
export function isImageFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
  return IMAGE_EXTS.has(ext);
}

/** Build Completion options from a list of vault entries (synchronous). */
function buildOptionsFromEntries(
  children: VaultEntry[],
  imagesOnly: boolean,
): Completion[] {
  return children
    .filter((c) => c.type === 'dir' || !imagesOnly || isImageFile(c.name))
    .map((c): Completion =>
      c.type === 'dir'
        ? { label: c.name + '/', apply: applyDirDrill(c.name), type: 'dir' as const }
        : { label: c.name, apply: applyFileAndClose(c.name), type: 'file' as const },
    );
}

/** Build Completion options from Tauri `readDir` DirEntry[] (async path). */
function buildOptionsFromDirEntries(
  entries: { name: string; isDirectory: boolean }[],
  imagesOnly: boolean,
): Completion[] {
  return entries
    .filter((e) => e.isDirectory || !imagesOnly || isImageFile(e.name))
    .map((e): Completion =>
      e.isDirectory
        ? { label: e.name + '/', apply: applyDirDrill(e.name), type: 'dir' as const }
        : { label: e.name, apply: applyFileAndClose(e.name), type: 'file' as const },
    );
}

export interface PathCompletionResult {
  from: number;
  to: number;
  options: Completion[];
  validFor: (text: string, from: number, to: number, state: EditorState) => boolean;
}

/**
 * Build a CompletionResult for a path partial, shared by file-preview src
 * and markdown image completions.
 *
 * - partial has no `/` → global search across all vault files (imagesOnly
 *   filters to image extensions). Full path as label so CodeMirror's built-in
 *   fuzzy matcher filters and ranks client-side.
 * - partial has `/` and is vault-relative → list immediate children from the
 *   vault file tree (synchronous).
 * - partial has `/` and starts with `~/` or is absolute → resolve via Tauri
 *   fs `readDir` (asynchronous). The returned Promise resolves to a result.
 */
export async function buildPathCompletion(
  partial: string,
  partialStart: number,
  pos: number,
  filePath: string,
  imagesOnly: boolean,
): Promise<PathCompletionResult | null> {
  const slashIdx = Math.max(partial.lastIndexOf('/'), partial.lastIndexOf('\\'));
  if (slashIdx === -1) {
    const fileTree = useVaultStore.getState().fileTree;
    const all = flattenFileTree(fileTree);
    const files = imagesOnly ? all.filter((f) => isImageFile(f.path)) : all;
    return {
      from: partialStart,
      to: pos,
      options: files.map((f) => ({
        label: f.path,
        apply: applyFileAndClose(f.path),
        type: 'file' as const,
      })),
      validFor: (text: string) => !/[/\\]/.test(text),
    };
  }

  const dirPart = partial.slice(0, slashIdx + 1);
  const filterStart = partialStart + slashIdx + 1;

  // Home-relative or absolute path: resolve via Tauri fs.
  if (isHomeOrAbsolute(dirPart)) {
    const absDir = await resolveHomeOrAbsolutePath(dirPart);
    if (absDir === null) return null;
    const entries = await readDirSafe(absDir);
    if (entries === null) return null;
    return {
      from: filterStart,
      to: pos,
      options: buildOptionsFromDirEntries(entries, imagesOnly),
      validFor: (_text, _from, to, state) => {
        const currentPartial = state.sliceDoc(partialStart, to);
        const newSlash = Math.max(currentPartial.lastIndexOf('/'), currentPartial.lastIndexOf('\\'));
        return currentPartial.slice(0, newSlash + 1) === dirPart;
      },
    };
  }

  // Vault-relative or ./ ../ path: synchronous from file tree.
  const dirPath = resolveDirPart(dirPart, filePath);
  if (dirPath === null) return null;

  const fileTree = useVaultStore.getState().fileTree;
  const children = findDirChildren(fileTree, dirPath);
  if (!children) return null;

  return {
    from: filterStart,
    to: pos,
    options: buildOptionsFromEntries(children, imagesOnly),
    validFor: (_text, _from, to, state) => {
      const currentPartial = state.sliceDoc(partialStart, to);
      const newSlash = Math.max(currentPartial.lastIndexOf('/'), currentPartial.lastIndexOf('\\'));
      return currentPartial.slice(0, newSlash + 1) === dirPart;
    },
  };
}

/** Resolve a `~/` or `$HOME/` or absolute dirPart to an absolute filesystem path.
 *  Always strips trailing slashes so the result is a clean directory path. */
async function resolveHomeOrAbsolutePath(dirPart: string): Promise<string | null> {
  let result: string;
  if (dirPart.startsWith('~/')) {
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/[/\\]+$/, '');
    result = await join(home, dirPart.slice(2));
  } else if (dirPart.startsWith('$HOME/')) {
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/[/\\]+$/, '');
    result = await join(home, dirPart.slice('$HOME/'.length));
  } else {
    // Absolute path: return as-is (trailing slash stripped below).
    result = dirPart;
  }
  return result.replace(/[/\\]+$/, '');
}

/** Read directory entries via Tauri fs. Returns null on error (dir not found,
 *  permission, etc.) so completion gracefully returns no results. */
async function readDirSafe(absDir: string): Promise<{ name: string; isDirectory: boolean }[] | null> {
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const { exists } = await import('@tauri-apps/plugin-fs');
    if (!(await exists(absDir))) return null;
    const entries = await readDir(absDir);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
  } catch {
    return null;
  }
}
