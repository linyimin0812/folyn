/**
 * 并行构建（资料级 worker pool）契约：
 * - 资料级并发上限（SOURCE_CONCURRENCY）真实生效；
 * - 分项发布（manifest+nav 写回）经写入串行队列：并行 worker 下同一文件
 *   无并发在途写（固定 `.tmp` 名不撞、读-改-写不丢更新），manifest 最终包含全部资料；
 * - 协作取消：worker 任务边界退出，已发布部分保留，未完成项回 pending；
 * - 块级取消（KbBuildCancelled）：该项不发布、不标 error。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbFs } from './kbFs';
import { readManifest } from './kbFs';
import { buildKnowledge, SOURCE_CONCURRENCY, type BuildItemProgress } from './knowledgeBuild';
import { KbBuildCancelled } from './sourceIngest';

const calls = vi.hoisted(() => ({ ingest: vi.fn(), synth: vi.fn() }));
vi.mock('./sourceIngest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sourceIngest')>()),
  ingestSource: calls.ingest,
}));
vi.mock('./topicSynth', () => ({ synthTopicsForSource: calls.synth }));
vi.mock('./kbMoveReconcile', () => ({ reconcileMovedSources: async () => 0 }));
vi.mock('./kbAsk', () => ({ invalidateKbIndexCache: vi.fn() }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ manager: { listFiles: async () => [] } }) } }));

const FILES = ['notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/d.md', 'notes/e.md'];

interface TrackedFs extends KbFs {
  files: Map<string, string>;
  /** 每 path 的并发在途写峰值。 */
  writePeak: Map<string, number>;
}

/** memoryFs + 延迟写入（人为交错）+ 每路径并发写峰值统计。 */
function trackedFs(writeDelayMs: number): TrackedFs {
  const files = new Map<string, string>(FILES.map((path) => [path, `content of ${path}`]));
  const writePeak = new Map<string, number>();
  const inFlight = new Map<string, number>();
  return {
    files,
    writePeak,
    listSourceTree: async () => FILES.map((path) => ({ path, type: 'file' as const })),
    readFile: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing: ${path}`);
      return text;
    },
    exists: async (path) => files.has(path),
    writeFile: async (path, text) => {
      const n = (inFlight.get(path) ?? 0) + 1;
      inFlight.set(path, n);
      writePeak.set(path, Math.max(writePeak.get(path) ?? 0, n));
      await new Promise((r) => setTimeout(r, writeDelayMs));
      inFlight.set(path, (inFlight.get(path) ?? 1) - 1);
      files.set(path, text);
    },
    rename: async (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`missing: ${from}`);
      files.set(to, text);
      files.delete(from);
    },
  };
}

/** 标准 mock：收录成功、合成无产出（各用例再覆写自己的行为）。 */
function standardMocks(): void {
  calls.ingest.mockImplementation(async () => ({ skipped: false, versionHash: 'h', nodes: [] }));
  calls.synth.mockImplementation(async () => ({ applied: 0, reviews: [] }));
}

beforeEach(() => {
  calls.ingest.mockReset();
  calls.synth.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('资料级并行（worker pool）', () => {
  it('runs sources through the pool capped at SOURCE_CONCURRENCY', async () => {
    standardMocks();
    let items: BuildItemProgress[] = [];
    let active = 0;
    let peak = 0;
    calls.ingest.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { skipped: false, versionHash: 'h', nodes: [] };
    });
    const fs = trackedFs(0);
    await buildKnowledge(fs, {
      goal: 'Goal',
      scope: FILES,
      onProgress: (emitted) => { items = emitted; },
    });
    expect(peak).toBe(Math.min(SOURCE_CONCURRENCY, FILES.length));
    expect(items.every((i) => i.status === 'done')).toBe(true);
    expect(Object.keys((await readManifest(fs))!.sources)).toHaveLength(FILES.length);
  });

  it('serializes per-item publishing: no concurrent in-flight writes to manifest.json, no lost sources', async () => {
    standardMocks();
    const fs = trackedFs(10);
    await buildKnowledge(fs, { goal: 'Goal', scope: FILES });
    // 固定 `.tmp` 名 + 读-改-写安全：同一路径在途写峰值必须 ≤ 1（kbWriteQueue）。
    for (const [path, peak] of fs.writePeak) {
      expect(peak, `${path} 并发在途写 ${peak}`).toBeLessThanOrEqual(1);
    }
    expect(fs.writePeak.get('__kb__/manifest.json.tmp')).toBe(1);
    // 延迟写入下并行发布不丢资料、JSON 不撕裂。
    const manifest = await readManifest(fs);
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest!.sources)).toHaveLength(FILES.length);
  });

  it('cooperative cancel stops the pool at task boundaries and keeps published items', async () => {
    standardMocks();
    let cancel = false;
    let items: BuildItemProgress[] = [];
    calls.ingest.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      cancel = true; // 首个在途项完成后请求停止
      return { skipped: false, versionHash: 'h', nodes: [] };
    });
    const fs = trackedFs(0);
    await buildKnowledge(fs, {
      goal: 'Goal',
      scope: FILES,
      shouldCancel: () => cancel,
      onProgress: (emitted) => { items = emitted; },
    });
    // 3 个在途项完成并发布；未被认领的 2 项停在 pending。
    expect(items.filter((i) => i.status === 'done')).toHaveLength(SOURCE_CONCURRENCY);
    expect(items.filter((i) => i.status === 'pending')).toHaveLength(FILES.length - SOURCE_CONCURRENCY);
    expect(Object.keys((await readManifest(fs))!.sources)).toHaveLength(SOURCE_CONCURRENCY);
  });

  it('a mid-source cancel resets the item to pending (not error) and does not publish it', async () => {
    standardMocks();
    calls.ingest.mockRejectedValue(new KbBuildCancelled());
    let items: BuildItemProgress[] = [];
    const fs = trackedFs(0);
    await buildKnowledge(fs, {
      goal: 'Goal',
      scope: ['notes/a.md'],
      onProgress: (emitted) => { items = emitted; },
    });
    expect(items).toEqual([{ path: 'notes/a.md', status: 'pending' }]);
    // 未发布：磁盘上没有 manifest（该项未进入检索）。
    expect(await readManifest(fs)).toBeNull();
  });
});
