import { vi } from 'vitest';

type NodeType = 'file' | 'dir';
interface FsNode {
  type: NodeType;
  content: Uint8Array;
  children: Map<string, FsNode>;
}

function createNode(type: NodeType): FsNode {
  return { type, content: new Uint8Array(), children: new Map() };
}

function splitPath(p: string): string[] {
  return p.split('/').filter((s) => s !== '' && s !== '.');
}

function getNode(root: FsNode, p: string): FsNode | undefined {
  const parts = splitPath(p);
  let cur: FsNode = root;
  for (const part of parts) {
    if (cur.type !== 'dir') return undefined;
    const next = cur.children.get(part);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

function ensureDir(root: FsNode, p: string): FsNode {
  const parts = splitPath(p);
  let cur: FsNode = root;
  for (const part of parts) {
    let next = cur.children.get(part);
    if (!next) {
      next = createNode('dir');
      cur.children.set(part, next);
    } else if (next.type !== 'dir') {
      throw new Error(`Path is not a directory: ${p}`);
    }
    cur = next;
  }
  return cur;
}

function ensureParent(root: FsNode, p: string): FsNode {
  const parts = splitPath(p);
  parts.pop();
  return ensureDir(root, '/' + parts.join('/'));
}

function lastName(p: string): string {
  const parts = splitPath(p);
  return parts[parts.length - 1];
}

const root = createNode('dir');

export const readTextFile = vi.fn(async (p: string) => {
  const node = getNode(root, p);
  if (!node || node.type !== 'file') throw new Error(`File not found: ${p}`);
  return new TextDecoder().decode(node.content);
});

export const readFile = vi.fn(async (p: string) => {
  const node = getNode(root, p);
  if (!node || node.type !== 'file') throw new Error(`File not found: ${p}`);
  return node.content;
});

export const writeTextFile = vi.fn(async (p: string, content: string) => {
  const parent = ensureParent(root, p);
  const name = lastName(p);
  let node = parent.children.get(name);
  if (!node) {
    node = createNode('file');
    parent.children.set(name, node);
  }
  node.content = new TextEncoder().encode(content);
});

export const writeFile = vi.fn(async (p: string, data: Uint8Array | string) => {
  const parent = ensureParent(root, p);
  const name = lastName(p);
  let node = parent.children.get(name);
  if (!node) {
    node = createNode('file');
    parent.children.set(name, node);
  }
  node.content =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
});

export const mkdir = vi.fn(async (p: string) => {
  ensureDir(root, p);
});

export const exists = vi.fn(async (p: string) => getNode(root, p) !== undefined);

export const remove = vi.fn(async (p: string) => {
  const parts = splitPath(p);
  const name = parts.pop();
  if (!name) return;
  const parent = getNode(root, '/' + parts.join('/'));
  if (!parent || parent.type !== 'dir' || !parent.children.has(name)) {
    throw new Error(`File not found: ${p}`);
  }
  parent.children.delete(name);
});

export const readDir = vi.fn(async (p: string) => {
  const node = getNode(root, p);
  if (!node || node.type !== 'dir') return [];
  return Array.from(node.children.entries()).map(([name, child]) => ({
    name,
    isDirectory: child.type === 'dir',
    isFile: child.type === 'file',
  }));
});

export const stat = vi.fn(async (p: string) => {
  const node = getNode(root, p);
  if (!node) throw new Error(`Not found: ${p}`);
  return {
    size: node.content.length,
    isFile: node.type === 'file',
    isDirectory: node.type === 'dir',
    mtime: 0,
    ctime: 0,
    atime: 0,
  };
});

export const rename = vi.fn(async (oldPath: string, newPath: string) => {
  const oldParts = splitPath(oldPath);
  const oldName = oldParts.pop()!;
  const oldParent = getNode(root, '/' + oldParts.join('/'));
  if (!oldParent || oldParent.type !== 'dir') throw new Error(`Not found: ${oldPath}`);
  const node = oldParent.children.get(oldName);
  if (!node) throw new Error(`Not found: ${oldPath}`);
  oldParent.children.delete(oldName);
  const newParent = ensureParent(root, newPath);
  newParent.children.set(lastName(newPath), node);
});

export const watch = vi.fn(async () => () => {});

export const __internals = {
  root,
  reset() {
    root.children.clear();
    for (const fn of [
      readTextFile,
      readFile,
      writeTextFile,
      writeFile,
      mkdir,
      exists,
      remove,
      readDir,
      stat,
      rename,
      watch,
    ]) {
      fn.mockClear();
    }
  },
};
