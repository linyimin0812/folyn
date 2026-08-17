// wiki feature agent canonical 文件契约单测。
// 验证 `apps/desktop/src/features/wiki/.claude/agents/wiki.md` 与 `CLAUDE.md` 承载
// ingest / overview / lint / query 四 action 的输出契约（ADR-0004 后 generate 已删除）。

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

  it('包含 overview action 的 Markdown 摘要契约', () => {
    expect(wikiAgentDoc).toContain('action: overview');
    expect(wikiAgentDoc).toMatch(/overview\.md/);
    expect(wikiAgentDoc).toMatch(/≤ 30 行|不超过.*30/);
  });

  it('不再包含已废弃的 generate action', () => {
    expect(wikiAgentDoc).not.toContain('action: generate');
  });

  it('包含 lint action 的语义合并建议 JSON 输出契约', () => {
    expect(wikiAgentDoc).toContain('action: lint');
    expect(wikiAgentDoc).toContain('merge_suggestion');
    expect(wikiAgentDoc).toContain('affectedPages');
    expect(wikiAgentDoc).toContain('suggestedActions');
  });

  it('lint 仅做语义检查，结构性检查由代码负责', () => {
    expect(wikiAgentDoc).toMatch(/结构性检查.*由.*代码/);
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
