import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vaultStore：内存 manager（源资料路由）+ 可变 activeVaultId（切换 guard 用）。
const state = vi.hoisted(() => ({ vaultId: 'vault-a' }));
const manager = vi.hoisted(() => ({ files: {} as Record<string, string>, reads: [] as string[] }));
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      activeVaultId: state.vaultId,
      isLoading: false,
      manager: {
        readFile: async (p: string) => {
          manager.reads.push(p);
          if (!(p in manager.files)) throw new Error(`ENOENT: ${p}`);
          return manager.files[p]!;
        },
        writeFile: async (p: string, c: string) => { manager.files[p] = c; },
        rename: async (o: string, n: string) => { manager.files[n] = manager.files[o]!; delete manager.files[o]; },
      },
    }),
  },
}));

import { kbWriteAtomic, setKbGenStoreForTests, vaultKbFs, type KbGenStore } from './kbFs';
import { kbManifestPath, kbSourceSnapshotPath } from './kbPaths';

// 生成物后端 fake：绝对路径内存表，记录 mkdir 过的父目录。
const gen = vi.hoisted(() => ({ files: {} as Record<string, string>, madeDirs: [] as string[] }));
const fakeGen: KbGenStore = {
  resolveBase: async (vaultId) => `/fixtures/folyn/vaults/${vaultId}`,
  readFile: async (abs) => {
    if (!(abs in gen.files)) throw new Error(`ENOENT: ${abs}`);
    return gen.files[abs]!;
  },
  writeFile: async (abs, content) => {
    gen.files[abs] = content;
    gen.madeDirs.push(abs.slice(0, abs.lastIndexOf('/')));
  },
  exists: async (abs) => abs in gen.files,
  rename: async (o, n) => { gen.files[n] = gen.files[o]!; delete gen.files[o]; },
};

beforeEach(() => {
  gen.files = {};
  gen.madeDirs = [];
  manager.files = {};
  manager.reads = [];
  state.vaultId = 'vault-a';
  setKbGenStoreForTests(fakeGen);
});
afterEach(() => setKbGenStoreForTests(null));

describe('vaultKbFs 双路由（ADR-0011）', () => {
  it('__kb__ 生成物 → ~/.folyn/vaults/<vaultId>/ 绝对路径；源资料 → manager', async () => {
    const fs = vaultKbFs('vault-a');
    await fs.writeFile(kbManifestPath(), '{"goal":"g"}');
    await fs.writeFile('notes/a.md', '# note');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__/manifest.json']).toBe('{"goal":"g"}');
    expect(manager.files['notes/a.md']).toBe('# note');
    expect(Object.keys(gen.files)).toHaveLength(1);

    expect(await fs.readFile(kbManifestPath())).toBe('{"goal":"g"}');
    expect(manager.reads).toEqual([]);
    expect(await fs.readFile('notes/a.md')).toBe('# note');
    expect(manager.reads).toEqual(['notes/a.md']);
  });

  it('恰好等于 `__kb__` 目录名也走生成物路由；快照等深层路径同根', async () => {
    const fs = vaultKbFs('vault-a');
    await fs.writeFile('__kb__', 'x');
    const snap = kbSourceSnapshotPath('src-1', 'h1', '__kb__/themes/t1');
    await fs.writeFile(snap, 'snapshot');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__/themes/t1/sources/src-1/h1.md']).toBe('snapshot');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__']).toBe('x');
  });

  it('exists：生成物走 gen.exists，源资料用 manager 读探测', async () => {
    const fs = vaultKbFs('vault-a');
    gen.files['/fixtures/folyn/vaults/vault-a/__kb__/manifest.json'] = '{}';
    manager.files['notes/a.md'] = 'x';
    expect(await fs.exists(kbManifestPath())).toBe(true);
    expect(await fs.exists('__kb__/missing.json')).toBe(false);
    expect(await fs.exists('notes/a.md')).toBe(true);
    expect(await fs.exists('notes/gone.md')).toBe(false);
  });

  it('按 vaultId 隔离：不同 vault 的生成物落在不同根下', async () => {
    const a = vaultKbFs('vault-a');
    await a.writeFile(kbManifestPath(), 'A');
    state.vaultId = 'vault-b';
    const b = vaultKbFs('vault-b');
    await b.writeFile(kbManifestPath(), 'B');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__/manifest.json']).toBe('A');
    expect(gen.files['/fixtures/folyn/vaults/vault-b/__kb__/manifest.json']).toBe('B');
  });

  it('vault 切换 guard 对两条路由一致：不读不写另一 vault 的数据', async () => {
    const fs = vaultKbFs('vault-a');
    state.vaultId = 'vault-b';
    // readFile/writeFile/rename 同步抛出（原适配器语义）；exists 异步拒绝。
    expect(() => fs.writeFile(kbManifestPath(), 'wrong')).toThrow(/Vault/);
    expect(() => fs.writeFile('notes/a.md', 'wrong')).toThrow(/Vault/);
    expect(() => fs.readFile(kbManifestPath())).toThrow(/Vault/);
    expect(() => fs.rename('__kb__/a.md', '__kb__/b.md')).toThrow(/Vault/);
    await expect(fs.exists(kbManifestPath())).rejects.toThrow(/Vault/);
    expect(Object.keys(gen.files)).toHaveLength(0);
    expect(Object.keys(manager.files)).toHaveLength(0);
  });

  it('absPath：生成物 → 绝对路径；源资料 → null（仍按 vault 相对路径打开）', async () => {
    const fs = vaultKbFs('vault-a');
    expect(await fs.absPath?.('__kb__/themes/t1/topics/tp-1.md')).toBe('/fixtures/folyn/vaults/vault-a/__kb__/themes/t1/topics/tp-1.md');
    expect(await fs.absPath?.('notes/a.md')).toBeNull();
  });

  it('kbWriteAtomic：生成物的 tmp+rename 全程在生成物路由内完成', async () => {
    const fs = vaultKbFs('vault-a');
    await kbWriteAtomic(fs, kbManifestPath(), '{}');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__/manifest.json']).toBe('{}');
    expect(gen.files['/fixtures/folyn/vaults/vault-a/__kb__/manifest.json.tmp']).toBeUndefined();
    expect(Object.keys(manager.files)).toHaveLength(0);
  });

  it('跨路由 rename（生成物 ↔ 源资料）被显式拒绝', async () => {
    const fs = vaultKbFs('vault-a');
    expect(() => fs.rename('__kb__/a.md', 'notes/a.md')).toThrow(/跨存储路由/);
    expect(() => fs.rename('notes/a.md', '__kb__/a.md')).toThrow(/跨存储路由/);
  });
});
