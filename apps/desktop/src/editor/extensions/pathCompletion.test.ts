import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveDirPart,
  findDirChildren,
  isImageFile,
  isHomeOrAbsolute,
  applyFileAndClose,
  applyDirDrill,
  buildPathCompletion,
} from './pathCompletion';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@folyn/vault-provider';

const MOCK_HOME = 'C:\\Users\\testuser';
const MOCK_FS: Record<string, { name: string; isDirectory: boolean }[]> = {};

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(async (dir: string) => MOCK_FS[dir] ?? []),
  exists: vi.fn(async (dir: string) => dir in MOCK_FS),
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => MOCK_HOME),
  join: vi.fn(async (...parts: string[]) => parts.join('\\').replace(/\\/g, '/')),
  normalize: vi.fn(async (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/')),
}));

const TREE: VaultEntry[] = [
  {
    type: 'dir',
    name: 'docs',
    path: 'docs',
    children: [
      { type: 'file', name: 'a.md', path: 'docs/a.md' },
      {
        type: 'dir',
        name: 'sub',
        path: 'docs/sub',
        children: [
          { type: 'file', name: 'pic.png', path: 'docs/sub/pic.png' },
        ],
      },
    ],
  },
  { type: 'file', name: 'cover.jpg', path: 'cover.jpg' },
];

describe('pathCompletion', () => {
  beforeEach(() => {
    useVaultStore.setState({ fileTree: TREE });
  });

  describe('isHomeOrAbsolute', () => {
    it('detects Unix absolute paths', () => {
      expect(isHomeOrAbsolute('/Users/foo')).toBe(true);
    });
    it('detects home-relative paths', () => {
      expect(isHomeOrAbsolute('~/Pictures')).toBe(true);
      expect(isHomeOrAbsolute('$HOME/Pictures')).toBe(true);
    });
    it('detects Windows drive paths', () => {
      expect(isHomeOrAbsolute('C:\\Users\\foo')).toBe(true);
      expect(isHomeOrAbsolute('C:/Users/foo')).toBe(true);
      expect(isHomeOrAbsolute('D:\\pics')).toBe(true);
    });
    it('rejects vault-relative paths', () => {
      expect(isHomeOrAbsolute('docs/pic.png')).toBe(false);
      expect(isHomeOrAbsolute('./pic.png')).toBe(false);
    });
  });

  describe('isImageFile', () => {
    it('detects common image extensions', () => {
      expect(isImageFile('pic.png')).toBe(true);
      expect(isImageFile('photo.JPG')).toBe(true);
      expect(isImageFile('icon.svg')).toBe(true);
    });
    it('rejects non-image files', () => {
      expect(isImageFile('notes.md')).toBe(false);
      expect(isImageFile('data.json')).toBe(false);
    });
  });

  describe('resolveDirPart', () => {
    it('resolves ./ relative to file directory', () => {
      expect(resolveDirPart('./', 'docs/index.md')).toBe('docs');
    });
    it('resolves ../ relative to parent directory', () => {
      expect(resolveDirPart('../', 'docs/sub/index.md')).toBe('docs');
    });
    it('resolves ../../ for N levels', () => {
      expect(resolveDirPart('../../', 'a/b/c/index.md')).toBe('a');
    });
    it('resolves bare path as vault-relative (returns as-is with trailing slash)', () => {
      expect(resolveDirPart('docs/', 'index.md')).toBe('docs/');
    });
    it('returns null for absolute paths', () => {
      expect(resolveDirPart('/Users/foo/', 'index.md')).toBe(null);
    });
    it('returns null for home-relative paths', () => {
      expect(resolveDirPart('~/Pictures/', 'index.md')).toBe(null);
    });
    it('handles Windows-style backslash separators in filePath', () => {
      expect(resolveDirPart('./', 'docs\\sub\\index.md')).toBe('docs/sub');
    });
    it('handles Windows-style ../ with backslashes', () => {
      expect(resolveDirPart('..\\', 'docs\\sub\\index.md')).toBe('docs');
    });
  });

  describe('findDirChildren', () => {
    it('finds root children', () => {
      const children = findDirChildren(TREE, '');
      expect(children).not.toBeNull();
      expect(children!.length).toBe(2);
    });
    it('finds nested directory children', () => {
      const children = findDirChildren(TREE, 'docs/sub');
      expect(children).not.toBeNull();
      expect(children!.find((c) => c.name === 'pic.png')).toBeTruthy();
    });
    it('returns null for non-existent directory', () => {
      expect(findDirChildren(TREE, 'nonexistent')).toBeNull();
    });
  });

  describe('applyFileAndClose / applyDirDrill', () => {
    it('applyFileAndClose returns a function', () => {
      expect(typeof applyFileAndClose('path')).toBe('function');
    });
    it('applyDirDrill returns a function', () => {
      expect(typeof applyDirDrill('name')).toBe('function');
    });
  });

  describe('buildPathCompletion', () => {
    it('returns global results when no slash', async () => {
      const result = await buildPathCompletion('cov', 0, 3, 'index.md', false);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'cover.jpg')).toBe(true);
    });

    it('filters to images only when imagesOnly is true', async () => {
      const result = await buildPathCompletion('', 0, 0, 'index.md', true);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'cover.jpg')).toBe(true);
      expect(result!.options.some((o) => o.label === 'docs/a.md')).toBe(false);
    });

    it('lists directory children for vault-relative path', async () => {
      const result = await buildPathCompletion('docs/', 0, 5, 'index.md', false);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'a.md')).toBe(true);
      expect(result!.options.some((o) => o.label === 'sub/')).toBe(true);
    });

    it('lists image children only for imagesOnly', async () => {
      const result = await buildPathCompletion('docs/sub/', 0, 9, 'index.md', true);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'pic.png')).toBe(true);
    });

    it('resolves ./ relative to current file directory', async () => {
      const result = await buildPathCompletion('./', 0, 2, 'docs/sub/index.md', false);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'pic.png')).toBe(true);
    });

    it('resolves ../ to parent directory', async () => {
      const result = await buildPathCompletion('../', 0, 3, 'docs/sub/index.md', false);
      expect(result).not.toBeNull();
      expect(result!.options.some((o) => o.label === 'a.md')).toBe(true);
      expect(result!.options.some((o) => o.label === 'sub/')).toBe(true);
    });
  });
});
