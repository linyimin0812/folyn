/**
 * Round-trip + rejection tests for the source-locator block (slice 6).
 */
import { describe, it, expect } from 'vitest';
import {
  LOCATOR_FORMAT,
  parseSourceLocator,
  renderSourceLocator,
} from './sourceLocator';

const full: Parameters<typeof renderSourceLocator>[0] = {
  source: 'pi',
  sessionId: 'p1-uuid',
  filePath: '/home/u/.pi/agent/sessions/-work-pi/s.jsonl',
  branchId: 'c1',
  messageIds: ['msg-1', 'msg-9'],
  ranges: [{ messageId: 'msg-5', start: 12, end: 40 }],
  evidencePath: 'notes/capture.evidence',
};

describe('sourceLocator', () => {
  it('render → parse round-trips the full shape', () => {
    const text = renderSourceLocator(full);
    const parsed = parseSourceLocator(text);
    expect(parsed).toEqual(full);
  });

  it('parses MULTIPLE ranges — the comma inside a token never splits the list', () => {
    const text = [
      LOCATOR_FORMAT,
      'source: claude',
      'session: s1',
      'ranges: msg-2[0,11), msg-5[12,40)',
    ].join('\n');
    expect(parseSourceLocator(text)).toEqual({
      source: 'claude',
      sessionId: 's1',
      filePath: null,
      branchId: null,
      messageIds: [],
      ranges: [
        { messageId: 'msg-2', start: 0, end: 11 },
        { messageId: 'msg-5', start: 12, end: 40 },
      ],
      evidencePath: null,
    });
  });

  it('parses the block when the user pastes the whole fenced code block', () => {
    const text = '```folyn-session\n' + renderSourceLocator(full) + '\n```';
    expect(parseSourceLocator(text)).toEqual(full);
  });

  it('omitted optional fields parse as null/empty', () => {
    const minimal = renderSourceLocator({
      source: 'codex', sessionId: 's1', filePath: null, branchId: null,
      messageIds: [], ranges: [], evidencePath: null,
    });
    const parsed = parseSourceLocator(minimal)!;
    expect(parsed.source).toBe('codex');
    expect(parsed.sessionId).toBe('s1');
    expect(parsed.filePath).toBeNull();
    expect(parsed.branchId).toBeNull();
    expect(parsed.messageIds).toEqual([]);
    expect(parsed.ranges).toEqual([]);
    expect(parsed.evidencePath).toBeNull();
  });

  it('rejects text without the format marker (localized note prose)', () => {
    expect(parseSourceLocator('来源工具: codex\n会话: abc')).toBeNull();
    expect(parseSourceLocator('')).toBeNull();
  });

  it('rejects unknown sources and missing session ids', () => {
    expect(parseSourceLocator(`${LOCATOR_FORMAT}\nsource: curl\nsession: s`)).toBeNull();
    expect(parseSourceLocator(`${LOCATOR_FORMAT}\nsource: codex`)).toBeNull();
  });

  it('rejects malformed range coordinates instead of guessing', () => {
    expect(
      parseSourceLocator(`${LOCATOR_FORMAT}\nsource: codex\nsession: s\nranges: msg-1[12,40]`),
    ).toBeNull(); // missing the half-open ')' — coordinates are exact or nothing
    expect(
      parseSourceLocator(`${LOCATOR_FORMAT}\nsource: codex\nsession: s\nranges: msg-1[a,b)`),
    ).toBeNull();
  });
});
