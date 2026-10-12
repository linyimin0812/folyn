/**
 * Behavior tests for the pi session reader (discovery + tree/branch
 * projection + message projection). Synthetic v3 fixtures only — the shapes
 * are machine-verified against local pi files; no personal transcript text.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverPiSessions,
  parsePiSession,
  readPiSession,
  type PiSessionFs,
} from './piSessions';
import type { ExternalSessionSummary } from './types';

function createMemFs(
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
): PiSessionFs {
  return {
    readLines: async (p, maxLines) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!.split('\n').slice(0, maxLines);
    },
    readTextFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
    listJsonlFiles: async (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`) && f.endsWith('.jsonl'))
        .sort(),
    exists: async (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    mtime: async (p) => (p in mtimes ? mtimes[p]! : null),
  };
}

// ── Synthetic fixture builders (machine-verified pi v3 shapes) ───────────────

let seq = 0;
function nid(): string {
  seq += 1;
  return `n${String(seq).padStart(3, '0')}`;
}

function header(sessionId: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'session', version: 3, id: sessionId,
    timestamp: '2026-10-11T08:00:00.000Z', cwd, ...extra,
  });
}

interface MsgOpts {
  id?: string;
  parentId?: string;
  timestamp?: string;
}

function userMsg(text: string, opts: MsgOpts = {}): string {
  return JSON.stringify({
    type: 'message', id: opts.id ?? nid(), parentId: opts.parentId ?? nid(),
    timestamp: opts.timestamp ?? '2026-10-11T08:00:01.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

function assistantMsg(parts: unknown[], opts: MsgOpts = {}): string {
  return JSON.stringify({
    type: 'message', id: opts.id ?? nid(), parentId: opts.parentId ?? nid(),
    timestamp: opts.timestamp ?? '2026-10-11T08:00:02.000Z',
    message: { role: 'assistant', content: parts },
  });
}

function toolResultMsg(toolCallId: string, parts: unknown[], opts: MsgOpts = {}): string {
  return JSON.stringify({
    type: 'message', id: opts.id ?? nid(), parentId: opts.parentId ?? nid(),
    timestamp: opts.timestamp ?? '2026-10-11T08:00:03.000Z',
    message: { role: 'toolResult', toolCallId, toolName: 'read', content: parts, isError: false },
  });
}

const ROOT = '/home/u/.pi/agent/sessions';

// A session with a fork: root m1 → (b1 alt branch, c1 mainline-last).
// Parents must precede children (append-only file order).
function forkedSession(): string {
  seq = 0;
  return [
    header('ccccccc0-0000-0000-0000-000000000001', '/work/delta'),
    userMsg('how does the branch reader work?', { id: 'm1' }),
    userMsg('alt direction', { id: 'b1', parentId: 'm1', timestamp: '2026-10-11T08:00:04.000Z' }),
    userMsg('mainline direction', { id: 'c1', parentId: 'm1', timestamp: '2026-10-11T08:00:05.000Z' }),
  ].join('\n');
}

describe('discoverPiSessions', () => {
  it('lists sessions across project dirs with cwd from the header, never decoded from the slug', async () => {
    const a = `${ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;
    const b = `${ROOT}/-home-u-not-reversible/2026-10-10T07-00-00-000Z_ddddddd0-0000-0000-0000-000000000002.jsonl`;
    const files: Record<string, string> = {
      [a]: forkedSession(),
      [b]: [header('ddddddd0-0000-0000-0000-000000000002', '/work/zeta'), userMsg('zeta prompt')].join('\n'),
    };
    const mtimes: Record<string, number> = { [a]: Date.parse('2026-10-11T09:00:00Z') };
    const { sessions, errors } = await discoverPiSessions(ROOT, createMemFs(files, mtimes));
    expect(errors).toEqual([]);
    expect(sessions).toHaveLength(2);
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    expect(byId.get('ccccccc0-0000-0000-0000-000000000001')?.cwd).toBe('/work/delta');
    expect(byId.get('ddddddd0-0000-0000-0000-000000000002')?.cwd).toBe('/work/zeta');
    // mtime backs updatedAt; newest first; title from the first user prompt
    expect(sessions[0]?.sessionId).toBe('ccccccc0-0000-0000-0000-000000000001');
    expect(sessions[0]?.title).toBe('how does the branch reader work?');
    expect(sessions[0]?.updatedAt).toBe(Date.parse('2026-10-11T09:00:00Z'));
    expect(sessions[0]?.startedAt).toBe(Date.parse('2026-10-11T08:00:00.000Z'));
  });

  it('records the header parentSession when present, and falls back to the filename timestamp title', async () => {
    const file = `${ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;
    const files = {
      [file]: [header('ccccccc0-0000-0000-0000-000000000001', '/work/delta', { parentSession: 'parent-1' })].join('\n'),
    };
    const { sessions } = await discoverPiSessions(ROOT, createMemFs(files));
    expect(sessions[0]?.parentSessionId).toBe('parent-1');
    // no user message in the head — filename timestamp title
    expect(sessions[0]?.title).toBe('2026-10-11 08:00');
  });

  it('an unsupported format version is an explicit error; other files stay listed', async () => {
    const good = `${ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;
    const bad = `${ROOT}/-work-delta/2026-10-10T07-00-00-000Z_eeeeeee0-0000-0000-0000-000000000003.jsonl`;
    const files = {
      [good]: forkedSession(),
      [bad]: [JSON.stringify({ type: 'session', version: 4, id: 'eeeeeee0-0000-0000-0000-000000000003', timestamp: '2026-10-10T07:00:00.000Z', cwd: '/w' })].join('\n'),
    };
    const { sessions, errors } = await discoverPiSessions(ROOT, createMemFs(files));
    expect(sessions.map((s) => s.sessionId)).toEqual(['ccccccc0-0000-0000-0000-000000000001']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unsupported pi session format version 4');
    expect(errors[0]).toContain('(supported: 3)');
  });

  it('a missing root is an empty source, not an error', async () => {
    const { sessions, errors } = await discoverPiSessions(ROOT, createMemFs({}));
    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('an unreadable/torn header is reported per file without dropping the rest', async () => {
    const good = `${ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;
    const torn = `${ROOT}/-work-delta/2026-10-10T07-00-00-000Z_eeeeeee0-0000-0000-0000-000000000003.jsonl`;
    const files = { [good]: forkedSession(), [torn]: '{"type":"session","ver' };
    const { sessions, errors } = await discoverPiSessions(ROOT, createMemFs(files));
    expect(sessions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('torn session header');
  });

  it('a session id duplicated across project dirs resolves deterministically', async () => {
    const sid = 'ccccccc0-0000-0000-0000-000000000001';
    const a = `${ROOT}/-work-alpha/2026-10-11T08-00-00-000Z_${sid}.jsonl`;
    const b = `${ROOT}/-work-zeta/2026-10-11T08-00-00-000Z_${sid}.jsonl`; // sorts after -work-alpha
    const files = { [a]: forkedSession(), [b]: forkedSession() };
    const { sessions } = await discoverPiSessions(ROOT, createMemFs(files));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.filePath).toBe(a); // first sorted path wins
  });
});

describe('parsePiSession — branch projection', () => {
  it('the default branch is the last-child chain; other branches stay out of the projection', () => {
    const { messages, branch } = parsePiSession(forkedSession());
    expect(messages.map((m) => m.content)).toEqual(['how does the branch reader work?', 'mainline direction']);
    expect(branch.currentId).toBe('c1');
    // labels: the mainline keeps the session's first user text; the alt
    // branch is labeled by its first user message AFTER the fork point
    expect(branch.all.map((b) => [b.id, b.label])).toEqual([
      ['c1', 'how does the branch read…'],
      ['b1', 'alt direction'],
    ]);
  });

  it('switching the branch re-projects the messages of that branch only', () => {
    const alt = parsePiSession(forkedSession(), 'b1');
    expect(alt.messages.map((m) => m.content)).toEqual(['how does the branch reader work?', 'alt direction']);
    expect(alt.branch.currentId).toBe('b1');
  });

  it('a vanished branch id throws instead of silently retargeting', () => {
    expect(() => parsePiSession(forkedSession(), 'gone')).toThrow('no longer exists');
  });

  it('a linear session reports exactly one branch', () => {
    const linear = [
      header('s1', '/w'),
      userMsg('one', { id: 'a' }),
      userMsg('two', { id: 'b', parentId: 'a' }),
    ].join('\n');
    const { messages, branch } = parsePiSession(linear);
    expect(messages.map((m) => m.content)).toEqual(['one', 'two']);
    expect(branch.all).toHaveLength(1);
    expect(branch.currentId).toBe('b');
  });

  it('an unsupported version throws — no migration, no fallback parse', () => {
    const v2 = [JSON.stringify({ type: 'session', version: 2, id: 's', timestamp: '2026-10-11T08:00:00.000Z', cwd: '/w' })].join('\n');
    expect(() => parsePiSession(v2)).toThrow('unsupported pi session format version 2');
  });
});

describe('parsePiSession — message projection', () => {
  it('correlates toolCall parts with toolResult messages by toolCallId; arguments objects are serialized', () => {
    seq = 0;
    const text = [
      header('s1', '/work/delta'),
      userMsg('read the parser', { id: 'm1' }),
      assistantMsg([
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'reading it' },
        { type: 'toolCall', id: 'call_1', name: 'read', arguments: { file: 'parser.ts' } },
      ], { id: 'm2', parentId: 'm1' }),
      toolResultMsg('call_1', [{ type: 'text', text: 'parser source' }], { parentId: 'm2' }),
    ].join('\n');
    const { messages } = parsePiSession(text);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'read the parser'],
      ['assistant', 'reading it'], // thinking display-hidden
    ]);
    const owner = messages[1]!;
    expect(owner.toolCalls[0]).toMatchObject({
      callId: 'call_1',
      name: 'read',
      input: '{"file":"parser.ts"}',
      output: 'parser source',
    });
    // verbatim evidence: the toolResult line is retained on the owner
    expect(owner.rawToolRecords).toHaveLength(1);
    expect(owner.rawToolRecords[0]).toContain('toolResult');
  });

  it('a toolCall without a result on the branch is a missing tool-output, never guessed', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      userMsg('run it', { id: 'm1' }),
      assistantMsg([{ type: 'toolCall', id: 'call_9', name: 'bash', arguments: { cmd: 'ls' } }], { parentId: 'm1' }),
    ].join('\n');
    const { messages } = parsePiSession(text);
    expect(messages[1]?.toolCalls[0]?.output).toBeNull();
    expect(messages[1]?.missing).toEqual([
      { kind: 'tool-output', reason: expect.stringContaining('call_9') },
    ]);
  });

  it('nestedCalls in a tool result are explicit missing material — outputs are not recorded upstream', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      userMsg('search', { id: 'm1' }),
      assistantMsg([{ type: 'toolCall', id: 'call_1', name: 'search', arguments: {} }], { id: 'a1', parentId: 'm1' }),
      toolResultMsg('call_1', [
        { type: 'text', text: 'partial output' },
        { type: 'toolCall', id: 'nested', name: 'sub', arguments: {}, nestedCalls: [] },
      ], { parentId: 'a1' }),
    ].join('\n');
    const { messages } = parsePiSession(text);
    const owner = messages[1]!;
    expect(owner.toolCalls[0]?.output).toBe('partial output');
    expect(owner.missing).toEqual([
      { kind: 'tool-output', reason: expect.stringContaining('nested tool calls') },
    ]);
  });

  it('inline user images become data URLs; missing bytes are explicit', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      JSON.stringify({
        type: 'message', id: 'm1', parentId: 's1', timestamp: '2026-10-11T08:00:01.000Z',
        message: { role: 'user', content: [
          { type: 'text', text: 'look at ' },
          { type: 'image', image: 'aGVsbG8=', mimeType: 'image/png' },
          { type: 'image', url: 'file:///not-inline.png' },
        ] },
      }),
    ].join('\n');
    const { messages } = parsePiSession(text);
    expect(messages[0]?.content).toBe('look at ');
    expect(messages[0]?.images).toEqual([{ dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
    expect(messages[0]?.missing).toEqual([
      { kind: 'image', reason: expect.stringContaining('inline base64') },
    ]);
  });

  it('images inside a tool result are obtainable attachments of the owner message', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      userMsg('screenshot', { id: 'm1' }),
      assistantMsg([{ type: 'toolCall', id: 'call_2', name: 'bash', arguments: {} }], { id: 'a1', parentId: 'm1' }),
      toolResultMsg('call_2', [
        { type: 'text', text: 'captured' },
        { type: 'image', image: 'aGVsbG8=', mimeType: 'image/png' },
      ], { parentId: 'a1' }),
    ].join('\n');
    const { messages } = parsePiSession(text);
    const owner = messages.find((m) => m.toolCalls.length > 0)!;
    expect(owner.toolCalls[0]?.output).toBe('captured');
    expect(owner.images).toEqual([{ dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  });

  it('compaction entries are excluded WITHOUT a warning — never a history replacement', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      userMsg('before compaction', { id: 'm1' }),
      JSON.stringify({ type: 'compaction', id: 'k1', parentId: 'm1', timestamp: '2026-10-11T08:00:02.000Z', summary: 'model-context summary' }),
      userMsg('after compaction', { parentId: 'k1' }),
    ].join('\n');
    const { messages, warnings } = parsePiSession(text);
    expect(messages.map((m) => m.content)).toEqual(['before compaction', 'after compaction']);
    expect(warnings).toEqual([]); // known bookkeeping — not noise
  });

  it('known bookkeeping entry kinds on the branch are skipped silently, never displayed', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      JSON.stringify({ type: 'model_change', id: 'mc', parentId: 's1', timestamp: '2026-10-11T08:00:00.500Z', model: 'm' }),
      userMsg('hello', { id: 'm1', parentId: 'mc' }),
      JSON.stringify({ type: 'custom', customType: 'web-search-results', id: 'cu', parentId: 'm1', timestamp: '2026-10-11T08:00:01.500Z', data: {} }),
      JSON.stringify({ type: 'thinking_level_change', id: 'tl', parentId: 'cu', timestamp: '2026-10-11T08:00:02.000Z' }),
    ].join('\n');
    const { messages, warnings } = parsePiSession(text);
    expect(messages.map((m) => m.content)).toEqual(['hello']);
    expect(warnings).toEqual([]);
  });

  it('genuinely unknown entry kinds on the branch are counted in warnings, never displayed', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      JSON.stringify({ type: 'some-new-kind', id: 'nk', parentId: 's1', timestamp: '2026-10-11T08:00:00.500Z' }),
      userMsg('hello', { id: 'm1', parentId: 'nk' }),
    ].join('\n');
    const { messages, warnings } = parsePiSession(text);
    expect(messages.map((m) => m.content)).toEqual(['hello']);
    const warn = warnings.find((w) => w.includes('not displayed'));
    expect(warn).toContain('some-new-kind×1');
  });

  it('a torn trailing line is skipped with a warning; earlier records stay intact', () => {
    const torn = forkedSession() + '\n{"type":"message","id":"x","par';
    const { messages, warnings } = parsePiSession(torn);
    expect(messages.map((m) => m.content)).toEqual(['how does the branch reader work?', 'mainline direction']);
    expect(warnings.some((w) => w.includes('incomplete'))).toBe(true);
  });

  it('a tool result without a matching call warns instead of crashing', () => {
    seq = 0;
    const text = [
      header('s1', '/w'),
      toolResultMsg('call_ghost', [{ type: 'text', text: 'orphan' }], { parentId: 's1' }),
    ].join('\n');
    const { messages, warnings } = parsePiSession(text);
    expect(messages).toHaveLength(0);
    expect(warnings.some((w) => w.includes('without a matching call'))).toBe(true);
  });
});

describe('readPiSession', () => {
  it('reads fresh detail with branch info, refines the title, and keeps verbatim evidence', async () => {
    const file = `${ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;
    const files = { [file]: forkedSession() };
    const summary: ExternalSessionSummary = {
      source: 'pi',
      sessionId: 'ccccccc0-0000-0000-0000-000000000001',
      filePath: file,
      title: '', // no head-scan title (simulated legacy summary)
      cwd: null,
      startedAt: null,
      updatedAt: null,
      parentSessionId: null,
    };
    const detail = await readPiSession(summary, createMemFs(files));
    expect(detail.summary.cwd).toBe('/work/delta');
    expect(detail.summary.startedAt).toBe(Date.parse('2026-10-11T08:00:00.000Z'));
    expect(detail.summary.title).toBe('how does the branch reader work?'); // first user text, 48-char bound
    expect(detail.messages.map((m) => m.content)).toEqual(['how does the branch reader work?', 'mainline direction']);
    expect(detail.branch.all.map((b) => b.id)).toEqual(['c1', 'b1']);
    expect(detail.messages[0]?.rawRecord).toContain('how does the branch reader work?');

    // explicit branch read: fresh re-projection of the SAME source
    const alt = await readPiSession(summary, createMemFs(files), 'b1');
    expect(alt.messages.map((m) => m.content)).toEqual(['how does the branch reader work?', 'alt direction']);
    expect(alt.branch.currentId).toBe('b1');
  });
});
