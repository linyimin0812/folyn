import { describe, it, expect } from 'vitest';
import { reconcileMovedSources } from './kbMoveReconcile';
import { sha256Hex } from './kbFs';
import type { KbFs } from './kbFs';
import type { KbManifest } from './kbTypes';

function memFs(files: Record<string, string>): KbFs {
  return {
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
    writeFile: async (p, c) => {
      files[p] = c;
    },
    exists: async (p) => p in files,
    rename: async (o, n) => {
      files[n] = files[o]!;
      delete files[o];
    },
  };
}

function manifestOf(entry: { path: string; currentHash: string }): KbManifest {
  return { goal: 'g', scope: ['notes'], sources: { 'src-1': { ...entry, indexVersion: 1 } }, topics: {} };
}

describe('reconcileMovedSources — 移动/重命名识别（ADR-0009）', () => {
  it('hash 命中：manifest 路径与索引 path 更新，srcId 认领新路径，引用/refs 不动', async () => {
    const content = '# A\n\n正文';
    const hash = await sha256Hex(content);
    const files: Record<string, string> = {
      'notes/moved.md': content,
      '__kb__/sources/src-1.index.json': JSON.stringify({ srcId: 'src-1', path: 'notes/old.md', versionHash: hash, nodes: [] }),
      '__kb__/topics/tp-1.refs.json': JSON.stringify([{ id: 'c1', topicId: 'tp-1', anchorText: 'x', srcId: 'src-1', srcPath: 'notes/old.md', versionHash: hash, startLine: 1, endLine: 1, status: 'active' }]),
    };
    const manifest = manifestOf({ path: 'notes/old.md', currentHash: hash });
    const srcIdByPath = new Map([['notes/other.md', 'src-2']]);

    const fs0 = memFs(files);
    const moved = await reconcileMovedSources(fs0, manifest, ['notes/moved.md', 'notes/other.md'], srcIdByPath, new Set(['notes/moved.md', 'notes/other.md']));
    expect(moved).toBe(1);
    expect(manifest.sources['src-1']!.path).toBe('notes/moved.md');
    expect(srcIdByPath.get('notes/moved.md')).toBe('src-1');
    // 索引文件的 path 字段同步更新（srcId 不变，文件名不动）。
    expect(JSON.parse(files['__kb__/sources/src-1.index.json']!).path).toBe('notes/moved.md');
    // refs.json 不动 —— 引用按稳定标识 + versionHash 关联（ADR-0009）。
    expect(JSON.parse(files['__kb__/topics/tp-1.refs.json']!)[0].srcPath).toBe('notes/old.md');
  });

  it('旧路径仍在树中：不算移动（scope 未覆盖 ≠ 已消失）', async () => {
    const content = 'same';
    const hash = await sha256Hex(content);
    const files = { 'notes/a.md': content, 'notes/copy.md': content };
    const manifest = manifestOf({ path: 'notes/a.md', currentHash: hash });
    const moved = await reconcileMovedSources(memFs(files), manifest, ['notes/copy.md'], new Map(), new Set(['notes/a.md', 'notes/copy.md']));
    expect(moved).toBe(0);
    expect(manifest.sources['src-1']!.path).toBe('notes/a.md');
  });

  it('内容改过（移动+修改）：hash 不匹配 → 维持现状，走「来源已移除」派生', async () => {
    const files = { 'notes/moved.md': 'changed content' };
    const manifest = manifestOf({ path: 'notes/old.md', currentHash: 'deadbeef' });
    const moved = await reconcileMovedSources(memFs(files), manifest, ['notes/moved.md'], new Map(), new Set(['notes/moved.md']));
    expect(moved).toBe(0);
    expect(manifest.sources['src-1']!.path).toBe('notes/old.md');
  });

  it('候选已被其他 srcId 认领：不参与匹配', async () => {
    const content = 'same';
    const hash = await sha256Hex(content);
    const files = { 'notes/moved.md': content };
    const manifest = manifestOf({ path: 'notes/old.md', currentHash: hash });
    const srcIdByPath = new Map([['notes/moved.md', 'src-2']]);
    const moved = await reconcileMovedSources(memFs(files), manifest, ['notes/moved.md'], srcIdByPath, new Set(['notes/moved.md']));
    expect(moved).toBe(0);
  });
});
