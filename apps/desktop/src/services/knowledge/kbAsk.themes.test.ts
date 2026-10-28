import { beforeEach, expect, it, vi } from 'vitest';
import type { RetrievalPorts } from './retrievalLoop';
import type { KbFs } from './kbFs';
const probe = vi.hoisted(() => ({ results: [] as string[] }));
vi.mock('./kbLlm', () => ({ kbChatText: async () => '' }));
vi.mock('./retrievalLoop', () => ({ runRetrievalLoop: async (question: string, ports: RetrievalPorts) => { probe.results.push(await ports.search(question)); return { evidence: [], rounds: 1, stoppedBy: 'cancelled', note: '' }; } }));
import { askKnowledge, invalidateKbIndexCache } from './kbAsk';
import { writeManifest } from './kbFs';

beforeEach(() => { invalidateKbIndexCache(); probe.results = []; });
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
