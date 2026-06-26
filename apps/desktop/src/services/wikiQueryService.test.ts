import { describe, it, expect, beforeEach } from 'vitest';
import { buildQueryPrompt, saveToWiki, buildWikiContext } from './wikiQueryService';
import { useVaultStore } from '@/store/vaultStore';
import { readTextFile } from '@tauri-apps/plugin-fs';

const VAULT_BASE = '/mock/vault';
const WIKI_ROOT = `${VAULT_BASE}/__wiki__`;

function setVault(basePath: string) {
  useVaultStore.setState({
    currentVault: { id: 'v1', name: 'v1', basePath } as never,
    fileTree: [],
  });
}

describe('buildQueryPrompt', () => {
  it('embeds the wiki context and the user query', () => {
    const prompt = buildQueryPrompt('What is X?', 'CTX');
    expect(prompt).toContain('What is X?');
    expect(prompt).toContain('CTX');
    expect(prompt).toContain('[[wiki://path]]');
  });

  it('uses the user query verbatim, including non-ASCII', () => {
    const prompt = buildQueryPrompt('什么是 React？', 'ctx');
    expect(prompt).toContain('什么是 React？');
  });
});

describe('saveToWiki', () => {
  beforeEach(() => {
    setVault(VAULT_BASE);
  });

  it('writes a synthesis page under syntheses/<kebab>.md with frontmatter', async () => {
    const path = await saveToWiki('React Hooks 指南', 'Body content', 'How do hooks work?');
    expect(path).toBe('syntheses/react-hooks-指南.md');
    const written = await readTextFile(`${WIKI_ROOT}/${path}`);
    expect(written).toContain('title: "React Hooks 指南"');
    expect(written).toContain('type: synthesis');
    expect(written).toContain('# React Hooks 指南');
    expect(written).toContain('How do hooks work?');
    expect(written).toContain('Body content');
  });

  it('kebabizes titles, dropping leading/trailing dashes', async () => {
    const path = await saveToWiki('-- Spaced Out --', 'x', 'q');
    expect(path).toBe('syntheses/spaced-out.md');
  });

  it('uses today ISO date in created/updated', async () => {
    const path = await saveToWiki('Today Test', 'x', 'q');
    const written = await readTextFile(`${WIKI_ROOT}/${path}`);
    const today = new Date().toISOString().split('T')[0];
    expect(written).toContain(`created: ${today}`);
    expect(written).toContain(`updated: ${today}`);
  });
});

describe('buildWikiContext', () => {
  beforeEach(() => {
    setVault(VAULT_BASE);
  });

  it('returns "no matching pages" when wiki has no index/overview/purpose', async () => {
    const ctx = await buildWikiContext('anything');
    expect(ctx).toContain('Wiki Overview');
    expect(ctx).toContain('Wiki Purpose');
    expect(ctx).toContain('_No matching pages found._');
  });

  it('matches index entries by keyword and embeds their page content', async () => {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(
      `${WIKI_ROOT}/index.md`,
      'Index:\n- [[wiki://entities/react.md]] React hooks and patterns\n',
    );
    await writeTextFile(
      `${WIKI_ROOT}/entities/react.md`,
      '---\ntitle: React\n---\n\nReact is a UI library.',
    );
    await writeTextFile(`${WIKI_ROOT}/overview.md`, 'Overview text');
    await writeTextFile(`${WIKI_ROOT}/purpose.md`, 'Purpose text');

    const ctx = await buildWikiContext('react hooks');
    expect(ctx).toContain('Overview text');
    expect(ctx).toContain('Purpose text');
    expect(ctx).toContain('wiki://entities/react.md');
    expect(ctx).toContain('React is a UI library.');
    expect(ctx).toContain('Relevant Wiki Pages (1 matched)');
  });

  it('caps matched pages at 10', async () => {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const lines: string[] = ['Index:'];
    for (let i = 0; i < 15; i++) {
      lines.push(`- [[wiki://entities/p${i}.md]] page ${i} keyword`);
      await writeTextFile(`${WIKI_ROOT}/entities/p${i}.md`, `body ${i}`);
    }
    await writeTextFile(`${WIKI_ROOT}/index.md`, lines.join('\n'));
    await writeTextFile(`${WIKI_ROOT}/overview.md`, 'ov');
    await writeTextFile(`${WIKI_ROOT}/purpose.md`, 'pu');

    const ctx = await buildWikiContext('keyword');
    expect(ctx).toContain('(10 matched)');
  });
});
