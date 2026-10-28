import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbFs, KbGenStore } from './kbFs';
import type { BuildOptions } from './knowledgeBuild';

const testState = vi.hoisted(() => ({
  vaultId: 'vault-a', writeGate: null as Promise<void> | null, files: {} as Record<string, string>, build: vi.fn(), ask: vi.fn(),
}));
// 生成物存储 fake（ADR-0011：KB 生成物不再走 manager）—— 键为绝对路径。
const gen = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ activeVaultId: testState.vaultId, isLoading: false, manager: {
  readFile: async (path: string) => { const key = `${testState.vaultId}:${path}`; if (!(key in testState.files)) throw new Error(`ENOENT: ${path}`); return testState.files[key]!; },
  writeFile: async (path: string, content: string) => { if (testState.writeGate) await testState.writeGate; testState.files[`${testState.vaultId}:${path}`] = content; },
  rename: async (from: string, to: string) => { testState.files[`${testState.vaultId}:${to}`] = testState.files[`${testState.vaultId}:${from}`]!; delete testState.files[`${testState.vaultId}:${from}`]; },
} }) } }));
vi.mock('./knowledgeBuild', () => ({ buildKnowledge: testState.build }));
vi.mock('./kbAsk', () => ({ askKnowledge: testState.ask, invalidateKbIndexCache: vi.fn() }));
vi.mock('./kbReviewActions', () => ({ applyReview: vi.fn(), discardReview: vi.fn() }));
vi.mock('./kbVerify', () => ({ verifyTopicRef: vi.fn() }));
// knowledgeStore → fileWatcher → file-types registry → open-color JSON（Node ESM
// collect 失败，同 TopicReader.test 的处理）：mock 掉监听单例。
vi.mock('@/utils/fileWatcher', () => ({ suppressWatcherFor: vi.fn() }));
import { useKnowledgeStore, activeThemeFs } from '@/store/knowledgeStore';
import { readThemeRegistry, themeKbFs } from './kbThemes';
import { readManifest, setKbGenStoreForTests, writeManifest, writeTopicRefs, readTopicRefs } from './kbFs';
import { writeDeletions, readDeletions } from './kbDeletions';
import { kbThemeRegistryPath, kbTopicPagePath } from './kbPaths';

const genStore: KbGenStore = {
  resolveBase: async (vaultId) => `/fixtures/folyn/vaults/${vaultId}`,
  readFile: async (abs) => { if (!(abs in gen.files)) throw new Error(`ENOENT: ${abs}`); return gen.files[abs]!; },
  writeFile: async (abs, content) => { if (testState.writeGate) await testState.writeGate; gen.files[abs] = content; },
  exists: async (abs) => abs in gen.files,
  rename: async (o, n) => { gen.files[n] = gen.files[o]!; delete gen.files[o]; },
};

const state = () => useKnowledgeStore.getState();
async function theme(name: string) { expect((await state().createTheme({ name, goal: `${name} goal`, scope: ['notes'] })).ok).toBe(true); return state().activeThemeId!; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  testState.vaultId = `vault-${Math.random().toString(36).slice(2)}`;
  testState.writeGate = null;
  testState.files = {}; gen.files = {};
  testState.build.mockReset().mockResolvedValue(undefined); testState.ask.mockReset();
  useKnowledgeStore.setState({ themes: [], activeThemeId: null, contextVaultId: null });
  setKbGenStoreForTests(genStore);
});
afterEach(() => setKbGenStoreForTests(null));

describe('Independent configured themes', () => {
  it('persists registry selection and never reads or migrates legacy root configuration', async () => {
    // 旧位置（vault 内 `__kb__`）的存量数据：留在原地，不读不迁（ADR-0011）。
    testState.files[`${testState.vaultId}:__kb__/manifest.json`] = '{"goal":"legacy"}';
    await state().loadFromManifest(); expect(state().themes).toEqual([]); expect(state().goal).toBe('');
    const a = await theme('A'); const b = await theme('B');
    await state().selectTheme(a);
    const registry = await readThemeRegistry(themeKbFs(testState.vaultId, a));
    expect(registry.activeThemeId).toBe(a); expect(registry.themes.map((t) => t.name)).toEqual(['A', 'B']);
    expect(testState.files[`${testState.vaultId}:__kb__/manifest.json`]).toBe('{"goal":"legacy"}');
    // 生成物全部落在 ~/.folyn/vaults/<vaultId>/__kb__/，vault 内除预置的旧位置
    // 存量外不再出现任何 __kb__ 写入。
    expect(Object.keys(testState.files).filter((key) => key.includes('__kb__'))).toEqual([`${testState.vaultId}:__kb__/manifest.json`]);
    expect(Object.keys(gen.files).every((key) => key.startsWith(`/fixtures/folyn/vaults/${testState.vaultId}/__kb__/`))).toBe(true);
    expect(a).not.toBe(b); expect(activeThemeFs().root).toContain(a);
  });

  it('isolates manifests, actual generated page paths, references and deletion intents', async () => {
    const a = await theme('A'); const b = await theme('B');
    const fsA = themeKbFs(testState.vaultId, a); const fsB = themeKbFs(testState.vaultId, b);
    const manifest = (await readManifest(fsA))!;
    manifest.topics.p1 = { title: 'A page', path: kbTopicPagePath('p1', fsA.root), lastProgramHash: null };
    await writeManifest(fsA, manifest); await fsA.writeFile(manifest.topics.p1.path, 'A only');
    await writeTopicRefs(fsA, 'p1', [{ id: 'c1', topicId: 'p1', srcId: 's1', srcPath: 'notes/a.md', anchorText: 'A', versionHash: 'h1', startLine: 1, endLine: 1, status: 'active' }]);
    await writeDeletions(fsA, [{id: 'd1', topicId: 'p1', srcId: 's1', versionHash: 'h1', anchorText: 'A', createdAt: 1}]);
    expect((await readManifest(fsB))!.topics).toEqual({}); expect(await readTopicRefs(fsB, 'p1')).toEqual([]); expect(await readDeletions(fsB)).toEqual([]);
    expect((await readTopicRefs(fsA, 'p1'))[0]!.srcPath).toBe('notes/a.md');
    await state().selectTheme(a); expect(state().topics[0]!.path).toBe(`__kb__/themes/${a}/topics/p1.md`);
  });

  it('preserves per-theme question and page state while delayed build callbacks stay with their owner', async () => {
    const a = await theme('A'); const b = await theme('B'); await state().selectTheme(a);
    state().setAskQuestion('A question'); state().setPage('ask');
    const pending = deferred<void>(); let opts!: BuildOptions; let fs!: KbFs;
    testState.build.mockImplementation((port: KbFs, options: BuildOptions) => { fs = port; opts = options; return pending.promise; });
    const operation = state().build();
    await state().selectTheme(b); expect(state().askQuestion).toBe(''); expect(state().buildRunning).toBe(false);
    opts.onProgress?.([{path: 'notes/a.md', status: 'indexing'}], 0); opts.onDetail?.('A detail', 'notes/a.md'); opts.onStream?.('A stream', 'notes/a.md');
    expect(state().buildItems).toEqual([]); expect(fs.root).toBe(`__kb__/themes/${a}`);
    pending.resolve(); await operation;
    await state().selectTheme(a); expect(state().askQuestion).toBe('A question'); expect(state().page).toBe('ask');
    expect(state().buildDetails['notes/a.md']!.stream).toBe('A stream'); expect(state().buildRunning).toBe(false);
  });

  it('isolates a delayed answer and restores it only when returning to its theme', async () => {
    const a = await theme('A'); const b = await theme('B'); await state().selectTheme(a);
    state().setAskQuestion('A question'); const answer = deferred<{answer:string;retrieval:{evidence:[];note:string}}>(); testState.ask.mockReturnValue(answer.promise);
    const operation = state().ask(); await state().selectTheme(b);
    answer.resolve({answer:'A answer',retrieval:{evidence:[],note:'A note'}}); await operation;
    expect(state().askTurns).toEqual([]); await state().selectTheme(a);
    expect(state().askTurns).toEqual([{ question: 'A question', answer: 'A answer', evidence: [], note: 'A note' }]);
  });

  it('records a failed ask as an answer-empty turn (note only) and clearAsk wipes the conversation', async () => {
    const a = await theme('A'); await state().selectTheme(a);
    state().setAskQuestion('Failing question'); testState.ask.mockRejectedValue(new Error('boom'));
    await state().ask();
    expect(state().askTurns).toEqual([{ question: 'Failing question', answer: '', evidence: [], note: '提问失败：boom' }]);
    state().clearAsk();
    expect(state().askTurns).toEqual([]); expect(state().askQuestion).toBe('');
  });

  it('guards captured FS after a Vault switch and never writes into the incoming Vault', async () => {
    const a = await theme('A'); const port = themeKbFs(testState.vaultId, a); testState.vaultId = 'other';
    expect(() => port.writeFile('notes/source.md', 'wrong')).toThrow(/Vault/);
    expect(Object.keys(testState.files).some((key) => key.startsWith('other:'))).toBe(false);
  });


  it('prevents build from racing a pending config write and blocks config writes during build', async () => {
    await theme('A');
    const write = deferred<void>(); testState.writeGate = write.promise;
    const saving = state().saveConfig({goal:'Updated',scope:['notes']});
    await vi.waitFor(() => expect(state().mutationRunning).toBe(true));
    await state().build(); expect(testState.build).not.toHaveBeenCalled();
    write.resolve(); expect((await saving).ok).toBe(true); testState.writeGate = null;
    const building = deferred<void>(); testState.build.mockReturnValue(building.promise);
    const operation = state().build(); expect(state().buildRunning).toBe(true);
    expect((await state().saveConfig({goal:'Conflict',scope:[]})).ok).toBe(false);
    building.resolve(); await operation; expect(state().goal).toBe('Updated');
  });

  it('renames a theme without changing its identity or another theme configuration', async () => {
    const a = await theme('A'); const b = await theme('B');
    expect((await state().saveConfig({name:'Renamed B',goal:'Updated B',scope:[]})).ok).toBe(true);
    expect(state().activeThemeId).toBe(b); expect(state().themes.find((t) => t.id === b)!.name).toBe('Renamed B');
    await state().selectTheme(a); expect(state().goal).toBe('A goal'); expect(state().scope).toEqual(['notes']);
  });

  it('finishes hydration after returning to a theme whose configuration is still saving', async () => {
    const a = await theme('A'); const b = await theme('B'); await state().selectTheme(a);
    const write = deferred<void>(); testState.writeGate = write.promise;
    const saving = state().saveConfig({ goal: 'Saved A goal', scope: ['notes/a.md'] });
    await vi.waitFor(() => expect(state().mutationRunning).toBe(true));
    const selectingB = state().selectTheme(b);
    const selectingA = state().selectTheme(a);
    write.resolve();
    await Promise.all([saving, selectingB, selectingA]); testState.writeGate = null;
    expect(state().activeThemeId).toBe(a);
    expect(state().loaded).toBe(true);
    expect(state().mutationRunning).toBe(false);
    expect(state().goal).toBe('Saved A goal');
    expect(state().scope).toEqual(['notes/a.md']);
    expect((await readThemeRegistry(themeKbFs(testState.vaultId, a))).activeThemeId).toBe(a);
  });

  it('refuses corrupt or unreadable registries instead of resetting them to empty themes', async () => {
    const a = await theme('A'); const port = themeKbFs(testState.vaultId, a);
    gen.files[`/fixtures/folyn/vaults/${testState.vaultId}/${kbThemeRegistryPath}`] = '{bad';
    await expect(readThemeRegistry(port)).rejects.toThrow();
    await expect(readThemeRegistry({ ...port, readFile: async () => { throw new Error('permission denied'); } })).rejects.toThrow('permission denied');
  });
});
