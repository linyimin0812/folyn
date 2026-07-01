import { describe, it, expect } from 'vitest';
import { STUDY_AGENT_NAME, getStudyAgentDef, getStudyAgentDefinition } from './studyAgent';

describe('getStudyAgentDef (canonical .claude/agents/study.md 解析)', () => {
  it('解析 front-matter name/description/tools', () => {
    const def = getStudyAgentDef();
    expect(def.name).toBe(STUDY_AGENT_NAME);
    expect(def.description).toBeTruthy();
    expect(def.description).toContain('study agent');
    expect(def.tools).toBeDefined();
    expect(def.tools).toContain('Read');
    expect(def.tools).toContain('Edit');
    expect(def.tools).toContain('WebSearch');
  });

  it('system prompt body 承载 research/plan 的行语法契约', () => {
    const { prompt } = getStudyAgentDef();
    expect(prompt).toContain('research');
    expect(prompt).toContain('- @book <书名> | <作者> | <简介> | 难度:<易|中|难> | <链接>');
    expect(prompt).toContain('- @web <标题> | <链接> | <简介>');
    expect(prompt).toContain('plan');
    expect(prompt).toContain('- [ ] 1. 入门概览 @{est:2h dep:- prog:0}');
    expect(prompt).toContain('- [ ] 2. 核心概念 @{est:4h dep:1 prog:0}');
    // research/plan 明确不改文件
    expect(prompt).toMatch(/不要.*Edit 工具改文件|绝不改文件/);
  });

  it('system prompt body 承载 feynman/selftest/sq3r 的 callout 契约', () => {
    const { prompt } = getStudyAgentDef();
    expect(prompt).toContain(':::callout{type="warning" title="盲区"}');
    expect(prompt).toContain(':::callout{type="tip" title="自测题"}');
    expect(prompt).toContain('<details>');
    expect(prompt).toContain(':::callout{type="info" title="预读问题"}');
    // append-only 规则
    expect(prompt).toMatch(/append-only|只在段尾追加/);
  });
});

describe('getStudyAgentDefinition (--agents JSON 构造)', () => {
  it('返回以 study 为键的内联定义对象', () => {
    const obj = getStudyAgentDefinition();
    expect(obj[STUDY_AGENT_NAME]).toBeDefined();
    expect(obj[STUDY_AGENT_NAME].prompt).toBe(getStudyAgentDef().prompt);
    expect(obj[STUDY_AGENT_NAME].description).toBeTruthy();
    expect(obj[STUDY_AGENT_NAME].tools).toEqual(getStudyAgentDef().tools);
  });

  it('可被 JSON.stringify 序列化为 --agents 字符串（无单引号，shell-quoting 安全）', () => {
    const json = JSON.stringify(getStudyAgentDefinition());
    expect(json).toContain(STUDY_AGENT_NAME);
    // JSON 用双引号，不含单引号 → quoteShellArg 可整段包裹
    expect(json).not.toContain("'");
    // 可往返解析
    const parsed = JSON.parse(json);
    expect(parsed[STUDY_AGENT_NAME].prompt).toBe(getStudyAgentDef().prompt);
  });
});
