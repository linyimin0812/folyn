/**
 * 块级并行（sourceIngest 索引块）契约：
 * - 单份资料内 kbChatJson 受限并发（KB_CHUNK_CONCURRENCY）；
 * - 并行结果按块序合并，最终索引与串行版一致（排序 + 跨块去重叠语义不变）；
 * - 协作取消：块循环边界抛 KbBuildCancelled，不写 index。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbFs } from './kbFs';
import { readSourceIndex } from './kbFs';
import { ingestSource, KB_CHUNK_CONCURRENCY, KbBuildCancelled } from './sourceIngest';

const llm = vi.hoisted(() => ({ impl: null as ((prompt: string) => Promise<unknown>) | null }));
vi.mock('./kbLlm', () => ({ kbChatJson: (prompt: string) => (llm.impl ? llm.impl(prompt) : Promise.resolve({})) }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ manager: {} }) } }));

function memoryFs(): KbFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readFile: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing: ${path}`);
      return text;
    },
    exists: async (path) => files.has(path),
    writeFile: async (path, text) => { files.set(path, text); },
    rename: async (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`missing: ${from}`);
      files.set(to, text);
      files.delete(from);
    },
  };
}

/** 长文：行首带 `L<n>` 标记（prompt 里可识别块起始行），总量切成 ≥ 4 块。 */
function longContent(lines: number, lineLen = 1000): string {
  return Array.from({ length: lines }, (_, i) => `L${i + 1} ${'x'.repeat(lineLen)}`).join('\n');
}

const manifest = { goal: 'g', scope: [], sources: {}, topics: {} } as Parameters<typeof ingestSource>[3];

beforeEach(() => {
  llm.impl = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ingestSource — 块级并行', () => {
  it('caps concurrent chunk calls at KB_CHUNK_CONCURRENCY and merges nodes across chunks', async () => {
    const fs = memoryFs();
    fs.files.set('notes/a.md', longContent(60));
    let active = 0;
    let peak = 0;
    llm.impl = async (prompt: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      // 块内首行 `L<n>` → 该行的节点（绝对行号）。
      const line = Number(prompt.match(/^L(\d+)/m)?.[1] ?? 1);
      return { nodes: [{ title: `T${line}`, summary: '', startLine: line, endLine: line }] };
    };
    const result = await ingestSource(fs, 'src-1', 'notes/a.md', manifest);
    expect(result.skipped).toBe(false);
    expect(peak).toBe(KB_CHUNK_CONCURRENCY);
    // 每块一个节点，按块序合并 + 排序后全部保留（无重叠）。
    const index = await readSourceIndex(fs, 'src-1');
    expect(index!.nodes.length).toBeGreaterThan(KB_CHUNK_CONCURRENCY);
    expect(index!.nodes.map((n) => n.startLine)).toEqual([...index!.nodes.map((n) => n.startLine)].sort((a, b) => a - b));
  });

  it('throws KbBuildCancelled at a chunk boundary and writes no index', async () => {
    const fs = memoryFs();
    fs.files.set('notes/a.md', longContent(60));
    llm.impl = async () => ({ nodes: [] });
    await expect(
      ingestSource(fs, 'src-1', 'notes/a.md', manifest, { shouldCancel: () => true }),
    ).rejects.toBeInstanceOf(KbBuildCancelled);
    expect(await readSourceIndex(fs, 'src-1')).toBeNull();
  });
});
