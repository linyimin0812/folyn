/**
 * diffSnapshots tests: pure snapshot diffing — no fs access, the scan result
 * is a fixed array (same shape `ctx.scanVault` returns).
 */
import { describe, it, expect, vi } from 'vitest';
import type { CollectorEvent } from 'folyn-extension-sdk';
import { diffSnapshots, parseSnapshot } from './fileEvents';
import type { VaultFile, VaultSnapshot } from './fileEvents';
import { collectFileActivity } from './index';

const NOW = 1_000_000;

function files(...entries: VaultFile[]): VaultFile[] {
  return entries;
}

describe('diffSnapshots', () => {
  it('baseline (prev null) emits no events and returns the snapshot', () => {
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { events, snapshot } = diffSnapshots(null, current, NOW);
    expect(events).toEqual([]);
    expect(snapshot).toEqual({ 'a.md': { mtimeMs: 10, size: 5 } });
  });

  it('unchanged files emit nothing', () => {
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5 } };
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { events } = diffSnapshots(prev, current, NOW);
    expect(events).toEqual([]);
  });

  it('new path → file_created with stable id and file entity', () => {
    const prev: VaultSnapshot = {};
    const current = files({ path: 'notes/b.md', mtimeMs: 20, size: 7 });
    const { events } = diffSnapshots(prev, current, NOW);
    expect(events).toEqual([
      {
        id: 'file-activity:file_created:notes/b.md:20',
        type: 'file_created',
        occurredAt: NOW,
        title: 'b.md',
        summary: 'notes/b.md',
        actor: { type: 'person', identityKey: 'self', displayName: '我' },
        entities: [
          { type: 'file', identityKey: 'notes/b.md', displayName: 'b.md', relation: '文件' },
        ],
        payload: { path: 'notes/b.md', mtimeMs: 20, size: 7 },
      },
    ] satisfies CollectorEvent[]);
  });

  it('mtime or size change → file_modified', () => {
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5 } };
    const mtimeChange = files({ path: 'a.md', mtimeMs: 12, size: 5 });
    expect(diffSnapshots(prev, mtimeChange, NOW).events).toHaveLength(1);
    expect(diffSnapshots(prev, mtimeChange, NOW).events[0]!.type).toBe('file_modified');

    const sizeChange = files({ path: 'a.md', mtimeMs: 10, size: 9 });
    expect(diffSnapshots(prev, sizeChange, NOW).events[0]!.type).toBe('file_modified');
  });

  it('missing path → file_deleted, no size in payload', () => {
    const prev: VaultSnapshot = { 'gone.md': { mtimeMs: 10, size: 5 } };
    const { events } = diffSnapshots(prev, [], NOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'file_deleted',
      title: 'gone.md',
      payload: { path: 'gone.md', mtimeMs: 10 },
    });
    expect(events[0]!.payload).not.toHaveProperty('size');
  });

  it('mixed run: created + modified + deleted together', () => {
    const prev: VaultSnapshot = {
      'same.md': { mtimeMs: 1, size: 1 },
      'mod.md': { mtimeMs: 2, size: 2 },
      'del.md': { mtimeMs: 3, size: 3 },
    };
    const current = files(
      { path: 'same.md', mtimeMs: 1, size: 1 },
      { path: 'mod.md', mtimeMs: 9, size: 2 },
      { path: 'new.md', mtimeMs: 4, size: 4 },
    );
    const { events, snapshot } = diffSnapshots(prev, current, NOW);
    const byType = events.map((e) => `${e.type}:${e.payload!.path}`);
    expect(byType).toEqual(['file_modified:mod.md', 'file_created:new.md', 'file_deleted:del.md']);
    expect(snapshot).toEqual({
      'same.md': { mtimeMs: 1, size: 1 },
      'mod.md': { mtimeMs: 9, size: 2 },
      'new.md': { mtimeMs: 4, size: 4 },
    });
  });

  it('deleted id can never collide with a same-path same-mtime created/modified id', () => {
    // File deleted at mtime 10, then recreated with the SAME mtime (fs
    // granularity, restored from backup, etc.): two events, distinct ids.
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5 } };
    const deleted = diffSnapshots(prev, [], NOW).events;
    const recreated = diffSnapshots({}, files({ path: 'a.md', mtimeMs: 10, size: 5 }), NOW).events;
    expect(deleted[0]!.id).toBe('file-activity:file_deleted:a.md:10:del');
    expect(recreated[0]!.id).toBe('file-activity:file_created:a.md:10');
    expect(deleted[0]!.id).not.toBe(recreated[0]!.id);
  });
});

describe('parseSnapshot', () => {
  it('empty / invalid / non-object cursors degrade to baseline (null)', () => {
    expect(parseSnapshot('')).toBeNull();
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot('[1,2]')).toBeNull();
    expect(parseSnapshot('42')).toBeNull();
  });

  it('round-trips a snapshot the cursor wrote', () => {
    const { snapshot } = diffSnapshots(null, files({ path: 'a.md', mtimeMs: 1, size: 2 }), NOW);
    const cursor = JSON.stringify(snapshot);
    expect(parseSnapshot(cursor)).toEqual(snapshot);
  });
});

describe('collectFileActivity', () => {
  it('first run (null cursor) baselines: no events, cursor = snapshot JSON', async () => {
    const scanVault = async () => [{ path: 'a.md', mtimeMs: 1, size: 2 }];
    const out = await collectFileActivity({ cursor: null, config: {}, scanVault });
    expect(out.events).toEqual([]);
    expect(out.nextCursor).toBe('{"a.md":{"mtimeMs":1,"size":2}}');
  });

  it('diffs against the cursor snapshot and reports progress', async () => {
    const cursor = JSON.stringify({ 'a.md': { mtimeMs: 1, size: 2 } });
    const scanVault = async (opts: { excludeDirs?: string[] }) => {
      expect(opts.excludeDirs).toEqual(['.obsidian', 'node_modules']);
      return [{ path: 'b.md', mtimeMs: 3, size: 4 }];
    };
    const onProgress = vi.fn();
    const out = await collectFileActivity({
      cursor,
      config: { excludeDirs: ' .obsidian, node_modules ,,' },
      scanVault,
      onProgress,
    });
    expect(out.events.map((e) => e.type)).toEqual(['file_created', 'file_deleted']);
    expect(onProgress).toHaveBeenCalledWith('files +1 ~0 -1');
    expect(parseSnapshot(out.nextCursor)).toEqual({ 'b.md': { mtimeMs: 3, size: 4 } });
  });

  it('scanVault absent or null → no events, cursor untouched', async () => {
    expect(await collectFileActivity({ cursor: null, config: {} })).toEqual({
      events: [],
      nextCursor: '',
    });
    const scanVault = async () => null;
    expect(await collectFileActivity({ cursor: 'x', config: {}, scanVault })).toEqual({
      events: [],
      nextCursor: 'x',
    });
  });
});
