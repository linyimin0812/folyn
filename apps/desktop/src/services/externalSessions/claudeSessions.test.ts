/**
 * Behavior tests for the Claude Code transcript reader (discovery +
 * projection). Synthetic fixtures only — never personal transcripts.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverClaudeSessions,
  parseClaudeTranscript,
  readClaudeSession,
  type ClaudeSessionFs,
} from './claudeSessions';
import type { ExternalSessionSummary } from './types';

function createMemFs(
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
): ClaudeSessionFs {
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

// ── Synthetic fixture builders (flat records, machine-verified shape) ─────────

const BASE = {
  parentUuid: null,
  sessionId: '11111111-2222-3333-4444-555555555555',
  cwd: '/work/alpha',
  version: '2.1.296',
  gitBranch: 'master',
  isSidechain: false,
  userType: 'external',
};

function entry(type: string, extra: Record<string, unknown>, timestamp = '2026-10-10T10:00:00.000Z'): string {
  return JSON.stringify({ ...BASE, type, timestamp, ...extra });
}

function userText(text: string, opts: { isMeta?: boolean; isSidechain?: boolean } = {}): string {
  return entry('user', { message: { role: 'user', content: text }, ...opts }, '2026-10-10T10:00:01.000Z');
}

function userToolResult(toolUseId: string, content: unknown): string {
  return entry(
    'user',
    { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] }, toolUseResult: {} },
    '2026-10-10T10:00:03.000Z',
  );
}

function assistantBlocks(blocks: unknown[]): string {
  return entry('assistant', { message: { role: 'assistant', model: 'test-model', content: blocks } }, '2026-10-10T10:00:02.000Z');
}

function toolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return { type: 'tool_use', id, name, input };
}

const ROOT = '/home/u/.claude/projects';

// A transcript with the full observed shape: typed prompt, assistant
// text+thinking+tool_use, correlated tool_result with images.
const baseTranscript = [
  userText('how do I parse the rollout format?'),
  assistantBlocks([
    { type: 'thinking', thinking: 'internal reasoning', signature: '' },
    { type: 'text', text: 'let me look at the reader' },
    toolUse('toolu_1', 'Read', { file_path: '/src/reader.ts' }),
  ]),
  userToolResult('toolu_1', 'export function read() {}'),
  assistantBlocks([{ type: 'text', text: 'the reader is at /src/reader.ts' }]),
].join('\n');

describe('discoverClaudeSessions', () => {
  it('lists sessions across projects with cwd from records, never decoded from the slug', async () => {
    // Slugs are lossy encodings — the second project's slug does NOT round-trip
    // to its cwd. Only the records' own cwd field is authoritative.
    const files: Record<string, string> = {
      [`${ROOT}/-work-alpha/11111111-2222-3333-4444-555555555555.jsonl`]: baseTranscript,
      [`${ROOT}/-work-alpha-0-x-y/99999999-8888-7777-6666-555555555555.jsonl`]: [
        entry('user', { message: { role: 'user', content: 'beta prompt' }, sessionId: '99999999-8888-7777-6666-555555555555' }, '2026-10-09T09:00:00.000Z'),
      ].join('\n'),
    };
    const mtimes: Record<string, number> = {
      [`${ROOT}/-work-alpha/11111111-2222-3333-4444-555555555555.jsonl`]: Date.parse('2026-10-10T23:00:00Z'),
    };
    const { sessions, errors } = await discoverClaudeSessions(ROOT, createMemFs(files, mtimes));
    expect(errors).toEqual([]);
    expect(sessions).toHaveLength(2);
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    expect(byId.get('11111111-2222-3333-4444-555555555555')?.cwd).toBe('/work/alpha');
    expect(byId.get('99999999-8888-7777-6666-555555555555')?.cwd).toBe('/work/alpha');
    // mtime backs updatedAt; newest first
    expect(sessions[0]?.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(sessions[0]?.updatedAt).toBe(Date.parse('2026-10-10T23:00:00Z'));
    // title falls back to the first typed prompt (no title entry)
    expect(sessions[0]?.title).toBe('how do I parse the rollout format?');
    expect(sessions[0]?.startedAt).toBe(Date.parse('2026-10-10T10:00:01.000Z'));
  });

  it('uses a custom-title entry when present', async () => {
    const file = `${ROOT}/-work-alpha/11111111-2222-3333-4444-555555555555.jsonl`;
    const files = {
      [file]: [
        entry('custom-title', { title: 'Rollout parsing' }),
        userText('how do I parse the rollout format?'),
      ].join('\n'),
    };
    const { sessions } = await discoverClaudeSessions(ROOT, createMemFs(files));
    expect(sessions[0]?.title).toBe('Rollout parsing');
  });

  it('a missing root is an empty source, not an error', async () => {
    const { sessions, errors } = await discoverClaudeSessions(ROOT, createMemFs({}));
    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('an unreadable file is reported without dropping the rest', async () => {
    const good = `${ROOT}/-work-alpha/11111111-2222-3333-4444-555555555555.jsonl`;
    const files = { [good]: baseTranscript };
    const fs = createMemFs(files);
    const fsWithGhost: ClaudeSessionFs = {
      ...fs,
      listJsonlFiles: async (dir) => [...(await fs.listJsonlFiles(dir)), `${dir}/ghost.jsonl`],
    };
    const { sessions, errors } = await discoverClaudeSessions(ROOT, fsWithGhost);
    expect(sessions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ghost.jsonl');
  });

  it('a session id duplicated across project dirs resolves deterministically', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    const a = `${ROOT}/-work-alpha/${sid}.jsonl`;
    const b = `${ROOT}/-work-zeta/${sid}.jsonl`; // sorts after -work-alpha
    const files = { [a]: baseTranscript, [b]: baseTranscript };
    const { sessions } = await discoverClaudeSessions(ROOT, createMemFs(files));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.filePath).toBe(a); // first sorted path wins
  });
});

describe('parseClaudeTranscript', () => {
  it('projects typed prompts and assistant text; thinking blocks are display-hidden', () => {
    const { messages } = parseClaudeTranscript(baseTranscript);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'how do I parse the rollout format?'],
      ['assistant', 'let me look at the reader'],
      ['assistant', 'the reader is at /src/reader.ts'],
    ]);
  });

  it('correlates tool_use + tool_result by id and serializes the input object', () => {
    const { messages } = parseClaudeTranscript(baseTranscript);
    const owner = messages.find((m) => m.role === 'assistant' && m.toolCalls.length > 0);
    expect(owner?.toolCalls[0]).toMatchObject({
      callId: 'toolu_1',
      name: 'Read',
      input: '{"file_path":"/src/reader.ts"}',
      output: 'export function read() {}',
    });
    // raw evidence lines: the tool_use entry (rawRecord) AND the tool_result entry
    expect(owner?.rawToolRecords).toHaveLength(1);
    expect(owner?.rawToolRecords[0]).toContain('tool_result');
  });

  it('interleaved tool_use/tool_result pairs correlate by id, out of file order', () => {
    const transcript = [
      userText('run both'),
      assistantBlocks([toolUse('toolu_1', 'Read', { file_path: '/a' })]),
      assistantBlocks([toolUse('toolu_2', 'Bash', { command: 'ls' })]),
      userToolResult('toolu_2', 'ls output'), // result 2 arrives BEFORE result 1
      userToolResult('toolu_1', 'a content'),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    const first = messages.find((m) => m.toolCalls.some((c) => c.callId === 'toolu_1'))!;
    const second = messages.find((m) => m.toolCalls.some((c) => c.callId === 'toolu_2'))!;
    expect(first.toolCalls[0]?.output).toBe('a content');
    expect(second.toolCalls[0]?.output).toBe('ls output');
    // verbatim evidence follows its own call id, not file order
    expect(first.rawToolRecords[0]).toContain('toolu_1');
    expect(second.rawToolRecords[0]).toContain('toolu_2');
  });

  it('a tool_use without a result is a missing tool-output, never guessed', () => {
    const transcript = [
      userText('run it'),
      assistantBlocks([toolUse('toolu_9', 'Bash', { command: 'ls' })]),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    expect(messages[1]?.toolCalls[0]?.output).toBeNull();
    expect(messages[1]?.missing).toEqual([
      { kind: 'tool-output', reason: expect.stringContaining('toolu_9') },
    ]);
  });

  it('images inside a tool_result are obtainable attachments of the owner message', () => {
    const transcript = [
      userText('screenshot the bug'),
      assistantBlocks([toolUse('toolu_2', 'Bash', { command: 'screencapture' })]),
      userToolResult('toolu_2', [
        { type: 'text', text: 'captured' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
        { type: 'image', source: { type: 'file_reference', media_type: 'image/png' } },
      ]),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    const owner = messages.find((m) => m.toolCalls.length > 0);
    expect(owner?.toolCalls[0]?.output).toBe('captured');
    expect(owner?.images).toEqual([{ dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
    expect(owner?.missing).toEqual([
      { kind: 'image', reason: expect.stringContaining('inline base64') },
    ]);
  });

  it('inline image blocks in a user message become data URLs; missing data is explicit', () => {
    const transcript = [
      entry('user', {
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at ' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } },
          ],
        },
      }),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    expect(messages[0]?.content).toBe('look at ');
    expect(messages[0]?.images).toEqual([{ dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }]);
  });

  it('isMeta user entries (injected context) are excluded', () => {
    const transcript = [
      userText('<local-command-caveat>Caveat: local commands</local-command-caveat>', { isMeta: true }),
      userText('real question'),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    expect(messages.map((m) => m.content)).toEqual(['real question']);
  });

  it('sidechain (subagent) records are excluded and noted', () => {
    const transcript = [
      userText('question'),
      entry('assistant', {
        isSidechain: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'subagent work' }] },
      }),
      assistantBlocks([{ type: 'text', text: 'main answer' }]),
    ].join('\n');
    const { messages, warnings } = parseClaudeTranscript(transcript);
    expect(messages.map((m) => m.content)).toEqual(['question', 'main answer']);
    expect(warnings.some((w) => w.includes('sidechain'))).toBe(true);
  });

  it('a torn trailing line is skipped with a warning; earlier records stay intact', () => {
    const torn = baseTranscript + '\n{"type":"user","message":{"role":"user","con';
    const { messages, warnings } = parseClaudeTranscript(torn);
    expect(messages).toHaveLength(3);
    expect(warnings.some((w) => w.includes('incomplete'))).toBe(true);
  });

  it('genuinely unknown entry types are counted in warnings, never fatal', () => {
    const transcript = [
      entry('some-new-type', { data: 'drift' }),
      userText('still readable'),
    ].join('\n');
    const { messages, warnings } = parseClaudeTranscript(transcript);
    expect(messages.map((m) => m.content)).toEqual(['still readable']);
    const unknown = warnings.find((w) => w.includes('unsupported record types'));
    expect(unknown).toContain('some-new-type×1');
  });

  it('known bookkeeping entry types (attachment, system, cost-state, file-history-*, …) yield NO warnings', () => {
    const transcript = [
      entry('attachment', { attachment: { type: 'hook_success', content: 'hook output' } }),
      entry('system', { content: 'compact boundary', level: 'info' }),
      entry('file-history-snapshot', { snapshot: 's1' }),
      entry('cost-state', { total: 1 }),
      userText('still readable'),
    ].join('\n');
    const { messages, warnings } = parseClaudeTranscript(transcript);
    expect(messages.map((m) => m.content)).toEqual(['still readable']);
    expect(warnings).toEqual([]);
  });

  it('a tool_result without a matching call warns instead of crashing', () => {
    const transcript = [userToolResult('toolu_ghost', 'orphan output')].join('\n');
    const { messages, warnings } = parseClaudeTranscript(transcript);
    expect(messages).toHaveLength(0);
    expect(warnings.some((w) => w.includes('without a matching call'))).toBe(true);
  });
});

describe('readClaudeSession', () => {
  it('reads fresh detail, refines the title, and retains verbatim evidence', async () => {
    const file = `${ROOT}/-work-alpha/11111111-2222-3333-4444-555555555555.jsonl`;
    const files = { [file]: baseTranscript };
    const summary: ExternalSessionSummary = {
      source: 'claude',
      sessionId: '11111111-2222-3333-4444-555555555555',
      filePath: file,
      title: '', // no title entry
      cwd: null, // head scan missed (simulated legacy summary)
      startedAt: null,
      updatedAt: null,
      parentSessionId: null,
    };
    const detail = await readClaudeSession(summary, createMemFs(files));
    expect(detail.summary.title).toBe('how do I parse the rollout format?');
    expect(detail.summary.cwd).toBe('/work/alpha');
    expect(detail.summary.startedAt).toBe(Date.parse('2026-10-10T10:00:01.000Z'));
    expect(detail.messages).toHaveLength(3);
    expect(detail.messages[0]?.rawRecord).toContain('how do I parse the rollout format?');
    const owner = detail.messages.find((m) => m.toolCalls.length > 0);
    expect(owner?.rawToolRecords[0]).toContain('tool_result');
  });
});
