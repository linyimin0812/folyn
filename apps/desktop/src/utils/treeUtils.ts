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
