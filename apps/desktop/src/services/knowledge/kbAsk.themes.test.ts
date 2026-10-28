import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetrievalPorts } from './retrievalLoop';
import type { KbFs } from './kbFs';
const probe = vi.hoisted(() => ({
  results: [] as string[],
  questions: [] as string[],
  prompts: [] as string[],
  stoppedBy: 'cancelled' as 'cancelled' | 'done',
}));
vi.mock('./kbLlm', () => ({ kbChatText: vi.fn(async (prompt: string) => { probe.prompts.push(prompt); return ''; }) }));
vi.mock('./retrievalLoop', () => ({ runRetrievalLoop: async (question: string, ports: RetrievalPorts) => {
  probe.questions.push(question);
  probe.results.push(await ports.search(question));
  return { evidence: [], rounds: 1, stoppedBy: probe.stoppedBy, note: '' };
} }));
import { askKnowledge, invalidateKbIndexCache } from './kbAsk';
import { writeManifest } from './kbFs';
import { KB_MAX_HISTORY_TURNS, kbAnswerPrompt } from './kbPrompts';

beforeEach(() => { invalidateKbIndexCache(); probe.results = []; probe.questions = []; probe.prompts = []; probe.stoppedBy = 'cancelled'; });
it('keeps separate keyword indexes for two themes in the same Vault', async () => {
  const files: Record<string, string> = { 'notes/a.md': 'uniquewordalpha', 'notes/b.md': 'uniquewordbeta' };
  const fs = (root: string): KbFs => ({ root,
    readFile: async (path) => { if (!(path in files)) throw new Error('ENOENT'); return files[path]!; },
    writeFile: async (path, content) => { files[path] = content; }, exists: async (path) => path in files,
    rename: async (from, to) => { files[to] = files[from]!; delete files[from]; },
  });
  const a = fs('__kb__/themes/a'); const b = fs('__kb__/themes/b');
  await writeManifest(a, { goal: 'A', scope: ['notes/a.md'], sources: { sameId: { path: 'notes/a.md', currentHash: 'a', indexVersion: 1 } }, topics: {} });
  await writeManifest(b, { goal: 'B', scope: ['notes/b.md'], sources: { sameId: { path: 'notes/b.md', currentHash: 'b', indexVersion: 1 } }, topics: {} });
  await askKnowledge('uniquewordalpha', a, 'same-vault');
  await askKnowledge('uniquewordbeta', b, 'same-vault');
  expect(probe.results[0]).toContain('notes/a.md'); expect(probe.results[1]).toContain('notes/b.md');
  expect(probe.results[1]).not.toContain('notes/a.md');
});

describe('answer-layer conversation context', () => {
  it('injects prior Q&A pairs into the answer prompt and caps at the latest turns', () => {
    const history = Array.from({ length: KB_MAX_HISTORY_TURNS + 2 }, (_, i) => ({ question: `历史问题 ${i}`, answer: `历史回答 ${i}` }));
    const prompt = kbAnswerPrompt('当前问题', '（无证据）', '', history);
    expect(prompt).toContain('会话上下文');
    expect(prompt).toContain(`问：历史问题 2\n答：历史回答 2`);
    expect(prompt).not.toContain('历史问题 1');
    expect(prompt).toContain('## 用户问题\n当前问题');
    expect(kbAnswerPrompt('当前问题', '', '', [])).not.toContain('会话上下文');
  });

  it('passes prior turns to the answer layer while retrieval keeps the current question only', async () => {
    const files: Record<string, string> = { 'notes/a.md': 'uniquewordalpha' };
    const fs: KbFs = { root: '__kb__/themes/a',
      readFile: async (path) => { if (!(path in files)) throw new Error('ENOENT'); return files[path]!; },
      writeFile: async (path, content) => { files[path] = content; }, exists: async (path) => path in files,
      rename: async (from, to) => { files[to] = files[from]!; delete files[from]; },
    };
    await writeManifest(fs, { goal: 'A', scope: ['notes/a.md'], sources: { sameId: { path: 'notes/a.md', currentHash: 'a', indexVersion: 1 } }, topics: {} });
    probe.stoppedBy = 'done';
    await askKnowledge('当前问题', fs, 'vault', {
      priorTurns: [
        { question: '先前问题 1', answer: '先前回答 1', evidence: [] },
        { question: '被取消的轮次', answer: '', evidence: [], note: '已停止检索' },
      ],
    });
    expect(probe.questions).toEqual(['当前问题']);
    expect(probe.prompts[0]).toContain('问：先前问题 1\n答：先前回答 1');
    expect(probe.prompts[0]).not.toContain('被取消的轮次');
    expect(probe.prompts[0]).toContain('## 用户问题\n当前问题');
  });
});
