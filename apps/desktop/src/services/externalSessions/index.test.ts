/**
 * Tests for the externalSessions entrypoint: multi-source discovery
 * aggregation with per-source error isolation, and source-dispatched reads
 * (incl. pi branch selection, slice 3).
 */
import { describe, it, expect } from 'vitest';
import { discoverExternalSessions, readExternalSession } from './index';
import { parseClaudeTranscript } from './claudeSessions';
import { parseCodexRollout } from './codexSessions';
import { parsePiSession } from './piSessions';
import type { ClaudeSessionFs } from './claudeSessions';
import type { CodexSessionFs } from './codexSessions';
import type { ExternalSessionSummary } from './types';

const CODEX_ROOT = '/home/u/.codex';
const CLAUDE_ROOT = '/home/u/.claude/projects';
const PI_ROOT = '/home/u/.pi/agent/sessions';

function createCodexFs(files: Record<string, string>): CodexSessionFs {
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

function createClaudeFs(files: Record<string, string>, mtimes: Record<string, number> = {}): ClaudeSessionFs {
  const base = createCodexFs(files);
  return { ...base, mtime: async (p) => (p in mtimes ? mtimes[p]! : null) };
}

const codexRollout = [
  JSON.stringify({
    timestamp: '2026-10-10T10:00:00.000Z', type: 'session_meta',
    payload: { session_id: '11111111-2222-3333-4444-555555555555', cwd: '/work/alpha', timestamp: '2026-10-10T09:00:00.000Z' },
  }),
  JSON.stringify({
    timestamp: '2026-10-10T10:00:01.000Z', type: 'response_item',
    payload: {
      type: 'message', id: 'm1', role: 'user',
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
      content: [{ type: 'input_text', text: 'codex prompt' }],
    },
  }),
].join('\n');

const claudeTranscript = [
  JSON.stringify({
    type: 'user', sessionId: 'aaaaaaa0-0000-0000-0000-000000000001', cwd: '/work/gamma',
    timestamp: '2026-10-09T09:00:00.000Z', isSidechain: false,
    message: { role: 'user', content: 'claude prompt' },
  }),
].join('\n');

// Synthetic pi v3 session (machine-verified shape) with one fork.
const piSession = [
  JSON.stringify({ type: 'session', version: 3, id: 'ccccccc0-0000-0000-0000-000000000001', timestamp: '2026-10-11T08:00:00.000Z', cwd: '/work/delta' }),
  JSON.stringify({ type: 'message', id: 'm1', parentId: 'ccccccc0-0000-0000-0000-000000000001', timestamp: '2026-10-11T08:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'pi prompt' }] } }),
  JSON.stringify({ type: 'message', id: 'b1', parentId: 'm1', timestamp: '2026-10-11T08:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'alt branch' }] } }),
  JSON.stringify({ type: 'message', id: 'c1', parentId: 'm1', timestamp: '2026-10-11T08:00:03.000Z', message: { role: 'user', content: [{ type: 'text', text: 'mainline branch' }] } }),
].join('\n');

const codexFile = `${CODEX_ROOT}/sessions/2026/10/10/rollout-2026-10-10T22-12-33-11111111-2222-3333-4444-555555555555.jsonl`;
const claudeFile = `${CLAUDE_ROOT}/-work-gamma/aaaaaaa0-0000-0000-0000-000000000001.jsonl`;
const piFile = `${PI_ROOT}/-work-delta/2026-10-11T08-00-00-000Z_ccccccc0-0000-0000-0000-000000000001.jsonl`;

const ROOTS = { codex: CODEX_ROOT, claude: CLAUDE_ROOT, pi: PI_ROOT };

const PI_SUMMARY: ExternalSessionSummary = {
  source: 'pi',
  sessionId: 'ccccccc0-0000-0000-0000-000000000001',
  filePath: piFile,
  title: '',
  cwd: null,
  startedAt: null,
  updatedAt: null,
  parentSessionId: null,
};

describe('discoverExternalSessions', () => {
  it('unions codex, claude and pi sessions, newest first', async () => {
    const ports = {
      codex: createCodexFs({ [codexFile]: codexRollout }),
      claude: createClaudeFs({ [claudeFile]: claudeTranscript }),
      pi: createClaudeFs({ [piFile]: piSession }, { [piFile]: Date.parse('2026-10-11T09:00:00Z') }),
    };
    const { sessions, errors } = await discoverExternalSessions(ports, ROOTS);
    expect(errors).toEqual([]);
    expect(sessions.map((s) => s.source)).toEqual(['pi', 'codex', 'claude']);
    // pi (mtime 2026-10-11) sorts before codex (2026-10-10) and claude (2026-10-09)
    expect(sessions[0]?.sessionId).toBe('ccccccc0-0000-0000-0000-000000000001');
    expect(sessions[0]?.cwd).toBe('/work/delta');
  });

  it('a codex failure does not remove the claude source from the list, and vice versa', async () => {
    // the port explodes on ANY call (e.g. permission denied at the root)
    function explodingFs(): CodexSessionFs {
      const boom = async (): Promise<never> => { throw new Error('EACCES'); };
      return { readLines: boom, readTextFile: boom, listJsonlFiles: boom, exists: boom };
    }
    const { sessions, errors } = await discoverExternalSessions(
      { codex: explodingFs(), claude: createClaudeFs({ [claudeFile]: claudeTranscript }), pi: createClaudeFs({}) },
      ROOTS,
    );
    expect(sessions.map((s) => s.source)).toEqual(['claude']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('codex');
    expect(errors[0]).toContain('EACCES');

    // reverse direction: claude explodes, codex stays
    const explodingClaude: ClaudeSessionFs = { ...explodingFs(), mtime: async () => null };
    const r2 = await discoverExternalSessions(
      { codex: createCodexFs({ [codexFile]: codexRollout }), claude: explodingClaude, pi: createClaudeFs({}) },
      ROOTS,
    );
    expect(r2.sessions.map((s) => s.source)).toEqual(['codex']);
    expect(r2.errors).toHaveLength(1);
    expect(r2.errors[0]).toContain('claude');
  });

  it('a pi failure does not remove the codex/claude sources from the list', async () => {
    const boom = async (): Promise<never> => { throw new Error('EACCES'); };
    const explodingPi: ClaudeSessionFs = {
      readLines: boom, readTextFile: boom, listJsonlFiles: boom, exists: boom, mtime: async () => null,
    };
    const { sessions, errors } = await discoverExternalSessions(
      { codex: createCodexFs({ [codexFile]: codexRollout }), claude: createClaudeFs({ [claudeFile]: claudeTranscript }), pi: explodingPi },
      ROOTS,
    );
    expect(sessions.map((s) => s.source)).toEqual(['codex', 'claude']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('pi');
    expect(errors[0]).toContain('EACCES');
  });

  it('all roots missing yields an empty list with no errors', async () => {
    const { sessions, errors } = await discoverExternalSessions(
      { codex: createCodexFs({}), claude: createClaudeFs({}), pi: createClaudeFs({}) },
      ROOTS,
    );
    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('readExternalSession', () => {
  it('dispatches by source to the right reader; branchId selects the pi branch', async () => {
    const claudeSummary: ExternalSessionSummary = {
      source: 'claude',
      sessionId: 'aaaaaaa0-0000-0000-0000-000000000001',
      filePath: claudeFile,
      title: '',
      cwd: null,
      startedAt: null,
      updatedAt: null,
      parentSessionId: null,
    };
    const detail = await readExternalSession(claudeSummary, createClaudeFs({ [claudeFile]: claudeTranscript }));
    expect(detail.summary.source).toBe('claude');
    expect(detail.messages[0]?.content).toBe('claude prompt');
    expect(detail.summary.title).toBe('claude prompt');
    // linear source reports the single trivial branch
    expect(detail.branch.all).toHaveLength(1);

    const codexSummary: ExternalSessionSummary = {
      source: 'codex',
      sessionId: '11111111-2222-3333-4444-555555555555',
      filePath: codexFile,
      title: '',
      cwd: null,
      startedAt: null,
      updatedAt: null,
      parentSessionId: null,
    };
    const detail2 = await readExternalSession(codexSummary, createClaudeFs({ [codexFile]: codexRollout }));
    expect(detail2.summary.source).toBe('codex');
    expect(detail2.messages[0]?.content).toBe('codex prompt');

    // pi: default read projects the mainline (last child) branch
    const fs = createClaudeFs({ [piFile]: piSession });
    const piDefault = await readExternalSession(PI_SUMMARY, fs);
    expect(piDefault.messages.map((m) => m.content)).toEqual(['pi prompt', 'mainline branch']);
    expect(piDefault.branch.currentId).toBe('c1');
    expect(piDefault.branch.all.map((b) => b.id)).toEqual(['c1', 'b1']);
    // explicit branchId re-projects onto that branch
    const piAlt = await readExternalSession(PI_SUMMARY, fs, 'b1');
    expect(piAlt.messages.map((m) => m.content)).toEqual(['pi prompt', 'alt branch']);
    expect(piAlt.branch.currentId).toBe('b1');
    // a vanished branch id throws — never silently retargets
    await expect(readExternalSession(PI_SUMMARY, fs, 'gone')).rejects.toThrow('no longer exists');
  });
});

// ── Slice 7: cross-source release sweep ────────────────────────────────────

describe('cross-source release sweep (slice 7)', () => {
  it('a torn trailing record in ANY source is skipped with a warning; earlier records stay intact', () => {
    // A half-written trailing line per source shape (in-progress write).
    const cases: Array<{ source: string; text: string; torn: string; messages: string[] }> = [
      {
        source: 'codex',
        text: codexRollout,
        torn: '{"timestamp": "2026-10-10T10:0',
        messages: ['codex prompt'],
      },
      {
        source: 'claude',
        text: claudeTranscript,
        torn: '{"type":"user","message":{"role":"user","con',
        messages: ['claude prompt'],
      },
      {
        source: 'pi',
        text: piSession,
        torn: '{"type":"message","id":"x","par',
        messages: ['pi prompt', 'mainline branch'],
      },
    ];
    for (const { source, text, torn, messages } of cases) {
      const full = `${text}\n${torn}`;
      const parsed =
        source === 'codex' ? parseCodexRollout(full)
          : source === 'claude' ? parseClaudeTranscript(full)
            : parsePiSession(full);
      expect(parsed.messages.map((m) => m.content), `${source}: earlier records intact`).toEqual(messages);
      expect(
        parsed.warnings.some((w) => w.includes('incomplete')),
        `${source}: the torn record is reported, never silently dropped`,
      ).toBe(true);
    }
  });
});
