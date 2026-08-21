import type { VaultEntry } from '@quill/vault-provider';

export function flattenTree(entries: VaultEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.path);
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenTree(entry.children));
    }
  }
  return result;
}

/** Insert a new entry under its parent dir (or at root). Returns a new tree
 * if the parent was found; returns the input reference unchanged if not, so
 * the caller can skip the optimistic update and let a background refresh
 * reconcile. No mutation. */
export function insertEntry(tree: VaultEntry[], path: string, type: 'file' | 'dir'): VaultEntry[] {
  const segments = path.split('/');
  const name = segments[segments.length - 1];
  const newEntry: VaultEntry = { path, name, type };
  if (segments.length === 1) return [...tree, newEntry];

  const parentPath = segments.slice(0, -1).join('/');
  let inserted = false;
  const walk = (entries: VaultEntry[]): VaultEntry[] =>
    entries.map((e) => {
      if (e.path === parentPath && e.type === 'dir') {
        inserted = true;
        return { ...e, children: [...(e.children ?? []), newEntry] };
      }
      if (e.children) return { ...e, children: walk(e.children) };
      return e;
    });
  const result = walk(tree);
  return inserted ? result : tree;
}

export function flattenFileTree(entries: VaultEntry[]): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenFileTree(entry.children));
    }
  }
  return result;
}

/** Recursively collect all file entries matching a given extension (e.g. '.md'). */
export function flattenFilesByExt(entries: VaultEntry[], ext: string): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith(ext)) {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenFilesByExt(entry.children, ext));
    }
  }
  return result;
}

export function collectAllDirPaths(entries: VaultEntry[]): string[] {
  const paths: string[] = [];
  const walk = (items: VaultEntry[]) => {
    for (const item of items) {
      if (item.type === 'dir') {
        paths.push(item.path);
        if (item.children) walk(item.children);
      }
    }
  };
  walk(entries);
  return paths;
}

export function matchesSearch(entry: VaultEntry, query: string): boolean {
  if (entry.name.toLowerCase().includes(query)) return true;
  if (entry.type === 'dir' && entry.children) {
    return entry.children.some((child) => matchesSearch(child, query));
  }
  return false;
}
