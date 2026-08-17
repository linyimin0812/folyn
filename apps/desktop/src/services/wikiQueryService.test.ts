import { describe, it, expect, beforeEach } from 'vitest';
import { buildQueryInstruction, saveToWiki } from './wikiQueryService';
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

describe('buildQueryInstruction', () => {
  it('embeds the wiki context and the user query', () => {
    const prompt = buildQueryInstruction('What is X?', 'CTX');
    expect(prompt).toContain('What is X?');
    expect(prompt).toContain('CTX');
    expect(prompt).toContain('请按 query action 契约输出');
  });

  it('uses the user query verbatim, including non-ASCII', () => {
    const prompt = buildQueryInstruction('什么是 React？', 'ctx');
    expect(prompt).toContain('什么是 React？');
  });

  it('contains the action keyword', () => {
    const prompt = buildQueryInstruction('q', 'c');
    expect(prompt).toContain('动作：query');
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

  it('A5: writes sourcePaths into frontmatter sources and relatedPages into related', async () => {
    const path = await saveToWiki('Synth', 'body', 'q', ['entities/react', 'concepts/hooks.md'], ['entities/redux']);
    const written = await readTextFile(`${WIKI_ROOT}/${path}`);
    expect(written).toContain('confidence: low');
    expect(written).toContain('"entities/react.md"');
    expect(written).toContain('"concepts/hooks.md"');
    expect(written).toContain('"entities/redux"');
  });
});
