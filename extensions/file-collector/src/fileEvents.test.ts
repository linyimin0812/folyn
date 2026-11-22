/**
 * diffSnapshots / textDiff tests: pure snapshot diffing — no fs access. The
 * collect tests run against a fake `api.vault`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CollectorEvent, ExtensionApi } from 'folyn-extension-sdk';
import { diffSnapshots, parseSnapshot, snapshotHasContent, textDiff } from './fileEvents';
import type { VaultFile, VaultSnapshot } from './fileEvents';
import { collectFileActivity } from './index';

const NOW = 1_000_000;

type Listed = Array<{ path: string; mtimeMs: number; size: number }>;

/** A fake `api.vault`: `files` is the listing, `read(path)` the capped text
 *  (`undefined` = the read throws). Records the options each call got. */
function fakeVault(files: Listed, read: (path: string) => string | null | undefined = () => null, open = true) {
  const listFiles = vi.fn(async (_opts?: { exclude?: string[]; includeHidden?: boolean }) =>
    files.map((f) => ({ ...f, name: f.path.split('/').pop()! })));
  const readText = vi.fn(async (path: string, _opts?: { maxBytes: number }) => {
    const r = read(path);
    if (r === undefined) throw new Error(`unreadable: ${path}`);
    return r;
  });
  const vault = { current: () => (open ? { id: 'v', name: 'V' } : null), listFiles, readText };
  return { api: { vault } as unknown as ExtensionApi, listFiles, readText };
}

/** The vault holds nothing; for tests about the cursor alone. */
const api = fakeVault([]).api;

function files(...entries: VaultFile[]): VaultFile[] {
  return entries;
}

describe('diffSnapshots', () => {
  it('baseline (prev null) emits no events and returns the snapshot', () => {
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { events, snapshot } = diffSnapshots(null, current, new Map(), NOW);
    expect(events).toEqual([]);
    expect(snapshot).toEqual({ 'a.md': { mtimeMs: 10, size: 5 } });
  });

  it('unchanged files emit nothing', () => {
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5 } };
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { events } = diffSnapshots(prev, current, new Map(), NOW);
    expect(events).toEqual([]);
  });

  it('new path → file_created with stable id and file entity', () => {
    const prev: VaultSnapshot = {};
    const current = files({ path: 'notes/b.md', mtimeMs: 20, size: 7 });
    const { events } = diffSnapshots(prev, current, new Map(), NOW);
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
    expect(diffSnapshots(prev, mtimeChange, new Map(), NOW).events).toHaveLength(1);
    expect(diffSnapshots(prev, mtimeChange, new Map(), NOW).events[0]!.type).toBe('file_modified');

    const sizeChange = files({ path: 'a.md', mtimeMs: 10, size: 9 });
    expect(diffSnapshots(prev, sizeChange, new Map(), NOW).events[0]!.type).toBe('file_modified');
  });

  it('missing path → file_deleted, no size in payload', () => {
    const prev: VaultSnapshot = { 'gone.md': { mtimeMs: 10, size: 5 } };
    const { events } = diffSnapshots(prev, [], new Map(), NOW);
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
    const { events, snapshot } = diffSnapshots(prev, current, new Map(), NOW);
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
    const deleted = diffSnapshots(prev, [], new Map(), NOW).events;
    const recreated = diffSnapshots({}, files({ path: 'a.md', mtimeMs: 10, size: 5 }), new Map(), NOW).events;
    expect(deleted[0]!.id).toBe('file-activity:file_deleted:a.md:10:del');
    expect(recreated[0]!.id).toBe('file-activity:file_created:a.md:10');
    expect(deleted[0]!.id).not.toBe(recreated[0]!.id);
  });

  // ── content capture ────────────────────────────────────────────────────────

  it('created event carries content when read as a string', () => {
    const prev: VaultSnapshot = {};
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { events } = diffSnapshots(prev, current, new Map([['a.md', 'hello']]), NOW);
    expect(events[0]!.payload).toMatchObject({ path: 'a.md', content: 'hello' });
  });

  it('modified event carries a diff against the previous content', () => {
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5, content: 'one\ntwo\nthree' } };
    const current = files({ path: 'a.md', mtimeMs: 12, size: 5 });
    const { events } = diffSnapshots(prev, current, new Map([['a.md', 'one\nTWO\nthree']]), NOW);
    expect(events[0]!.payload).toMatchObject({ diff: '- two\n+ TWO' });
    expect(events[0]!.payload).not.toHaveProperty('content');
  });

  it('modified without stored old content falls back to full content', () => {
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5 } };
    const current = files({ path: 'a.md', mtimeMs: 12, size: 5 });
    const { events } = diffSnapshots(prev, current, new Map([['a.md', 'brand new']]), NOW);
    expect(events[0]!.payload).toMatchObject({ content: 'brand new' });
    expect(events[0]!.payload).not.toHaveProperty('diff');
  });

  it('modified with identical re-read content emits neither diff nor content', () => {
    // mtime/size changed but content is byte-identical (touch / rewrite).
    const prev: VaultSnapshot = { 'a.md': { mtimeMs: 10, size: 5, content: 'same' } };
    const current = files({ path: 'a.md', mtimeMs: 12, size: 5 });
    const { events } = diffSnapshots(prev, current, new Map([['a.md', 'same']]), NOW);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).not.toHaveProperty('diff');
    expect(events[0]!.payload).not.toHaveProperty('content');
  });

  it('snapshot stores content read this run and carries it forward for unread files', () => {
    const prev: VaultSnapshot = {
      'kept.md': { mtimeMs: 10, size: 5, content: 'old text' },
      'binary.md': { mtimeMs: 10, size: 5, content: 'once text' },
      'plain.md': { mtimeMs: 10, size: 5 },
    };
    const current = files(
      { path: 'kept.md', mtimeMs: 10, size: 5 },
      { path: 'binary.md', mtimeMs: 10, size: 5 },
      { path: 'plain.md', mtimeMs: 10, size: 5 },
    );
    const { snapshot } = diffSnapshots(
      prev,
      current,
      new Map([['binary.md', null]]),
      NOW,
    );
    // Not in the map → previous content carried forward.
    expect(snapshot['kept.md']).toEqual({ mtimeMs: 10, size: 5, content: 'old text' });
    // Read this run as binary → content dropped.
    expect(snapshot['binary.md']).toEqual({ mtimeMs: 10, size: 5 });
    // Never had content → stays metadata-only.
    expect(snapshot['plain.md']).toEqual({ mtimeMs: 10, size: 5 });
  });

  it('baseline with contents stores content in the snapshot', () => {
    const current = files({ path: 'a.md', mtimeMs: 10, size: 5 });
    const { snapshot } = diffSnapshots(null, current, new Map([['a.md', 'seed']]), NOW);
    expect(snapshot).toEqual({ 'a.md': { mtimeMs: 10, size: 5, content: 'seed' } });
  });
});

describe('textDiff', () => {
  it('both null → null', () => {
    expect(textDiff(null, null)).toBeNull();
  });

  it('identical content → null', () => {
    expect(textDiff('a\nb\nc', 'a\nb\nc')).toBeNull();
  });

  it('single-line change: unified hunk with - / + lines', () => {
    expect(textDiff('a\nb\nc', 'a\nB\nc')).toBe('- b\n+ B');
  });

  it('trims the common line prefix and suffix', () => {
    expect(textDiff('h1\nh2\nX\nY\nt1\nt2', 'h1\nh2\nA\nB\nt1\nt2')).toBe('- X\n- Y\n+ A\n+ B');
  });

  it('old null → all lines added', () => {
    expect(textDiff(null, 'a\nb')).toBe('+ a\n+ b');
  });

  it('new null → all lines removed', () => {
    expect(textDiff('a\nb', null)).toBe('- a\n- b');
  });

  it('caps: 100 removed + 100 added lines, 200 chars per line, ~8000 total', () => {
    const long = 'x'.repeat(300);
    const manyOld = Array.from({ length: 250 }, (_, i) => `old${i}`).join('\n');
    const manyNew = Array.from({ length: 250 }, (_, i) => `new${i}${i === 0 ? long : ''}`).join('\n');
    const out = textDiff(manyOld, manyNew)!;
    const removed = out.split('\n').filter((l) => l.startsWith('- '));
    const added = out.split('\n').filter((l) => l.startsWith('+ '));
    expect(removed).toHaveLength(100);
    expect(added).toHaveLength(100);
    expect(out.length).toBeLessThanOrEqual(8000);
    // Line truncation: the 300-char line is clipped to '- new0' + 200 chars.
    const firstAdded = added[0]!;
    expect(firstAdded).toHaveLength(202); // '+ ' + 200
  });
});

describe('snapshotHasContent', () => {
  it('empty snapshot → false', () => {
    expect(snapshotHasContent({})).toBe(false);
  });

  it('entry with content → true', () => {
    expect(snapshotHasContent({ 'a.md': { mtimeMs: 1, size: 2, content: 'x' } })).toBe(true);
  });

  it('metadata-only entries → false', () => {
    expect(snapshotHasContent({ 'a.md': { mtimeMs: 1, size: 2 }, 'b.md': { mtimeMs: 3, size: 4 } })).toBe(false);
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
    const { snapshot } = diffSnapshots(null, files({ path: 'a.md', mtimeMs: 1, size: 2 }), new Map(), NOW);
    const cursor = JSON.stringify(snapshot);
    expect(parseSnapshot(cursor)).toEqual(snapshot);
  });
});

describe('collectFileActivity', () => {
  it('first run (null cursor) baselines: no events, cursor = snapshot JSON', async () => {
    const v = fakeVault([{ path: 'a.md', mtimeMs: 1, size: 2 }]);
    const out = await collectFileActivity({ cursor: null, config: {}, api: v.api });
    expect(out.events).toEqual([]);
    expect(out.nextCursor).toBe('{"a.md":{"mtimeMs":1,"size":2}}');
  });

  it('lists with its own filters, dotfiles included, and reports progress', async () => {
    const cursor = JSON.stringify({ 'a.md': { mtimeMs: 1, size: 2 } });
    const v = fakeVault([{ path: 'b.md', mtimeMs: 3, size: 4 }]);
    const onProgress = vi.fn();
    const out = await collectFileActivity({
      cursor,
      config: { excludePatterns: '# seeded\n .obsidian\nnode_modules \n\n' },
      api: v.api,
      onProgress,
    });
    expect(v.listFiles).toHaveBeenCalledWith({ exclude: ['.obsidian', 'node_modules'], includeHidden: true });
    expect(out.events.map((e) => e.type)).toEqual(['file_created', 'file_deleted']);
    expect(onProgress).toHaveBeenCalledWith('files +1 ~0 -1');
    expect(parseSnapshot(out.nextCursor)).toEqual({ 'b.md': { mtimeMs: 3, size: 4 } });
  });

  it('snapshots in path order whatever order the listing comes in', async () => {
    const v = fakeVault([
      { path: 'z.md', mtimeMs: 1, size: 1 },
      { path: 'a/b.md', mtimeMs: 1, size: 1 },
    ]);
    const out = await collectFileActivity({ cursor: null, config: {}, api: v.api });
    expect(Object.keys(parseSnapshot(out.nextCursor)!)).toEqual(['a/b.md', 'z.md']);
  });

  it('no vault open → no events, cursor untouched', async () => {
    const v = fakeVault([{ path: 'a.md', mtimeMs: 1, size: 2 }], () => 'x', false);
    expect(await collectFileActivity({ cursor: 'x', config: {}, api: v.api })).toEqual({
      events: [],
      nextCursor: 'x',
    });
    expect(v.listFiles).not.toHaveBeenCalled();
  });

  it('baseline reads every file once, with the byte cap, and seeds content into the cursor', async () => {
    const v = fakeVault(
      [
        { path: 'a.md', mtimeMs: 1, size: 2 },
        { path: 'bin.png', mtimeMs: 1, size: 3 },
      ],
      (path) => (path === 'bin.png' ? null : 'seed text'),
    );
    const out = await collectFileActivity({ cursor: null, config: {}, api: v.api });
    expect(out.events).toEqual([]);
    expect(v.readText).toHaveBeenCalledTimes(2);
    expect(v.readText).toHaveBeenCalledWith('a.md', { maxBytes: 8192 });
    expect(parseSnapshot(out.nextCursor)).toEqual({
      'a.md': { mtimeMs: 1, size: 2, content: 'seed text' },
      'bin.png': { mtimeMs: 1, size: 3 },
    });
  });

  it('does not read a file over 1 MB', async () => {
    const v = fakeVault([{ path: 'huge.log', mtimeMs: 1, size: 2_000_000 }], () => 'never');
    const out = await collectFileActivity({ cursor: null, config: {}, api: v.api });
    expect(v.readText).not.toHaveBeenCalled();
    expect(parseSnapshot(out.nextCursor)).toEqual({ 'huge.log': { mtimeMs: 1, size: 2_000_000 } });
  });

  it('non-baseline reads only changed paths and emits a diff', async () => {
    const cursor = JSON.stringify({
      'a.md': { mtimeMs: 1, size: 2, content: 'one\ntwo' },
      'same.md': { mtimeMs: 1, size: 1 },
    });
    const v = fakeVault(
      [
        { path: 'a.md', mtimeMs: 5, size: 2 },
        { path: 'same.md', mtimeMs: 1, size: 1 },
      ],
      () => 'one\nTWO',
    );
    const out = await collectFileActivity({ cursor, config: {}, api: v.api });
    expect(v.readText).toHaveBeenCalledTimes(1);
    expect(v.readText).toHaveBeenCalledWith('a.md', { maxBytes: 8192 });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.payload).toMatchObject({ diff: '- two\n+ TWO' });
    // Unchanged file keeps its snapshot entry; changed file gets new content.
    expect(parseSnapshot(out.nextCursor)).toEqual({
      'a.md': { mtimeMs: 5, size: 2, content: 'one\nTWO' },
      'same.md': { mtimeMs: 1, size: 1 },
    });
  });

  it('legacy cursor (metadata-only) re-seeds the whole vault with content', async () => {
    // Snapshot written by the older metadata-only version: no `content` on
    // any entry → full-vault read once; events still computed vs prev.
    const cursor = JSON.stringify({
      'a.md': { mtimeMs: 1, size: 2 },
      'same.md': { mtimeMs: 1, size: 1 },
    });
    const v = fakeVault(
      [
        { path: 'a.md', mtimeMs: 1, size: 2 },
        { path: 'same.md', mtimeMs: 1, size: 1 },
      ],
      (path) => `text of ${path}`,
    );
    const out = await collectFileActivity({ cursor, config: {}, api: v.api });
    expect(v.readText).toHaveBeenCalledTimes(2);
    expect(out.events).toEqual([]);
    expect(parseSnapshot(out.nextCursor)).toEqual({
      'a.md': { mtimeMs: 1, size: 2, content: 'text of a.md' },
      'same.md': { mtimeMs: 1, size: 1, content: 'text of same.md' },
    });
  });

  it('legacy cursor + changed file: event this run uses content fallback, snapshot still seeded', async () => {
    const cursor = JSON.stringify({ 'a.md': { mtimeMs: 1, size: 2 } });
    const v = fakeVault([{ path: 'a.md', mtimeMs: 5, size: 2 }], () => 'new text');
    const out = await collectFileActivity({ cursor, config: {}, api: v.api });
    expect(out.events).toHaveLength(1);
    // No stored old content → fallback to full content, not a "+ everything" diff.
    expect(out.events[0]!.payload).toMatchObject({ content: 'new text' });
    expect(parseSnapshot(out.nextCursor)).toEqual({ 'a.md': { mtimeMs: 5, size: 2, content: 'new text' } });
  });

  it('a file that fails to read → metadata only for it, the run goes on', async () => {
    const cursor = JSON.stringify({ 'a.md': { mtimeMs: 1, size: 2 } });
    const v = fakeVault([{ path: 'a.md', mtimeMs: 5, size: 2 }], () => undefined);
    const out = await collectFileActivity({ cursor, config: {}, api: v.api });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.payload).not.toHaveProperty('diff');
    expect(out.events[0]!.payload).not.toHaveProperty('content');
  });
});
