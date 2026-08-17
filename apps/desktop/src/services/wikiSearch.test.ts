import { describe, it, expect, beforeEach } from 'vitest';
import { searchWiki, estimateTokens, truncateForContext } from './wikiSearch';
import { useVaultStore } from '@/store/vaultStore';
import { writeTextFile } from '@tauri-apps/plugin-fs';

const VAULT_BASE = '/mock/vault';
const WIKI_ROOT = `${VAULT_BASE}/__wiki__`;

function setVault(basePath: string) {
  useVaultStore.setState({
    currentVault: { id: 'v1', name: 'v1', basePath } as never,
    fileTree: [],
  });
}

describe('searchWiki', () => {
  beforeEach(() => setVault(VAULT_BASE));

  it('BM25 matches English keywords + Chinese bi-grams', async () => {
    await writeTextFile(`${WIKI_ROOT}/entities/react.md`, '---\ntitle: React\n---\n\nReact hooks patterns components.');
    await writeTextFile(`${WIKI_ROOT}/entities/vue.md`, '---\ntitle: Vue\n---\n\nVue composition API.');
    await writeTextFile(`${WIKI_ROOT}/concepts/组件.md`, '---\ntitle: 组件\n---\n\n组件化设计模式。');

    const hits = await searchWiki('react hooks', { expandGraph: false });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe('entities/react');

    const zhHits = await searchWiki('组件化', { expandGraph: false });
    expect(zhHits.some((h) => h.path === 'concepts/组件')).toBe(true);
  });

  it('returns empty when query has no tokens or no pages', async () => {
    await writeTextFile(`${WIKI_ROOT}/entities/x.md`, '---\ntitle: X\n---\n\nbody');
    expect(await searchWiki('the a an', { expandGraph: false })).toEqual([]);
  });
});

describe('estimateTokens / truncateForContext', () => {
  it('estimates char/3.5 and caps at 4000 chars', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('aaaa')).toBe(2);
    const long = 'x'.repeat(5000);
    const out = truncateForContext(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('截断');
  });
});
