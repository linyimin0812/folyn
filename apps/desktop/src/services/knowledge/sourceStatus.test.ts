import { describe, it, expect } from 'vitest';
import { deriveSourceStatuses, sourceStatusLabel, type DeriveSourceStatusesInput } from './sourceStatus';

function input(overrides: Partial<DeriveSourceStatusesInput> = {}): DeriveSourceStatusesInput {
  return {
    manifest: { scope: ['notes'], sources: {} },
    scopeFiles: [],
    navigation: [],
    reviews: [],
    buildItems: [],
    ...overrides,
  };
}

describe('deriveSourceStatuses — 状态派生', () => {
  it('pending: 范围内未收录的新资料', () => {
    const rows = deriveSourceStatuses(input({ scopeFiles: ['notes/new.md'] }));
    expect(rows).toEqual([
      { srcId: null, path: 'notes/new.md', status: 'pending', message: '范围内新资料，待收录' },
    ]);
  });

  it('indexed → organized → review 随整理与审阅状态递进', () => {
    const manifest = {
      scope: ['notes'],
      sources: { 'src-1': { path: 'notes/a.md' }, 'src-2': { path: 'notes/b.md' }, 'src-3': { path: 'notes/c.md' } },
    };
    const scopeFiles = ['notes/a.md', 'notes/b.md', 'notes/c.md'];

    const indexed = deriveSourceStatuses(input({ manifest, scopeFiles }));
    expect(indexed.find((r) => r.srcId === 'src-1')?.status).toBe('indexed');

    const organized = deriveSourceStatuses(
      input({ manifest, scopeFiles, navigation: [{ sourceIds: ["src-1"] }] }),
    );
    expect(organized.find((r) => r.srcId === 'src-1')?.status).toBe('organized');

    const review = deriveSourceStatuses(
      input({ manifest, scopeFiles, reviews: [{ refs: [{ srcId: 'src-3' }] }] }),
    );
    expect(review.find((r) => r.srcId === 'src-3')?.status).toBe('review');
    // 无修订的仍是 indexed。
    expect(review.find((r) => r.srcId === 'src-2')?.status).toBe('indexed');
  });

  it('removed: 显式停止跟踪 / 移出收录范围（manifest 条目仍在列表中）', () => {
    const manifest = {
      scope: [],
      sources: {
        'src-1': { path: 'notes/a.md', removed: true },
        'src-2': { path: 'notes/b.md' },
      },
    };
    // scopeFiles 为空：src-2 不在当前范围/树内 → 同样按「来源已移除」表达。
    const rows = deriveSourceStatuses(input({ manifest, scopeFiles: [] }));
    expect(rows.find((r) => r.srcId === 'src-1')).toMatchObject({
      status: 'removed',
      message: '已停止跟踪（保留知识与历史引用）',
    });
    expect(rows.find((r) => r.srcId === 'src-2')?.status).toBe('removed');
  });

  it('processing / error 来自当前构建会话的 buildItems，优先于审阅状态', () => {
    const manifest = {
      scope: ['notes'],
      sources: { 'src-1': { path: 'notes/a.md' }, 'src-2': { path: 'notes/b.md' } },
    };
    const scopeFiles = ['notes/a.md', 'notes/b.md'];
    const reviews = [{ refs: [{ srcId: 'src-1' }, { srcId: 'src-2' }] }];
    const rows = deriveSourceStatuses(
      input({
        manifest,
        scopeFiles,
        reviews,
        buildItems: [
          { path: 'notes/a.md', status: 'synthesizing' },
          { path: 'notes/b.md', status: 'error', message: '模型超时' },
        ],
      }),
    );
    expect(rows.find((r) => r.srcId === 'src-1')?.status).toBe('processing');
    const failed = rows.find((r) => r.srcId === 'src-2');
    expect(failed?.status).toBe('error');
    expect(failed?.message).toBe('模型超时');
  });

  it('every status has a text label (状态始终配文字)', () => {
    for (const s of ['pending', 'processing', 'error', 'removed', 'review', 'organized', 'indexed'] as const) {
      expect(sourceStatusLabel(s).length).toBeGreaterThan(0);
    }
  });
});
