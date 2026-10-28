import { describe, expect, it } from 'vitest';
import { kbLanguageDirective, kbSynthPrompt, kbAnswerPrompt, kbVerifyPrompt } from './kbPrompts';

describe('content language directive injection', () => {
  it('auto: instructs the model to follow the source language (no detection code)', () => {
    expect(kbLanguageDirective('auto')).toContain('资料原文的语言');
  });
  it('zh / en: instructs the fixed output language', () => {
    expect(kbLanguageDirective('zh')).toContain('中文');
    expect(kbLanguageDirective('en')).toContain('English');
    expect(kbLanguageDirective()).toBe(kbLanguageDirective('auto'));
  });

  it('injects the directive into the synthesis prompt (titles/body/claims follow the language)', () => {
    const base = kbSynthPrompt('g', 'p.md', 'idx', 'text', 1, [], 'zh');
    expect(base).toContain(kbLanguageDirective('zh'));
    expect(kbSynthPrompt('g', 'p.md', 'idx', 'text', 1, [], 'en')).toContain('English');
    // 缺省 = auto（旧调用链无 manifest.language 时行为不变）
    expect(kbSynthPrompt('g', 'p.md', 'idx', 'text', 1, [])).toContain(kbLanguageDirective('auto'));
  });

  it('injects the directive into the answer prompt and keeps the history contract', () => {
    const history = [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }];
    const prompt = kbAnswerPrompt('当前问题', '证据', '', history, 'en');
    expect(prompt).toContain('English');
    expect(prompt).toContain('问：q1\n答：a1');
    expect(prompt).toContain('## 用户问题\n当前问题');
    const autoPrompt = kbAnswerPrompt('q', 'e', '', []);
    expect(autoPrompt).toContain(kbLanguageDirective('auto'));
    expect(autoPrompt).not.toContain('会话上下文');
    // 回答层 preamble 不再硬编码「用中文回答」——语言只由指令控制。
  });

  it('injects the directive into the verify prompt (verifyNote text follows the language)', () => {
    expect(kbVerifyPrompt('claim', 'anchor', 'excerpt', 'zh')).toContain(kbLanguageDirective('zh'));
    expect(kbVerifyPrompt('claim', 'anchor', 'excerpt', 'en')).toContain('English');
    expect(kbVerifyPrompt('claim', 'anchor', 'excerpt')).toContain(kbLanguageDirective('auto'));
  });
});
