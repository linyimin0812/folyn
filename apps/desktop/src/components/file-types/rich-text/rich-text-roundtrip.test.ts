import { describe, it, expect } from 'vitest';
import { generateHTML } from '@tiptap/react';
import {
  deserializeToContent,
  emptyDoc,
  serializeToDisk,
  shouldApplyExternalContent,
} from './richTextContent';
import { getRichTextExtensions } from './richTextExtensions';

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
          attrs: {
            src: 'assets/images/abc123.png',
            alt: 'pic',
            title: null,
            width: null,
            dataAlign: null,
            caption: null,
          },
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
          attrs: {
            src: 'https://example.com/x.png',
            alt: null,
            title: null,
            width: null,
            dataAlign: null,
            caption: null,
          },
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  it('round-trips an image with width/dataAlign/caption attrs (figure shape)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'assets/images/abc123.png',
            alt: 'pic',
            title: null,
            width: 480,
            dataAlign: 'center',
            caption: 'A caption',
          },
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

  it('round-trips table cell align attrs (left/center/right)', () => {
    const cell = (text: string, align?: string) => ({
      type: 'tableCell',
      attrs: align ? { align } : undefined,
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
              content: [cell('L', 'left'), cell('C', 'center'), cell('R', 'right'), cell('D')],
            },
          ],
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  it('round-trips a merged cell (colspan/rowspan)', () => {
    const cell = (text: string, attrs: Record<string, unknown>) => ({
      type: 'tableCell',
      attrs,
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
              content: [cell('merged', { colspan: 2, rowspan: 1, colwidth: null, align: null, background: null }), cell('b', { colspan: 1, rowspan: 2, colwidth: null, align: null, background: null })],
            },
            {
              type: 'tableRow',
              content: [cell('c', { colspan: 1, rowspan: 1, colwidth: null, align: null, background: null })],
            },
          ],
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });

  // ponytail: colwidth + background are the two attrs added by resizable
  // tables + RichTextTableCell's custom `background` attr. Round-trip
  // pins them so a doc saved with column widths / cell colors survives
  // disk reload byte-for-byte (anti-loop stableStringify equality).
  it('round-trips colwidth + background attrs (resize drag + bg color)', () => {
    const cell = (text: string, attrs: Record<string, unknown>) => ({
      type: 'tableCell',
      attrs,
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
                cell('a', { colspan: 1, rowspan: 1, colwidth: [120], align: null, background: '#ffeb3b' }),
                cell('b', { colspan: 1, rowspan: 1, colwidth: [80], align: 'center', background: null }),
              ],
            },
          ],
        },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });
});

// ponytail: math nodes (inlineMath/blockMath from @tiptap/extension-mathematics)
// are atoms with a single `latex` attr — plain JSON, so identity round-trip
// is automatic. Pinning the node names + attr shape guards the disk format
// against a future extension change (an AI or tiptap getJSON emitting these
// nodes must survive disk reload byte-for-byte for the anti-loop predicate).
describe('math node round-trip', () => {
  it('round-trips inline + block math nodes (latex attrs)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Euler: ' },
            { type: 'inlineMath', attrs: { latex: 'e^{i\\pi} + 1 = 0' } },
            { type: 'text', text: ' end' },
          ],
        },
        { type: 'blockMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
      ],
    };
    expect(deserializeToContent(serializeToDisk(doc))).toEqual(doc);
  });
});

// ponytail: export contract — generateHTML (used by services/export/richtext.ts)
// runs static renderHTML, not NodeViews, so math nodes serialize as empty
// wrappers carrying data-type + data-latex. The export pipeline's
// renderRichTextMath then fills them with KaTeX HTML. Pin the wrapper shape
// so a future schema change can't silently break the export post-processor.
describe('math export HTML contract', () => {
  it('generateHTML emits inline/block math wrappers with data-latex attrs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'inlineMath', attrs: { latex: 'e^{i\\pi} + 1 = 0' } }],
        },
        { type: 'blockMath', attrs: { latex: '\\sum_{i=1}^{n} i' } },
      ],
    };
    const html = generateHTML(doc, getRichTextExtensions());
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const inline = parsed.querySelector('span[data-type="inline-math"]');
    const block = parsed.querySelector('div[data-type="block-math"]');
    expect(inline?.getAttribute('data-latex')).toBe('e^{i\\pi} + 1 = 0');
    expect(block?.getAttribute('data-latex')).toBe('\\sum_{i=1}^{n} i');
    // Wrappers must be empty — the export post-processor injects KaTeX HTML.
    expect(inline?.textContent).toBe('');
    expect(block?.textContent).toBe('');
  });
});
