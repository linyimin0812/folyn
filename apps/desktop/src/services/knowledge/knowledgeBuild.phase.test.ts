import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbFs } from './kbFs';
import { buildKnowledge, type BuildItemProgress } from './knowledgeBuild';

const calls = vi.hoisted(() => ({ ingest: vi.fn(), synth: vi.fn() }));
vi.mock('./sourceIngest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sourceIngest')>()),
  ingestSource: calls.ingest,
}));
vi.mock('./topicSynth', () => ({ synthTopicsForSource: calls.synth }));
vi.mock('./kbMoveReconcile', () => ({ reconcileMovedSources: async () => 0 }));
vi.mock('./kbAsk', () => ({ invalidateKbIndexCache: vi.fn() }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ manager: { listFiles: async () => [{path: 'source.md', type: 'file', name: 'source.md'}] } }) } }));

function memoryFs(): KbFs {
  const files = new Map([['source.md', 'Source content']]);
  return {
    readFile: async (path) => { const text = files.get(path); if (text === undefined) throw new Error('missing'); return text; },
    exists: async (path) => files.has(path),
    writeFile: async (path, text) => { files.set(path, text); },
    rename: async (from, to) => { const text = files.get(from); if (text === undefined) throw new Error('missing'); files.set(to, text); files.delete(from); },
  };
}

beforeEach(() => {
  calls.ingest.mockReset().mockResolvedValue({skipped: false, versionHash: 'hash', nodes: []});
  calls.synth.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('per-source processing failure context', () => {
  it.each([
    ['indexing', '生成资料索引失败'],
    ['synthesizing', '整理主题知识失败'],
  ])('retains %s stage when the source ends in an error', async (stage, label) => {
    (stage === 'indexing' ? calls.ingest : calls.synth).mockRejectedValue(new Error('模型未返回 JSON'));
    let final: BuildItemProgress[] = [];
    await buildKnowledge(memoryFs(), {goal: 'Goal', scope: ['source.md'], onProgress: (items) => { final = items; }});
    expect(final).toEqual([{path: 'source.md', status: 'error', message: `${label}：模型未返回 JSON`}]);
  });
});
