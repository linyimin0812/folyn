/**
 * Behavior tests for the Codex rollout reader (discovery + projection).
 * Synthetic fixtures only — never personal transcripts.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverCodexSessions,
  parseCodexRollout,
  readCodexSession,
  sessionIdFromFilename,
  type CodexSessionFs,
} from './codexSessions';
import type { ExternalSessionSummary } from './types';

function createMemFs(files: Record<string, string>): CodexSessionFs {
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
  };
}

/** Build one rollout record line. */
function rec(type: string, payload: unknown, timestamp = '2026-10-10T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp, type, payload });
}

function meta(sessionId: string, cwd: string): string {
  return rec('session_meta', { session_id: sessionId, timestamp: '2026-10-10T09:00:00.000Z', cwd });
}

function userMsg(id: number, text: string, kinds: string[] | null = ['user.text']): string {
  const passthrough = kinds ? { internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } } : {};
  return rec(
    'response_item',
    { type: 'message', id: `msg_${id}`, role: 'user', content: [{ type: 'input_text', text }], ...passthrough },
    '2026-10-10T10:00:01.000Z',
  );
}

function asstMsg(id: number, text: string): string {
  return rec(
    'response_item',
    { type: 'message', id: `msg_${id}`, role: 'assistant', content: [{ type: 'output_text', text }] },
    '2026-10-10T10:00:02.000Z',
  );
}

const ROOT = '/home/u/.codex';

describe('discoverCodexSessions', () => {
  it('lists sessions across projects (cwd), active dir and archive, with index titles', async () => {
    const files: Record<string, string> = {
      [`${ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-11111111-2222-3333-4444-555555555555.jsonl`]:
        meta('11111111-2222-3333-4444-555555555555', '/work/alpha') + '\n' + userMsg(1, 'hello alpha'),
      [`${ROOT}/sessions/2026/10/09/rollout-2026-10-09T08-00-00-aaaaaaa0-0000-0000-0000-000000000001.jsonl`]:
        meta('aaaaaaa0-0000-0000-0000-000000000001', '/work/beta') + '\n' + userMsg(1, 'hello beta'),
      [`${ROOT}/archived_sessions/rollout-2026-07-08T20-09-47-bbbbbbb0-0000-0000-0000-000000000002.jsonl`]:
        meta('bbbbbbb0-0000-0000-0000-000000000002', '/work/beta') + '\n' + userMsg(1, 'archived'),
      [`${ROOT}/session_index.jsonl`]:
        `${JSON.stringify({ id: '11111111-2222-3333-4444-555555555555', thread_name: 'Fix login', updated_at: '2026-10-10T23:00:00.000Z' })}\n` +
        JSON.stringify({ id: 'aaaaaaa0-0000-0000-0000-000000000001', thread_name: 'Beta work', updated_at: '2026-10-09T09:00:00.000Z' }),
    };
    const { sessions, errors } = await discoverCodexSessions(ROOT, createMemFs(files));
    expect(errors).toEqual([]);
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.cwd).sort()).toEqual(['/work/alpha', '/work/beta', '/work/beta']);
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    expect(byId.get('11111111-2222-3333-4444-555555555555')?.title).toBe('Fix login');
    expect(byId.get('bbbbbbb0-0000-0000-0000-000000000002')?.title).toBe('2026-07-08 20:09'); // filename fallback
    // newest first
    expect(sessions[0]?.sessionId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('missing roots are an empty source, not an error', async () => {
    const { sessions, errors } = await discoverCodexSessions(ROOT, createMemFs({}));
    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('an unreadable file is reported per source without dropping the rest', async () => {
    const good = `${ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-11111111-2222-3333-4444-555555555555.jsonl`;
    const files: Record<string, string> = { [good]: meta('11111111-2222-3333-4444-555555555555', '/work/alpha') };
    const fs = createMemFs(files);
    // The listing promises a second file that does not exist → read fails.
    const fsWithGhost: CodexSessionFs = {
      ...fs,
      listJsonlFiles: async (dir) => [...(await fs.listJsonlFiles(dir)), `${dir}/rollout-x.jsonl`],
    };
    const { sessions, errors } = await discoverCodexSessions(ROOT, fsWithGhost);
    expect(sessions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('rollout-x.jsonl');
  });

  it('a session duplicated in active + archive resolves to the active file', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    const active = `${ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-${sid}.jsonl`;
    const archived = `${ROOT}/archived_sessions/rollout-2026-10-10T22-12-33-${sid}.jsonl`;
    const files = {
      [active]: meta(sid, '/work/alpha'),
      [archived]: meta(sid, '/work/alpha'),
    };
    const { sessions } = await discoverCodexSessions(ROOT, createMemFs(files));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.filePath).toBe(active);
  });

  it('derives the session id from the filename when session_meta lacks one', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    const file = `${ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-${sid}.jsonl`;
    const files = { [file]: rec('session_meta', { cwd: '/work/alpha' }) };
    const { sessions } = await discoverCodexSessions(ROOT, createMemFs(files));
    expect(sessions[0]?.sessionId).toBe(sid);
  });
});

describe('parseCodexRollout', () => {
  const baseRollout = [
    meta('11111111-2222-3333-4444-555555555555', '/work/alpha'),
    // injected context — kinds without user.text → excluded from projection
    userMsg(1, '# AGENTS.md instructions', ['agents_md.instructions']),
    rec('event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'hello' }] } }),
    userMsg(2, 'hello'),
    asstMsg(3, 'hi there'),
    rec('response_item', { type: 'reasoning', encrypted_content: 'gAAA' }),
    rec('response_item', { type: 'function_call', call_id: 'call_1', name: 'exec', input: '{"cmd":"ls"}' }, '2026-10-10T10:00:03.000Z'),
    rec('response_item', { type: 'function_call_output', call_id: 'call_1', output: '{"output":"file1\\nfile2"}' }, '2026-10-10T10:00:04.000Z'),
  ].join('\n');

  it('extracts user/assistant messages, drops injected context and event duplicates', () => {
    const { messages } = parseCodexRollout(baseRollout);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'hi there'],
    ]);
  });

  it('correlates tool call + result via call_id and attaches them to the assistant message', () => {
    const { messages } = parseCodexRollout(baseRollout);
    const asst = messages.find((m) => m.role === 'assistant');
    expect(asst?.toolCalls).toHaveLength(1);
    expect(asst?.toolCalls[0]).toMatchObject({ callId: 'call_1', name: 'exec', input: '{"cmd":"ls"}', output: 'file1\nfile2' });
    // raw evidence lines: the call AND its output record
    expect(asst?.rawToolRecords).toHaveLength(2);
  });

  it('a tool call without a result is a missing tool-output, never guessed', () => {
    const rollout = [
      meta('s', '/w'),
      asstMsg(1, 'working'),
      rec('response_item', { type: 'custom_tool_call', call_id: 'call_9', name: 'shell', input: 'ls' }),
    ].join('\n');
    const { messages } = parseCodexRollout(rollout);
    expect(messages[0]?.toolCalls[0]?.output).toBeNull();
    expect(messages[0]?.missing).toEqual([
      { kind: 'tool-output', reason: expect.stringContaining('call_9') },
    ]);
  });

  it('inline data-URL images are obtainable; file-id references are missing with a reason', () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8=';
    const rollout = [
      meta('s', '/w'),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [
          { type: 'input_text', text: 'look ' },
          { type: 'input_image', image_url: dataUrl },
          { type: 'input_image', image_url: 'file_id:fs_123' },
        ],
      }),
    ].join('\n');
    const { messages } = parseCodexRollout(rollout);
    expect(messages[0]?.content).toBe('look ');
    expect(messages[0]?.images).toEqual([{ dataUrl }]);
    expect(messages[0]?.missing).toEqual([
      { kind: 'image', reason: expect.stringContaining('file reference') },
    ]);
  });

  it('a torn trailing line is skipped with a warning; earlier records stay intact', () => {
    const torn = baseRollout + '\n{"timestamp":"2026-10-10T1';
    const { messages, warnings } = parseCodexRollout(torn);
    expect(messages).toHaveLength(2);
    expect(warnings.some((w) => w.includes('incomplete'))).toBe(true);
  });

  it('genuinely unknown record types are counted in warnings, not displayed', () => {
    const rollout = baseRollout + '\n' + rec('response_item', { type: 'some_new_kind', id: 'w1' });
    const { messages, warnings } = parseCodexRollout(rollout);
    expect(messages).toHaveLength(2);
    expect(warnings.some((w) => w.includes('some_new_kind'))).toBe(true);
  });

  it('known non-displayable payload types (reasoning, agent_message, web_search_call, …) yield NO warnings', () => {
    const rollout = [
      baseRollout,
      rec('response_item', { type: 'reasoning', encrypted_content: 'gAAA' }),
      rec('response_item', { type: 'reasoning', encrypted_content: 'gAAB' }),
      // agent_message: subagent task-delegation frames (author/recipient
      // routing + encrypted_content) — expected machinery, not drift
      rec('response_item', { type: 'agent_message', author: '/root', recipient: '/root/agent1', encrypted_content: 'gAAC' }),
      rec('response_item', { type: 'web_search_call', id: 'w1' }),
      rec('response_item', { type: 'local_shell_call', id: 'w2' }),
    ].join('\n');
    const { messages, warnings } = parseCodexRollout(rollout);
    expect(messages).toHaveLength(2);
    expect(warnings).toEqual([]); // reasoning appears in every real rollout — not noise
  });
});

describe('readCodexSession', () => {
  it('reads fresh detail and refines an index-less title from the first user message', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    const file = `${ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-${sid}.jsonl`;
    const files = {
      [file]: [
        meta(sid, '/work/alpha'),
        userMsg(1, 'How do I upgrade this thing properly?'),
        asstMsg(2, 'run the installer'),
      ].join('\n'),
    };
    const summary: ExternalSessionSummary = {
      source: 'codex',
      sessionId: sid,
      filePath: file,
      title: '', // no index entry
      cwd: null,
      startedAt: null,
      updatedAt: null,
      parentSessionId: null,
    };
    const detail = await readCodexSession(summary, createMemFs(files));
    expect(detail.summary.title).toBe('How do I upgrade this thing properly?');
    expect(detail.summary.cwd).toBe('/work/alpha');
    expect(detail.messages).toHaveLength(2);
    // the raw line is retained verbatim for evidence
    expect(detail.messages[0]?.rawRecord).toContain('How do I upgrade this thing properly?');
  });
});

describe('sessionIdFromFilename', () => {
  it('extracts the trailing uuid', () => {
    expect(sessionIdFromFilename('/x/rollout-2026-10-10T22-12-33-11111111-2222-3333-4444-555555555555.jsonl')).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(sessionIdFromFilename('/x/not-a-rollout.jsonl')).toBeNull();
  });
});
