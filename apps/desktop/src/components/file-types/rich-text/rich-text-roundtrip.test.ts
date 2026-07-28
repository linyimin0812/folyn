import { describe, it, expect } from 'vitest';
import {
  deserializeToContent,
  emptyDoc,
  serializeToDisk,
  shouldApplyExternalContent,
} from './richTextContent';

// ponytail: jsdom cannot host a real prosemirror view (getScreenCTM /
// createSVGMatrix / selection API gaps — see file-type-editors.md dbml
// ceiling). The pure serialize/deserialize/anti-loop logic is split out
// into richTextContent.ts so it's unit-testable without mounting a tiptap
// editor. Component-level behavior is verified by opening a .rt file in
// the running app, mirroring the ErDiagramX6 approach.

describe('rich-text content pipeline', () => {
  it('round-trips a minimal tiptap doc JSON through serialize → deserialize', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    };
    const onDisk = serializeToDisk(doc);
    const back = deserializeToContent(onDisk);
    expect(back).toEqual(doc);
  });

  it('round-trips a multi-block doc (headings + list + marks)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                    { type: 'text', text: ' + ' },
                    { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  it('deserialize returns undefined for empty / invalid JSON', () => {
    expect(deserializeToContent('')).toBeUndefined();
    expect(deserializeToContent('   ')).toBeUndefined();
    expect(deserializeToContent('not json')).toBeUndefined();
    expect(deserializeToContent('{')).toBeUndefined();
  });

  it('deserialize returns undefined for non-object JSON', () => {
    expect(deserializeToContent('42')).toBeUndefined();
    expect(deserializeToContent('"string"')).toBeUndefined();
    expect(deserializeToContent('null')).toBeUndefined();
  });

  it('emptyDoc is a valid doc with one empty paragraph', () => {
    expect(emptyDoc()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('serialize → deserialize is idempotent for empty doc', () => {
    const disk = serializeToDisk(emptyDoc());
    expect(deserializeToContent(disk)).toEqual(emptyDoc());
  });
});

describe('shouldApplyExternalContent (anti-loop predicate)', () => {
  it('returns false when the incoming string equals the loaded ref', () => {
    const ref = { current: '{"type":"doc"}' };
    expect(shouldApplyExternalContent('{"type":"doc"}', ref)).toBe(false);
  });

  it('returns false when both sides are empty/blank', () => {
    const ref = { current: '' };
    expect(shouldApplyExternalContent('   ', ref)).toBe(false);
    expect(shouldApplyExternalContent('', { current: '   ' })).toBe(false);
  });

  it('returns true when one side is blank and the other has content', () => {
    expect(shouldApplyExternalContent('{"type":"doc"}', { current: '' })).toBe(true);
    expect(shouldApplyExternalContent('', { current: '{"type":"doc"}' })).toBe(true);
  });

  it('returns false for key-ordering / whitespace-only diffs (normalized equal)', () => {
    // Same doc, different key order + whitespace — must NOT trigger a reload
    // (would clobber cursor + undo history on the user's own save flowing back).
    const ref = { current: '{"type":"doc","content":[{"type":"paragraph"}]}' };
    const incoming = '{ "content" : [ { "type" : "paragraph" } ], "type" : "doc" }';
    expect(shouldApplyExternalContent(incoming, ref)).toBe(false);
  });

  it('returns true when the doc genuinely changed', () => {
    const ref = { current: '{"type":"doc","content":[{"type":"paragraph"}]}' };
    const incoming = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}';
    expect(shouldApplyExternalContent(incoming, ref)).toBe(true);
  });

  it('returns false when both sides hold invalid JSON (no real change to apply)', () => {
    expect(shouldApplyExternalContent('garbage', { current: 'also-garbage' })).toBe(false);
  });
});

// ponytail: image + table nodes are just JSON — the identity serialize/
// deserialize round-trip is automatic. The test below pins that an AI (or
// tiptap getJSON) emitting image/table nodes survives a disk round-trip
// byte-for-byte, so the anti-loop predicate's stableStringify comparison
// won't false-fire on these node types.
describe('image + table node round-trip', () => {
  it('round-trips a doc with an image node (vault-relative src)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'assets/images/abc123.png', alt: 'pic', title: null },
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  it('round-trips a doc with an external image URL src (verbatim, no vault write)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://example.com/x.png', alt: null, title: null },
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  it('round-trips a doc with a table (header row + cells)', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [cell('A')] },
                { type: 'tableHeader', content: [cell('B')] },
              ],
            },
            {
              type: 'tableRow',
              content: [cell('1'), cell('2')],
            },
          ],
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });
});
