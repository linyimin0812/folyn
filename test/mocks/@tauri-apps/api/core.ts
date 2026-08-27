import { vi } from 'vitest';
import { __internals as fsInternals } from '../plugin-fs';

interface RawEntry {
  path: string;
  name: string;
  is_dir: boolean;
  children?: RawEntry[] | null;
}

function buildTree(
  absRoot: string,
  relPrefix: string,
  showHidden: boolean,
  exclude: string[],
): RawEntry[] {
  // Reuse the mock's in-memory readDir by calling it directly.
  const node = (fsInternals as unknown as {
    root: { type: string; children: Map<string, unknown> };
  }).root;
  const parts = absRoot.split('/').filter((s) => s !== '' && s !== '.');
  let cur: any = node;
  for (const part of parts) {
    if (!cur || cur.type !== 'dir') return [];
    cur = cur.children.get(part);
    if (!cur) return [];
  }
  if (!cur || cur.type !== 'dir') return [];
  const out: RawEntry[] = [];
  for (const [name, child] of cur.children.entries()) {
    if (!showHidden && name.startsWith('.')) continue;
    if (exclude.includes(name)) continue;
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    const isDir = (child as any).type === 'dir';
    out.push({
      path: rel,
      name,
      is_dir: isDir,
      children: isDir ? buildTree(`${absRoot}/${name}`, rel, showHidden, exclude) : null,
    });
  }
  // Match Rust's sort: by name (stable for tests).
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === 'scan_file_tree') {
    const root = (args?.root as string) ?? '';
    const showHidden = (args?.showHidden as boolean) ?? false;
    const exclude = (args?.exclude as string[]) ?? [];
    return buildTree(root, '', showHidden, exclude);
  }
  return undefined;
});

export const convertFileSrc = vi.fn((filePath: string) => `asset://localhost/${filePath}`);

export const __internals = {
  reset() {
    invoke.mockClear();
    convertFileSrc.mockClear();
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'scan_file_tree') {
        const root = (args?.root as string) ?? '';
        const showHidden = (args?.showHidden as boolean) ?? false;
        const exclude = (args?.exclude as string[]) ?? [];
        return buildTree(root, '', showHidden, exclude);
      }
      return undefined;
    });
    convertFileSrc.mockImplementation((filePath: string) => `asset://localhost/${filePath}`);
  },
};
