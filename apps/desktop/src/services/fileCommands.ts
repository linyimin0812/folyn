/**
 * Build {@link Command}s for vault files on demand.
 *
 * File commands are NOT registered statically in the command registry — the
 * vault tree is live (watched + refreshed by `vaultStore`), so a static
 * snapshot would drift. Instead the palette store calls {@link buildFileCommands}
 * at `open()` / `setQuery()` time against the current `vaultStore.fileTree`.
 *
 * Scope: `.md` files (the note type Quill edits), mirroring the search panel's
 * `flattenMarkdownFiles` helper. The vault tree already excludes `__*__`
 * special dirs via `vaultStore.excludePatterns`, so no re-filtering here.
 *
 * A reference-keyed memo avoids re-flattening on every keystroke: the tree is
 * rebuilt (new array reference) only when the vault changes, so the cache is
 * invalidated exactly then and reused across keystrokes in between.
 */

import type { VaultEntry } from '@quill/vault-provider';
import * as editorIoService from '@/services/editorIoService';
import { flattenFileTree } from '@/utils/treeUtils';
import type { Command } from './commandRegistry';

export interface FlatFile {
  path: string;
  name: string;
}

/** Recursively flatten a `VaultEntry` tree to `.md` file paths, sorted by path. */
export function flattenMarkdownFiles(entries: VaultEntry[]): FlatFile[] {
  return flattenFileTree(entries)
    .filter((f) => f.name.endsWith('.md'))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

let cachedTree: VaultEntry[] | null = null;
let cachedCommands: Command[] = [];

/**
 * Build file commands for a vault tree, memoized by tree reference. Returns the
 * same array across calls until the tree reference changes.
 */
export function buildFileCommands(entries: VaultEntry[]): Command[] {
  if (entries === cachedTree) return cachedCommands;
  cachedTree = entries;
  cachedCommands = flattenMarkdownFiles(entries).map(({ path, name }) => ({
    id: `file:${path}`,
    title: name,
    category: 'file',
    keywords: path.split('/'),
    run: () => {
      void editorIoService.openFile(path, name);
    },
  }));
  return cachedCommands;
}

/** Test helper: clear the memo so a fresh tree is always reprocessed. */
export function resetFileCommandsCache(): void {
  cachedTree = null;
  cachedCommands = [];
}
