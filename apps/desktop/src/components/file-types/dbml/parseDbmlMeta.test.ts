import { describe, it, expect } from 'vitest';
import {
  extractDbmlMeta,
  serializeDbmlMeta,
  withDbmlMeta,
  type DbmlMeta,
} from './parseDbml';

// ponytail: minimal self-check for the meta-block parser/serializer. The
// round-trip invariant is "user dbml text is preserved verbatim; meta block
// appends at the end". Failure here means either the parser eats user code
// or the serializer drops the block.
describe('dbml meta block', () => {
  it('extracts nothing when no meta block present', () => {
    const src = 'Table users {\n  id int [pk]\n}\n';
    const { dbml, meta } = extractDbmlMeta(src);
    expect(dbml).toBe(src);
    expect(meta).toBeUndefined();
  });

  it('round-trips positions + view through extract → serialize', () => {
    const src = `Table users {
  id int [pk]
}
<!-- dbml:meta
positions: {"users":{"x":120,"y":80}}
view: {"zoomPct":85,"showGrid":true}
-->`;
    const { dbml, meta } = extractDbmlMeta(src);
    expect(dbml).toBe('Table users {\n  id int [pk]\n}');
    expect(meta?.positions).toEqual({ users: { x: 120, y: 80 } });
    expect(meta?.view).toEqual({ zoomPct: 85, showGrid: true });
    // Re-serialize and re-extract — should be idempotent.
    const reEmitted = withDbmlMeta(dbml, meta!);
    const roundTrip = extractDbmlMeta(reEmitted);
    expect(roundTrip.meta?.positions).toEqual(meta?.positions);
    expect(roundTrip.meta?.view).toEqual(meta?.view);
    expect(roundTrip.dbml).toBe(dbml);
  });

  it('serializeDbmlMeta returns empty string for empty meta', () => {
    expect(serializeDbmlMeta({ positions: {} })).toBe('');
    expect(serializeDbmlMeta({ positions: {}, view: {} })).toBe('');
  });

  it('serializeDbmlMeta omits default view values', () => {
    // zoomPct=100 and showGrid=false are defaults — must NOT be emitted
    // so a freshly-opened file with no adjustments writes no meta block.
    const out = serializeDbmlMeta({ positions: { users: { x: 1, y: 2 } } });
    expect(out).toContain('positions:');
    expect(out).not.toContain('view');
  });

  it('withDbmlMeta preserves user dbml text when meta is empty', () => {
    const dbml = 'Table t {\n  id int [pk]\n}\n';
    // ponytail: empty meta → no block appended → text returned unchanged.
    const out = withDbmlMeta(dbml, { positions: {} });
    expect(out).toBe(dbml);
  });

  it('extractDbmlMeta survives malformed JSON in directive (skips it)', () => {
    const src = `Table t {
  id int [pk]
}
<!-- dbml:meta
positions: {not valid json}
view: {"zoomPct":50}
-->`;
    const { dbml, meta } = extractDbmlMeta(src);
    expect(dbml).toBe('Table t {\n  id int [pk]\n}');
    // Malformed positions line is skipped; positions stays empty.
    expect(meta?.positions).toEqual({});
    expect(meta?.view).toEqual({ zoomPct: 50 });
  });

  it('extractDbmlMeta handles meta block with trailing content after it', () => {
    // Edge case: content after the meta block (unusual but legal). The block
    // is stripped wherever it appears; content before + after is joined.
    const src = `Table t { id int [pk] }
<!-- dbml:meta
view: {"zoomPct":75}
-->
trailing`;
    const { dbml, meta } = extractDbmlMeta(src);
    // Newlines surrounding the block are preserved as a blank line between
    // the pre-block content and the trailing content.
    expect(dbml).toBe('Table t { id int [pk] }\n\ntrailing');
    expect(meta?.view).toEqual({ zoomPct: 75 });
  });
});
