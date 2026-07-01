// wiki feature agent canonical 文件契约单测。
// 验证 `apps/desktop/src/wiki/.claude/agents/wiki.md` 与 `CLAUDE.md` 承载
// ingest / generate / lint / query 四 action 的输出契约。

import { describe, it, expect } from 'vitest';
import wikiAgentDoc from './.claude/agents/wiki.md?raw';
import wikiClaudeDoc from './.claude/CLAUDE.md?raw';

describe('canonical wiki.md agent 契约', () => {
  it('front-matter name 为 wiki', () => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(wikiAgentDoc);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/^name:\s*wiki/m);
  });

  it('包含 ingest action 的 JSON 输出契约', () => {
    expect(wikiAgentDoc).toContain('action: ingest');
    expect(wikiAgentDoc).toContain('"entities"');
    expect(wikiAgentDoc).toContain('"concepts"');
    expect(wikiAgentDoc).toContain('"connections"');
    expect(wikiAgentDoc).toContain('"contradictions"');
    expect(wikiAgentDoc).toContain('"structureRecommendations"');
  });

  it('包含 generate action 的直写 wiki 页面契约', () => {
    expect(wikiAgentDoc).toContain('action: generate');
    expect(wikiAgentDoc).toMatch(/entities\/|concepts\/|sources\//);
    expect(wikiAgentDoc).toMatch(/\[\[wiki:\/\//);
    expect(wikiAgentDoc).toMatch(/index\.md|log\.md|overview\.md/);
  });

  it('包含 lint action 的 ReviewItem[] JSON 输出契约', () => {
    expect(wikiAgentDoc).toContain('action: lint');
    expect(wikiAgentDoc).toContain('structure_change');
    expect(wikiAgentDoc).toContain('stale_content');
    expect(wikiAgentDoc).toContain('affectedPages');
    expect(wikiAgentDoc).toContain('suggestedActions');
  });

  it('包含 query action 的 Markdown + [[wiki://path]] 引用契约', () => {
    expect(wikiAgentDoc).toContain('action: query');
    expect(wikiAgentDoc).toMatch(/\[\[wiki:\/\/path\]\]/);
    expect(wikiAgentDoc).toMatch(/Markdown/);
  });

  it('通用规则：不改 __wiki__/ 以外文件，不回显契约', () => {
    expect(wikiAgentDoc).toMatch(/不要修改 vault 内 .* 以外的文件|__wiki__\/ 以外的文件/);
    expect(wikiAgentDoc).toMatch(/不要回显输出契约/);
  });
});

describe('canonical wiki CLAUDE.md feature 上下文', () => {
  it('说明 __wiki__/ 目录布局', () => {
    expect(wikiClaudeDoc).toContain('__wiki__/');
    expect(wikiClaudeDoc).toMatch(/entities\/|concepts\/|sources\/|syntheses\//);
  });

  it('说明页面 front-matter 字段', () => {
    expect(wikiClaudeDoc).toContain('title');
    expect(wikiClaudeDoc).toContain('type:');
    expect(wikiClaudeDoc).toContain('sources');
    expect(wikiClaudeDoc).toContain('tags');
    expect(wikiClaudeDoc).toContain('confidence');
    expect(wikiClaudeDoc).toContain('related');
  });

  it('说明 [[wiki://path]] 链接格式', () => {
    expect(wikiClaudeDoc).toMatch(/\[\[wiki:\/\//);
  });

  it('说明 kebab-case 文件命名规则', () => {
    expect(wikiClaudeDoc).toMatch(/kebab-case|kebab/);
  });
});
