import type { VaultEntry } from '@folyn/vault-provider';

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

/** Remove the entry at `path` from the tree. Returns a new tree if found,
 * otherwise the input reference unchanged. No mutation. */
export function removeEntry(tree: VaultEntry[], path: string): VaultEntry[] {
  let removed = false;
  const walk = (entries: VaultEntry[]): VaultEntry[] => {
    const filtered = entries.filter((e) => {
      if (e.path === path) {
        removed = true;
        return false;
      }
      return true;
    });
    return filtered.map((e) => {
      if (e.children) return { ...e, children: walk(e.children) };
      return e;
    });
  };
  const result = walk(tree);
  return removed ? result : tree;
}

/** Move an entry from oldPath to newPath, preserving type and children.
 * For directory renames, child paths are rewritten to the new prefix.
 * Returns a new tree if the entry was found, otherwise the input reference. */
export function renameEntry(tree: VaultEntry[], oldPath: string, newPath: string): VaultEntry[] {
  let found = false;
  let carried: VaultEntry | null = null;

  const pluck = (entries: VaultEntry[]): VaultEntry[] => {
    const out: VaultEntry[] = [];
    for (const e of entries) {
      if (e.path === oldPath) {
        found = true;
        carried = e;
        continue;
      }
      if (e.children) out.push({ ...e, children: pluck(e.children) });
      else out.push(e);
    }
    return out;
  };

  const plucked = pluck(tree);
  if (!found || !carried) return tree;

  const newPathSegs = newPath.split('/');
  const newName = newPathSegs[newPathSegs.length - 1];

  const rebase = (entry: VaultEntry, fromPrefix: string, toPrefix: string): VaultEntry => {
    const rebased: VaultEntry = {
      ...entry,
      path: entry.path === fromPrefix ? toPrefix : toPrefix + entry.path.slice(fromPrefix.length),
      name: entry.path === fromPrefix ? newName : entry.name,
    };
    if (entry.children) {
      rebased.children = entry.children.map((c) => rebase(c, fromPrefix, toPrefix));
    }
    return rebased;
  };
  const rebasedCarried = rebase(carried, oldPath, newPath);

  if (newPathSegs.length === 1) {
    return [...plucked, rebasedCarried];
  }

  const parentPath = newPathSegs.slice(0, -1).join('/');
  let inserted = false;
  const place = (entries: VaultEntry[]): VaultEntry[] =>
    entries.map((e) => {
      if (e.path === parentPath && e.type === 'dir') {
        inserted = true;
        return { ...e, children: [...(e.children ?? []), rebasedCarried] };
      }
      if (e.children) return { ...e, children: place(e.children) };
      return e;
    });
  const result = place(plucked);
  return inserted ? result : [...plucked, rebasedCarried];
}

/** Clone the subtree at `srcPath` into `destPath`, rebasing all child
 * paths onto the new prefix. Returns a new tree if the source was found,
 * otherwise the input reference. No mutation. */
export function copyEntry(tree: VaultEntry[], srcPath: string, destPath: string): VaultEntry[] {
  let source: VaultEntry | null = null;
  const find = (entries: VaultEntry[]) => {
    for (const e of entries) {
      if (e.path === srcPath) {
        source = e;
        return;
      }
      if (e.children) find(e.children);
    }
  };
  find(tree);
  if (!source) return tree;

  const destSegs = destPath.split('/');
  const destName = destSegs[destSegs.length - 1];

  const clone = (entry: VaultEntry, fromPrefix: string, toPrefix: string): VaultEntry => {
    const rebased: VaultEntry = {
      ...entry,
      path: entry.path === fromPrefix ? toPrefix : toPrefix + entry.path.slice(fromPrefix.length),
      name: entry.path === fromPrefix ? destName : entry.name,
    };
    if (entry.children) {
      rebased.children = entry.children.map((c) => clone(c, fromPrefix, toPrefix));
    }
    return rebased;
  };
  const cloned = clone(source, srcPath, destPath);

  if (destSegs.length === 1) return [...tree, cloned];

  const parentPath = destSegs.slice(0, -1).join('/');
  let inserted = false;
  const walk = (entries: VaultEntry[]): VaultEntry[] =>
    entries.map((e) => {
      if (e.path === parentPath && e.type === 'dir') {
        inserted = true;
        return { ...e, children: [...(e.children ?? []), cloned] };
      }
      if (e.children) return { ...e, children: walk(e.children) };
      return e;
    });
  const result = walk(tree);
  return inserted ? result : [...tree, cloned];
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
