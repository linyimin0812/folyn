/**
 * Behavior tests for verbatim capture: note + evidence bundle contents,
 * publish-after-evidence write order, byte-identical assets, missing
 * material, conflicts, write failures, and source-deletion survival.
 */
import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import {
  saveVerbatimCapture,
  sanitizeFilename,
  CaptureConflictError,
  StaleSelectionError,
  verifySelectionFresh,
  type CaptureWritePort,
} from './captureService';
import { parseCodexRollout } from './codexSessions';
import { parseClaudeTranscript } from './claudeSessions';
import { parsePiSession } from './piSessions';
import { LINEAR_BRANCH } from './types';
import type { ExternalSessionDetail, ExternalSessionSummary } from './types';
import { parseSourceLocator } from './sourceLocator';

function createMemPort(): CaptureWritePort & {
  text: Map<string, string>;
  bytes: Map<string, Uint8Array>;
  dirs: string[];
  writeOrder: string[];
  failOn: (path: string) => void;
} {
  const text = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  const writeOrder: string[] = [];
  let failing = '';
  return {
    text,
    bytes,
    dirs,
    writeOrder,
    failOn: (p) => {
      failing = p;
    },
    createDir: async (p) => {
      dirs.push(p);
    },
    writeFile: async (p, c) => {
      if (p === failing) throw new Error(`EACCES: ${p}`);
      writeOrder.push(p);
      text.set(p, c);
    },
    writeFileBytes: async (p, b) => {
      if (p === failing) throw new Error(`EACCES: ${p}`);
      writeOrder.push(p);
      bytes.set(p, b);
    },
    exists: async (p) => text.has(p) || bytes.has(p),
  };
}

const dataUrl = (bytes: number[], mime = 'image/png') => `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

function rec(type: string, payload: unknown, timestamp = '2026-10-10T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp, type, payload });
}

function buildDetail(rolloutText: string): ExternalSessionDetail {
  const summary: ExternalSessionSummary = {
    source: 'codex',
    sessionId: '11111111-2222-3333-4444-555555555555',
    filePath: '/home/u/.codex/sessions/2026/10/10/rollout-x.jsonl',
    title: 'Fix login',
    cwd: '/work/alpha',
    startedAt: Date.parse('2026-10-10T09:00:00.000Z'),
    updatedAt: Date.parse('2026-10-10T23:00:00.000Z'),
    parentSessionId: null,
  };
  const { messages, warnings } = parseCodexRollout(rolloutText);
  return { summary, messages, warnings, branch: LINEAR_BRANCH };
}

const simpleRollout = [
  rec('session_meta', { session_id: 's', cwd: '/work/alpha' }),
  rec('response_item', {
    type: 'message', id: 'm1', role: 'user',
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
    content: [{ type: 'input_text', text: 'how to fix the login bug?' }],
  }),
  rec('response_item', { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'reset the token cache' }] }),
  rec('response_item', { type: 'function_call', call_id: 'c1', name: 'exec', input: '{"cmd":"ls"}' }),
  rec('response_item', { type: 'function_call_output', call_id: 'c1', output: '{"output":"a b"}' }),
].join('\n');

describe('sanitizeFilename', () => {
  it('strips separators, control chars and leading dots', () => {
    expect(sanitizeFilename('a/b\\c:d')).toBe('abcd');
    expect(sanitizeFilename('..hidden')).toBe('hidden');
    expect(sanitizeFilename('   ')).toBe('capture');
    expect(sanitizeFilename('x'.repeat(200))).toHaveLength(120);
  });
});

describe('saveVerbatimCapture', () => {
  it('writes evidence (assets, records.json) before publishing the note', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const result = await saveVerbatimCapture('notes', 'capture.md', { detail, selectedMessages: detail.messages }, port);

    expect(result.notePath).toBe('notes/capture.md');
    expect(result.evidencePath).toBe('notes/capture.evidence');
    expect(result.complete).toBe(true);

    // records.json written before the note; the note is the LAST write
    expect(port.writeOrder).toEqual(['notes/capture.evidence/records.json', 'notes/capture.md']);
  });

  it('the note carries provenance, vault-relative evidence link and verbatim content', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    await saveVerbatimCapture('notes', 'capture.md', { detail, selectedMessages: detail.messages }, port);

    const note = port.text.get('notes/capture.md')!;
    expect(note).toContain('# Fix login');
    expect(note).toContain('11111111-2222-3333-4444-555555555555');
    expect(note).toContain('/work/alpha');
    expect(note).toContain('/home/u/.codex/sessions/2026/10/10/rollout-x.jsonl');
    expect(note).toContain('(./capture.evidence/records.json)');
    expect(note).toContain('how to fix the login bug?');
    expect(note).toContain('reset the token cache');
    expect(note).toContain('{"cmd":"ls"}');
    expect(note).toContain('a b');
    // complete capture is marked complete
    expect(note).toContain(i18n.t('sessions:note.completeness.complete'));
    // source locator lists selected message ids
    expect(note).toContain('msg-1');
  });

  // ── Slice 6: machine-parsable source locator block ──

  it('the note ends with a fenced locator block that parses back to the capture coordinates', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    await saveVerbatimCapture('notes', 'capture.md', { detail, selectedMessages: detail.messages }, port);

    const note = port.text.get('notes/capture.md')!;
    const block = /```folyn-session\n([\s\S]*?)\n```/.exec(note);
    expect(block).toBeTruthy();
    const locator = parseSourceLocator(block![1]!);
    expect(locator).toEqual({
      source: 'codex',
      sessionId: '11111111-2222-3333-4444-555555555555',
      filePath: '/home/u/.codex/sessions/2026/10/10/rollout-x.jsonl',
      branchId: null, // linear session — no branch noise
      messageIds: ['msg-1', 'msg-2'],
      ranges: [],
      evidencePath: 'notes/capture.evidence', // missing-source fallback target
    });
  });

  it('asset links in the note are note-relative, so moving the vault root preserves them', async () => {
    const port = createMemPort();
    const pixel = [5, 6, 7];
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [
          { type: 'input_text', text: 'screenshot' },
          { type: 'input_image', image_url: dataUrl(pixel) },
        ],
      }),
    ].join('\n');
    const detail = buildDetail(rollout);
    await saveVerbatimCapture('notes/sub', 'img.md', { detail, selectedMessages: detail.messages }, port);

    const note = port.text.get('notes/sub/img.md')!;
    const links = [...note.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]!);
    expect(links).toEqual(['./img.evidence/assets/0001.png']); // note-relative, no vault root baked in
  });

  it('inline images are saved byte-identical into the evidence bundle and linked', async () => {
    const port = createMemPort();
    const pixel = [1, 2, 3, 250, 0, 128];
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [
          { type: 'input_text', text: 'screenshot' },
          { type: 'input_image', image_url: dataUrl(pixel) },
        ],
      }),
    ].join('\n');
    const detail = buildDetail(rollout);
    const result = await saveVerbatimCapture('', 'img-note', { detail, selectedMessages: detail.messages }, port);

    const assetPath = 'img-note.evidence/assets/0001.png';
    expect(port.bytes.get(assetPath)).toEqual(new Uint8Array(pixel));
    expect(port.text.get('img-note.md')).toContain('(./img-note.evidence/assets/0001.png)');

    const record = JSON.parse(port.text.get('img-note.evidence/records.json')!);
    expect(record.assets[0].file).toBe('assets/0001.png');
    expect(record.assets[0].messageId).toBe(detail.messages[0].id);
    expect(result.evidencePath).toBe('img-note.evidence');
  });

  it('missing material is recorded in note + records and the capture is never "complete"', async () => {
    const port = createMemPort();
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'see image' }, { type: 'input_image', image_url: 'file_id:fs_9' }],
      }),
      rec('response_item', { type: 'function_call', call_id: 'c1', name: 'exec', input: 'x' }),
      // no function_call_output for c1
      '{"timestamp": "2026-10-10T10:0', // torn trailing record
    ].join('\n');
    const detail = buildDetail(rollout);
    const result = await saveVerbatimCapture('', 'partial', { detail, selectedMessages: detail.messages }, port);

    expect(result.complete).toBe(false);
    expect(result.missing.map((m) => m.kind).sort()).toEqual(['image', 'tool-output']);

    const note = port.text.get('partial.md')!;
    expect(note).toContain(i18n.t('sessions:note.completeness.incomplete', { count: 2 }));
    expect(note).toContain(i18n.t('sessions:note.missing.kind.image'));
    expect(note).toContain('file reference');

    const record = JSON.parse(port.text.get('partial.evidence/records.json')!);
    expect(record.complete).toBe(false);
    expect(record.missing).toHaveLength(2);
    expect(record.sessionWarnings.some((w: string) => w.includes('incomplete'))).toBe(true);
  });

  it('a capture is complete when the SELECTED material is fully obtained — session-level warnings outside the selection do not mark it incomplete', async () => {
    const port = createMemPort();
    // reasoning (known non-displayable — no warning) + torn trailing line, but
    // both selected messages carry all their material.
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'hello' }],
      }),
      rec('response_item', { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }),
      rec('response_item', { type: 'reasoning', encrypted_content: 'gAAA' }),
      '{"timestamp": "2026-10-10T10:0', // torn trailing record (in-progress write)
    ].join('\n');
    const detail = buildDetail(rollout);
    const result = await saveVerbatimCapture('', 'clean-selection', { detail, selectedMessages: detail.messages }, port);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
    const record = JSON.parse(port.text.get('clean-selection.evidence/records.json')!);
    // warnings are still recorded honestly — they just don't flip completeness
    expect(record.complete).toBe(true);
    expect(record.sessionWarnings.some((w: string) => w.includes('incomplete'))).toBe(true);
    // reasoning is known non-displayable — must not surface as a warning
    expect(record.sessionWarnings.some((w: string) => w.includes('reasoning'))).toBe(false);
  });

  it('an existing note is a conflict — nothing is written, no silent overwrite', async () => {
    const port = createMemPort();
    port.text.set('notes/exists.md', 'previous');
    const detail = buildDetail(simpleRollout);
    await expect(
      saveVerbatimCapture('notes', 'exists.md', { detail, selectedMessages: detail.messages }, port),
    ).rejects.toBeInstanceOf(CaptureConflictError);
    expect(port.text.get('notes/exists.md')).toBe('previous');
    expect(port.writeOrder).toEqual([]); // nothing written
  });

  it('an evidence write failure propagates and the note is NOT published', async () => {
    const port = createMemPort();
    port.failOn('notes/broken.evidence/records.json');
    const detail = buildDetail(simpleRollout);
    await expect(
      saveVerbatimCapture('notes', 'broken.md', { detail, selectedMessages: detail.messages }, port),
    ).rejects.toThrow('EACCES');
    expect(port.text.has('notes/broken.md')).toBe(false);
  });

  it('evidence survives source deletion: verbatim raw records + digests stay readable', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const selected = detail.messages.slice(0, 2);
    await saveVerbatimCapture('notes', 'keep.md', { detail, selectedMessages: selected }, port);

    // "delete" the source — the evidence copy is all that remains
    const record = JSON.parse(port.text.get('notes/keep.evidence/records.json')!);
    expect(record.selectedMessageIds).toEqual(selected.map((m) => m.id));
    expect(record.messages).toHaveLength(2);
    for (const m of record.messages) {
      const raw = m.rawRecords.join('\n');
      const digest = await sha256(raw);
      expect(m.digest).toBe(digest);
      // verbatim: re-parsing the retained line yields the original message
      const reparsed = parseCodexRollout(raw);
      expect(reparsed.messages[0]?.content).toBe(
        selected.find((s) => s.id === m.id)!.content,
      );
    }
    expect(record.source).toMatchObject({
      tool: 'codex',
      sessionId: '11111111-2222-3333-4444-555555555555',
      cwd: '/work/alpha',
      filePath: '/home/u/.codex/sessions/2026/10/10/rollout-x.jsonl',
    });
  });

  it('records the capture time and selection coordinates', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const before = new Date().toISOString();
    await saveVerbatimCapture('', 't.md', { detail, selectedMessages: [detail.messages[0]!] }, port);
    const after = new Date().toISOString();
    const record = JSON.parse(port.text.get('t.evidence/records.json')!);
    expect(record.capturedAt >= before).toBe(true);
    expect(record.capturedAt <= after).toBe(true);
    expect(record.format).toBe('folyn-session-evidence/1');
  });

  // ── Claude Code source (slice 2): full save flow end to end ──

  it('a claude-source selection saves note + evidence + tool-result image asset', async () => {
    const port = createMemPort();
    // Synthetic Claude transcript: prompt → assistant tool_use → tool_result
    // with an inline image → answer. Flat records (machine-verified shape).
    const transcript = [
      JSON.stringify({
        type: 'user', sessionId: 'aaaaaaa0-0000-0000-0000-000000000001', cwd: '/work/gamma',
        timestamp: '2026-10-10T10:00:01.000Z', isSidechain: false,
        message: { role: 'user', content: 'capture the graph layout' },
      }),
      JSON.stringify({
        type: 'assistant', sessionId: 'aaaaaaa0-0000-0000-0000-000000000001', cwd: '/work/gamma',
        timestamp: '2026-10-10T10:00:02.000Z', isSidechain: false,
        message: { role: 'assistant', model: 'm', content: [
          { type: 'text', text: 'rendering it' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'render' } },
        ] },
      }),
      JSON.stringify({
        type: 'user', sessionId: 'aaaaaaa0-0000-0000-0000-000000000001', cwd: '/work/gamma',
        timestamp: '2026-10-10T10:00:03.000Z', isSidechain: false,
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [
            { type: 'text', text: 'rendered' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
          ] },
        ] },
      }),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    const summary: ExternalSessionSummary = {
      source: 'claude',
      sessionId: 'aaaaaaa0-0000-0000-0000-000000000001',
      filePath: '/home/u/.claude/projects/-work-gamma/aaaaaaa0-0000-0000-0000-000000000001.jsonl',
      title: 'Graph layout',
      cwd: '/work/gamma',
      startedAt: Date.parse('2026-10-10T10:00:01.000Z'),
      updatedAt: Date.parse('2026-10-10T10:00:03.000Z'),
      parentSessionId: null,
    };
    const detail: ExternalSessionDetail = { summary, messages, warnings: [], branch: LINEAR_BRANCH };
    const result = await saveVerbatimCapture('', 'claude-note', { detail, selectedMessages: messages }, port);

    expect(result.notePath).toBe('claude-note.md');
    expect(result.complete).toBe(true);

    // the tool-result image is a byte-identical evidence asset
    expect(port.bytes.get('claude-note.evidence/assets/0001.png')).toEqual(new Uint8Array([104, 101, 108, 108, 111]));

    // the note carries claude provenance + the verbatim tool evidence
    const note = port.text.get('claude-note.md')!;
    expect(note).toContain('# Graph layout');
    expect(note).toContain('claude');
    expect(note).toContain('"command":"render"');
    expect(note).toContain('rendered');
    expect(note).toContain('(./claude-note.evidence/assets/0001.png)');

    // the evidence bundle retains the raw JSONL lines (survives source deletion)
    const record = JSON.parse(port.text.get('claude-note.evidence/records.json')!);
    expect(record.source).toMatchObject({
      tool: 'claude',
      sessionId: 'aaaaaaa0-0000-0000-0000-000000000001',
      cwd: '/work/gamma',
      filePath: '/home/u/.claude/projects/-work-gamma/aaaaaaa0-0000-0000-0000-000000000001.jsonl',
    });
    const rawAll = record.messages.map((m: { rawRecords: string[] }) => m.rawRecords.join('\n')).join('\n');
    expect(rawAll).toContain('tool_use');
    expect(rawAll).toContain('tool_result');
    expect(rawAll).toContain('capture the graph layout');
  });
  // ── pi source (slice 3): capture from one branch records branch provenance ──

  it('a pi-source selection saves note + evidence with branch provenance; other branches stay out', async () => {
    const port = createMemPort();
    // Synthetic pi v3 file: header + linear trunk, then a fork — the alt
    // branch (b) and the mainline continuation (c) share parent m2.
    const session = [
      JSON.stringify({ type: 'session', version: 3, id: 'h', timestamp: '2026-10-11T09:00:00.000Z', cwd: '/work/pi' }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: 'h', timestamp: '2026-10-11T09:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'explain the parser' }] } }),
      JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-10-11T09:00:02.000Z', message: { role: 'assistant', content: [
        { type: 'text', text: 'checking the reader' },
        { type: 'toolCall', id: 'call_1', name: 'read', arguments: { file: 'parser.ts' } },
      ] } }),
      JSON.stringify({ type: 'message', id: 'm3', parentId: 'm2', timestamp: '2026-10-11T09:00:03.000Z', message: { role: 'toolResult', toolCallId: 'call_1', content: [{ type: 'text', text: 'parser source' }] } }),
      // fork: alt branch first in file order, mainline last
      JSON.stringify({ type: 'message', id: 'b1', parentId: 'm3', timestamp: '2026-10-11T09:00:04.000Z', message: { role: 'user', content: [{ type: 'text', text: 'wrong direction' }] } }),
      JSON.stringify({ type: 'message', id: 'c1', parentId: 'm3', timestamp: '2026-10-11T09:00:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'continue here' }] } }),
    ].join('\n');
    const mainline = parsePiSession(session); // last child chain → c1
    expect(mainline.branch.all.map((b) => b.id)).toEqual(['c1', 'b1']);
    const alt = parsePiSession(session, 'b1');

    const summary: ExternalSessionSummary = {
      source: 'pi',
      sessionId: 'p1-uuid',
      filePath: '/home/u/.pi/agent/sessions/-work-pi/2026-10-11T09-00-00-000Z_p1-uuid.jsonl',
      title: 'explain the parser',
      cwd: '/work/pi',
      startedAt: Date.parse('2026-10-11T09:00:00.000Z'),
      updatedAt: null,
      parentSessionId: null,
    };
    const detail: ExternalSessionDetail = {
      summary,
      messages: alt.messages,
      warnings: alt.warnings,
      branch: alt.branch,
    };
    const result = await saveVerbatimCapture('', 'pi-note', { detail, selectedMessages: alt.messages }, port);

    expect(result.complete).toBe(true);
    const note = port.text.get('pi-note.md')!;
    // the displayed branch is named in the provenance block
    expect(note).toContain(i18n.t('sessions:note.provenance.branch'));
    expect(note).toContain('wrong direction'); // alt branch content, selected
    expect(note).not.toContain('continue here'); // mainline stays out

    const record = JSON.parse(port.text.get('pi-note.evidence/records.json')!);
    expect(record.source.tool).toBe('pi');
    expect(record.source.branch).toMatchObject({ id: 'b1' });
    // verbatim evidence retains the branch's raw records, never the other branch's
    const rawAll = record.messages.map((m: { rawRecords: string[] }) => m.rawRecords.join('\n')).join('\n');
    expect(rawAll).toContain('wrong direction');
    expect(rawAll).not.toContain('continue here');
  });

  it('a linear-source capture records no branch provenance (no branch noise)', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    await saveVerbatimCapture('', 'linear.md', { detail, selectedMessages: detail.messages }, port);
    const record = JSON.parse(port.text.get('linear.evidence/records.json')!);
    expect(record.source.branch).toBeNull();
    expect(port.text.get('linear.md')!).not.toContain(i18n.t('sessions:note.provenance.branch'));
  });

  // ── Slice 4: text-range selection ──────────────────────────────────────

  it('a text-range selection captures ONLY the range — the rest of the message is absent from note AND evidence', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const msgId = detail.messages[0]!.id; // 'how to fix the login bug?'
    const result = await saveVerbatimCapture('', 'range.md', {
      detail,
      selectedMessages: [],
      textRanges: [{ messageId: msgId, start: 0, end: 3 }], // 'how'
    }, port);

    expect(result.complete).toBe(true);
    const note = port.text.get('range.md')!;
    expect(note).toContain('how');
    expect(note).toContain(i18n.t('sessions:note.excerpt')); // explicitly an excerpt
    expect(note).toContain('[0, 3)'); // coordinates in the note
    // the rest of the message, and the correlated tool records, stay OUT
    expect(note).not.toContain('fix the login bug');
    expect(note).not.toContain('{"cmd":"ls"}');
    expect(note).not.toContain('reset the token cache');

    const record = JSON.parse(port.text.get('range.evidence/records.json')!);
    expect(record.selectedMessageIds).toEqual([]);
    expect(record.selectedTextRanges).toEqual([{ messageId: msgId, start: 0, end: 3 }]);
    const entry = record.messages.find((m: { id: string }) => m.id === msgId);
    expect(entry.rawRecords).toEqual([]); // raw record stays out — it holds the unselected text
    expect(entry.ranges).toEqual([{ start: 0, end: 3, text: 'how' }]);
    // nothing else was captured alongside the range
    expect(record.messages).toHaveLength(1);
    expect(record.assets).toEqual([]);
  });

  it('text-range coordinates reproduce the exact slice from the source record', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const msg = detail.messages[0]!;
    await saveVerbatimCapture('', 'coords.md', {
      detail,
      selectedMessages: [],
      textRanges: [{ messageId: msg.id, start: 8, end: 11 }], // 'fix'
    }, port);
    const record = JSON.parse(port.text.get('coords.evidence/records.json')!);
    const entry = record.messages.find((m: { id: string }) => m.id === msg.id);
    // re-parse the still-existing source line and slice with the recorded
    // coordinates — the canonical-text contract
    const reparsed = parseCodexRollout(msg.rawRecord);
    expect(reparsed.messages[0]!.content.slice(entry.ranges[0].start, entry.ranges[0].end))
      .toBe(entry.ranges[0].text);
    // the digest covers the retained excerpt, so it stays verifiable
    const digest = await sha256(JSON.stringify(entry.ranges));
    expect(entry.digest).toBe(digest);
  });

  it('a claude-source text range captures only the excerpt with coordinates', async () => {
    const port = createMemPort();
    const transcript = [
      JSON.stringify({
        type: 'user', sessionId: 'aaaaaaa0-0000-0000-0000-000000000001', cwd: '/work/gamma',
        timestamp: '2026-10-10T10:00:01.000Z', isSidechain: false,
        message: { role: 'user', content: 'capture the graph layout steps' },
      }),
    ].join('\n');
    const { messages } = parseClaudeTranscript(transcript);
    const summary: ExternalSessionSummary = {
      source: 'claude',
      sessionId: 'aaaaaaa0-0000-0000-0000-000000000001',
      filePath: '/home/u/.claude/projects/-work-gamma/aaaaaaa0-0000-0000-0000-000000000001.jsonl',
      title: 'Graph layout',
      cwd: '/work/gamma',
      startedAt: Date.parse('2026-10-10T10:00:01.000Z'),
      updatedAt: null,
      parentSessionId: null,
    };
    const detail: ExternalSessionDetail = { summary, messages, warnings: [], branch: LINEAR_BRANCH };
    await saveVerbatimCapture('', 'claude-range', {
      detail,
      selectedMessages: [],
      textRanges: [{ messageId: messages[0]!.id, start: 12, end: 17 }], // 'graph'
    }, port);

    const note = port.text.get('claude-range.md')!;
    expect(note).toContain('graph');
    expect(note).not.toContain('capture the');
    expect(note).not.toContain('layout steps');
    const record = JSON.parse(port.text.get('claude-range.evidence/records.json')!);
    expect(record.selectedTextRanges).toEqual([{ messageId: messages[0]!.id, start: 12, end: 17 }]);
    expect(record.messages[0].ranges).toEqual([{ start: 12, end: 17, text: 'graph' }]);
  });

  it('a whole-message selection supersedes a text range on the same message', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const msg = detail.messages[0]!;
    await saveVerbatimCapture('', 'supersede.md', {
      detail,
      selectedMessages: [msg],
      textRanges: [{ messageId: msg.id, start: 0, end: 3 }],
    }, port);
    const record = JSON.parse(port.text.get('supersede.evidence/records.json')!);
    expect(record.selectedMessageIds).toEqual([msg.id]);
    expect(record.selectedTextRanges).toBeUndefined();
    // whole-message evidence: raw records retained, no ranges
    expect(record.messages[0].rawRecords.length).toBeGreaterThan(0);
    expect(record.messages[0].ranges).toBeUndefined();
    expect(port.text.get('supersede.md')!).toContain('how to fix the login bug?');
  });

  it('an invalid text range (out of bounds / empty / unknown message) is rejected — nothing written', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const msgId = detail.messages[0]!.id;
    for (const range of [
      { messageId: msgId, start: 0, end: 999 },
      { messageId: msgId, start: 5, end: 5 },
      { messageId: 'msg-nope', start: 0, end: 3 },
    ]) {
      await expect(
        saveVerbatimCapture('', 'bad.md', { detail, selectedMessages: [], textRanges: [range] }, port),
      ).rejects.toThrow(/sessions:/);
    }
    expect(port.writeOrder).toEqual([]);
  });

  // ── Slice 4: whole-branch selection ────────────────────────────────────

  it('whole-branch selection on a forked pi session includes the shared prefix and excludes the sibling branch', async () => {
    const port = createMemPort();
    const session = [
      JSON.stringify({ type: 'session', version: 3, id: 'h', timestamp: '2026-10-11T09:00:00.000Z', cwd: '/work/pi' }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: 'h', timestamp: '2026-10-11T09:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'explain the parser' }] } }),
      JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-10-11T09:00:02.000Z', message: { role: 'assistant', content: [
        { type: 'text', text: 'checking the reader' },
        { type: 'toolCall', id: 'call_1', name: 'read', arguments: { file: 'parser.ts' } },
      ] } }),
      JSON.stringify({ type: 'message', id: 'm3', parentId: 'm2', timestamp: '2026-10-11T09:00:03.000Z', message: { role: 'toolResult', toolCallId: 'call_1', content: [{ type: 'text', text: 'parser source' }] } }),
      JSON.stringify({ type: 'message', id: 'b1', parentId: 'm3', timestamp: '2026-10-11T09:00:04.000Z', message: { role: 'user', content: [{ type: 'text', text: 'wrong direction' }] } }),
      JSON.stringify({ type: 'message', id: 'c1', parentId: 'm3', timestamp: '2026-10-11T09:00:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'continue here' }] } }),
    ].join('\n');
    const mainline = parsePiSession(session); // last child chain → c1
    const summary: ExternalSessionSummary = {
      source: 'pi',
      sessionId: 'p1-uuid',
      filePath: '/home/u/.pi/agent/sessions/-work-pi/2026-10-11T09-00-00-000Z_p1-uuid.jsonl',
      title: 'explain the parser',
      cwd: '/work/pi',
      startedAt: Date.parse('2026-10-11T09:00:00.000Z'),
      updatedAt: null,
      parentSessionId: null,
    };
    const detail: ExternalSessionDetail = {
      summary, messages: mainline.messages, warnings: mainline.warnings, branch: mainline.branch,
    };

    // "select all" = the ENTIRE displayed branch (shared prefix included)
    await saveVerbatimCapture('', 'branch-all.md', { detail, selectedMessages: mainline.messages }, port);

    const note = port.text.get('branch-all.md')!;
    expect(note).toContain('explain the parser'); // shared prefix
    expect(note).toContain('continue here'); // current branch tip
    expect(note).not.toContain('wrong direction'); // sibling branch stays out
    // the locator records the CAPTURED branch, so navigation returns to it
    const block = /```folyn-session\n([\s\S]*?)\n```/.exec(note);
    expect(parseSourceLocator(block![1]!)?.branchId).toBe(mainline.branch.currentId);
    const record = JSON.parse(port.text.get('branch-all.evidence/records.json')!);
    expect(record.selectedMessageIds).toEqual(mainline.messages.map((m) => m.id));
    const rawAll = record.messages.map((m: { rawRecords: string[] }) => m.rawRecords.join('\n')).join('\n');
    expect(rawAll).not.toContain('wrong direction');
  });
});

describe('saveVerbatimCapture with noteBody (slice 5: AI-organized notes)', () => {
  it('saves the EDITED draft as the note body, framed by provenance + evidence link', async () => {
    const port = createMemPort();
    const detail = buildDetail(simpleRollout);
    const draft = '# 登录修复笔记\n\n重置令牌缓存即可。';
    await saveVerbatimCapture('notes', 'ai-note.md', {
      detail,
      selectedMessages: detail.messages,
      noteBody: draft,
    }, port);

    const note = port.text.get('notes/ai-note.md')!;
    // the user-edited draft IS the body
    expect(note).toContain(draft);
    // the verbatim message body is NOT re-rendered into an AI note
    expect(note).not.toContain('how to fix the login bug?');
    expect(note).not.toContain('reset the token cache');
    // but the provenance header, evidence link and locator still frame it
    expect(note).toContain('11111111-2222-3333-4444-555555555555');
    expect(note).toContain('/work/alpha');
    expect(note).toContain('(./ai-note.evidence/records.json)');
    expect(note).toContain(i18n.t('sessions:note.completeness.complete'));
    expect(note).toContain('msg-1'); // source locator keeps the selection ids
  });

  it('the evidence bundle keeps verbatim records + byte-identical assets (same semantics as verbatim save)', async () => {
    const port = createMemPort();
    const pixel = [7, 8, 9];
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [
          { type: 'input_text', text: 'screenshot' },
          { type: 'input_image', image_url: dataUrl(pixel) },
        ],
      }),
    ].join('\n');
    const detail = buildDetail(rollout);
    await saveVerbatimCapture('', 'ai-img', {
      detail,
      selectedMessages: detail.messages,
      noteBody: '# 笔记\n\n见图。',
    }, port);

    // evidence FIRST (assets, records.json), note published last
    expect(port.writeOrder).toEqual([
      'ai-img.evidence/assets/0001.png',
      'ai-img.evidence/records.json',
      'ai-img.md',
    ]);
    expect(port.bytes.get('ai-img.evidence/assets/0001.png')).toEqual(new Uint8Array(pixel));
    const record = JSON.parse(port.text.get('ai-img.evidence/records.json')!);
    expect(record.selectedMessageIds).toEqual([detail.messages[0].id]);
    expect(record.messages[0].rawRecords.length).toBeGreaterThan(0); // verbatim evidence retained
  });

  it('missing material and incompleteness are stated in the AI note too', async () => {
    const port = createMemPort();
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'see image' }, { type: 'input_image', image_url: 'file_id:fs_9' }],
      }),
    ].join('\n');
    const detail = buildDetail(rollout);
    const result = await saveVerbatimCapture('', 'ai-partial', {
      detail,
      selectedMessages: detail.messages,
      noteBody: '# 笔记',
    }, port);

    expect(result.complete).toBe(false);
    const note = port.text.get('ai-partial.md')!;
    expect(note).toContain(i18n.t('sessions:note.completeness.incomplete', { count: 1 }));
    expect(note).toContain(i18n.t('sessions:note.missing.kind.image'));
  });

  it('an AI note never silently overwrites an existing file', async () => {
    const port = createMemPort();
    port.text.set('notes/exists.md', 'previous');
    const detail = buildDetail(simpleRollout);
    await expect(
      saveVerbatimCapture('notes', 'exists.md', {
        detail,
        selectedMessages: detail.messages,
        noteBody: '# draft',
      }, port),
    ).rejects.toBeInstanceOf(CaptureConflictError);
    expect(port.text.get('notes/exists.md')).toBe('previous');
  });
});

describe('verifySelectionFresh', () => {
  const baseInput = (detail: ExternalSessionDetail, textRanges: { messageId: string; start: number; end: number }[] = []) => ({
    detail,
    selectedMessages: detail.messages.slice(0, 1),
    textRanges,
  });

  it('passes when the fresh read still matches the snapshot', () => {
    const detail = buildDetail(simpleRollout);
    expect(() => verifySelectionFresh(baseInput(detail), detail)).not.toThrow();
  });

  it('throws StaleSelectionError when a selected message vanished', () => {
    const detail = buildDetail(simpleRollout);
    const fresh: ExternalSessionDetail = { ...detail, messages: detail.messages.slice(1) };
    expect(() => verifySelectionFresh(baseInput(detail), fresh)).toThrow(StaleSelectionError);
  });

  it('throws when a selected message record changed (same ids, different content)', () => {
    const detail = buildDetail(simpleRollout);
    const changed = detail.messages.map((m, i) =>
      i === 0 ? { ...m, rawRecord: m.rawRecord.replace('login', 'LOGIN') } : m,
    );
    const fresh: ExternalSessionDetail = { ...detail, messages: changed };
    expect(() => verifySelectionFresh(baseInput(detail), fresh)).toThrow(StaleSelectionError);
  });

  it('throws when the source became unreadable (fresh = null)', () => {
    const detail = buildDetail(simpleRollout);
    expect(() => verifySelectionFresh(baseInput(detail), null)).toThrow(StaleSelectionError);
  });

  it('a text range goes stale when its anchor message text changed', () => {
    const detail = buildDetail(simpleRollout);
    const ranges = [{ messageId: detail.messages[0]!.id, start: 0, end: 3 }];
    // unchanged source → fresh
    expect(() => verifySelectionFresh(baseInput(detail, ranges), detail)).not.toThrow();
    // edited anchor text → the coordinates no longer mean the same slice
    const edited = detail.messages.map((m, i) =>
      i === 0 ? { ...m, content: 'edited text' } : m,
    );
    const fresh: ExternalSessionDetail = { ...detail, messages: edited };
    expect(() => verifySelectionFresh(baseInput(detail, ranges), fresh)).toThrow(StaleSelectionError);
  });
});

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  const view = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, '0');
  return hex;
}
