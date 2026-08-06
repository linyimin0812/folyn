import { describe, it, expect } from 'vitest';
import { plaintextToMindElixir, mindElixirToPlaintext } from 'mind-elixir/plaintextConverter';
import { topicMarkdown } from './topicMarkdown';
import {
  parseOutline,
  serializeOutline,
  outlineToMindElixirData,
  mindElixirDataToOutline,
  readRuntimeMapStyle,
  deriveMapStyle,
  CANVAS_PALETTES,
  resolveCanvasPalette,
  PRESET_STYLES,
  type MmapNodeStyle,
} from './outlineConverter';

describe('mind-elixir plaintext round-trip (mmap source format)', () => {
  // ponytail: ONE check for the only non-trivial behavior we own — that
  // mind-elixir's plaintext converter round-trips simple bullet trees we
  // care about. UI/canvas wiring is covered by acceptance manual testing.

  it('round-trips a simple 2-level tree through plaintext format', () => {
    const src = '- Root\n  - Child A\n  - Child B\n    - Grandchild B1';
    const data = plaintextToMindElixir(src);
    const out = mindElixirToPlaintext(data);
    // Normalize trailing newline + root wrapper if converter synthesizes one
    const norm = (s: string) => s.replace(/\n+$/g, '').trim();
    expect(norm(out)).toContain('Root');
    expect(norm(out)).toContain('Child A');
    expect(norm(out)).toContain('Child B');
    expect(norm(out)).toContain('Grandchild B1');
  });

  it('throws on empty input — caller must guard with fallback', () => {
    // Documents the contract: MindMapCanvas uses toSafeSrc() to feed
    // '- Root' when content is empty/whitespace. This test pins the
    // upstream behavior so we notice if mind-elixir starts accepting
    // empty input (which would let us drop the guard).
    expect(() => plaintextToMindElixir('')).toThrow(/no root node found/);
    expect(() => plaintextToMindElixir('   \n')).toThrow(/no root node found/);
  });

  it('topicMarkdown renders images, inline formatting, and escapes HTML', () => {
    const img = topicMarkdown('![cat](https://x.com/cat.png)');
    expect(img).toContain('<img src="https://x.com/cat.png"');
    expect(img).toContain('alt="cat"');

    const escaped = topicMarkdown('<script>alert(1)</script>');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');

    const fmt = topicMarkdown('**bold** *italic* `code`');
    expect(fmt).toContain('<strong>bold</strong>');
    expect(fmt).toContain('<em>italic</em>');
    expect(fmt).toContain('<code>code</code>');
  });

  it('topicMarkdown appends a note icon with data-note when obj.note is set', () => {
    const html = topicMarkdown('Topic', { note: 'a note' });
    expect(html).toContain('mmap-note-icon');
    expect(html).toContain('data-note="a note"');
    expect(html).toContain('ⓘ');
    // no native tooltip — only the custom popover reads data-note
    expect(html).not.toContain('title=');
    // no note → no icon
    expect(topicMarkdown('Topic')).not.toContain('mmap-note-icon');
  });

  it('topicMarkdown escapes HTML in the note data-note attribute', () => {
    const html = topicMarkdown('Topic', { note: '<x onclick="evil"> & "q"' });
    // `<` / `>` / `"` / `&` are HTML-escaped so no live attribute or tag
    // survives into the data-note string (the literal word `onclick` may still
    // appear as text, but with no attribute boundary it can't fire).
    expect(html).not.toContain('<x ');
    expect(html).not.toContain('onclick="evil"');
    expect(html).toContain('&lt;x');
    expect(html).toContain('&quot;evil&quot;');
    expect(html).toContain('&amp;');
  });
});

describe('OutlineEditor converter (strip/prepend `- ` round-trip)', () => {
  // ponytail: the converter is the only non-trivial behavior the editor
  // owns; keyboard wiring is covered by manual acceptance testing.

  it('parse+serialize round-trips a 2-level bullet tree identically', () => {
    const src = '- Root\n  - Child A\n  - Child B\n    - Grandchild';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
  });

  it('round-trips a single root', () => {
    const src = '- Root';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
  });

  it('empty/blank input yields the fallback root', () => {
    expect(parseOutline('')).toEqual([{ text: 'Root', depth: 0 }]);
    expect(parseOutline('   \n  \n')).toEqual([{ text: 'Root', depth: 0 }]);
  });

  it('parse strips the `- ` prefix and preserves depth via indent', () => {
    const rows = parseOutline('- Root\n  - Child');
    expect(rows).toEqual([
      { text: 'Root', depth: 0 },
      { text: 'Child', depth: 1 },
    ]);
  });

  it('single-root invariant: sibling-of-root lines bump to depth 1', () => {
    // Source `- A\n- B\n- C` has three depth-0 lines; the fix makes B and C
    // children of the root A, so all non-first rows are depth >= 1.
    expect(parseOutline('- A\n- B\n- C')).toEqual([
      { text: 'A', depth: 0 },
      { text: 'B', depth: 1 },
      { text: 'C', depth: 1 },
    ]);
  });

  it('single-root invariant: a later under-indented line bumps from 0 to 1', () => {
    // `- A\n  - B\n- C` — C is parsed at depth 0 but bumped to depth 1 so it
    // stays a descendant of the root A rather than a sibling.
    expect(parseOutline('- A\n  - B\n- C')).toEqual([
      { text: 'A', depth: 0 },
      { text: 'B', depth: 1 },
      { text: 'C', depth: 1 },
    ]);
  });

  it('round-trip is stable: re-parsing the serialized output yields the same rows', () => {
    const cases = [
      '- A\n- B\n- C',
      '- A\n  - B\n- C',
      '- Root\n  - Child A\n  - Child B\n    - Grandchild',
    ];
    for (const src of cases) {
      const first = parseOutline(src);
      const serialized = serializeOutline(first);
      const reparsed = parseOutline(serialized);
      expect(reparsed).toEqual(first);
    }
  });
});

describe('note continuation lines (>)', () => {
  it('parseOutline attaches a `> ` continuation line to the previous topic as a note', () => {
    const src = '- Topic\n  > This is a note';
    expect(parseOutline(src)).toEqual([
      { text: 'Topic', depth: 0, note: 'This is a note' },
    ]);
  });

  it('parseOutline joins multi-line notes with \\n', () => {
    const src = '- Topic\n  > Line 1\n  > Line 2';
    expect(parseOutline(src)).toEqual([
      { text: 'Topic', depth: 0, note: 'Line 1\nLine 2' },
    ]);
  });

  it('parseOutline ends a note block when a child topic appears', () => {
    const src = '- Topic\n  > Note line\n  - Child';
    expect(parseOutline(src)).toEqual([
      { text: 'Topic', depth: 0, note: 'Note line' },
      { text: 'Child', depth: 1 },
    ]);
  });

  it('parseOutline ends a note block on a blank line', () => {
    const src = '- Topic\n  > Note line\n\n  - Child';
    expect(parseOutline(src)).toEqual([
      { text: 'Topic', depth: 0, note: 'Note line' },
      { text: 'Child', depth: 1 },
    ]);
  });

  it('parseOutline attaches notes to depth-1 topics at the right indent', () => {
    const src = '- Root\n  - Child\n    > Child note';
    expect(parseOutline(src)).toEqual([
      { text: 'Root', depth: 0 },
      { text: 'Child', depth: 1, note: 'Child note' },
    ]);
  });

  it('serializeOutline emits `> ` continuation lines for notes', () => {
    const src = '- Topic\n  > Note line';
    expect(serializeOutline(parseOutline(src))).toBe(src);
  });

  it('serializeOutline round-trips multi-line notes', () => {
    const src = '- Topic\n  > Line 1\n  > Line 2\n  - Child';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
    // re-parse stability
    expect(parseOutline(out)).toEqual(parseOutline(src));
  });

  it('round-trips a tree with notes on multiple nodes', () => {
    const src = '- Root\n  > Root note\n  - A\n    > A note\n    - A1\n  - B';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
  });
});

describe('mind-elixir converter (own, note-aware)', () => {
  // ponytail: mind-elixir's plaintextConverter drops `note` on round-trip.
  // Our own outlineToMindElixirData / mindElixirDataToOutline preserve it.

  it('outlineToMindElixirData builds a nodeData tree with notes attached', () => {
    const data = outlineToMindElixirData('- Root\n  - Child\n    > Child note');
    expect(data.nodeData.topic).toBe('Root');
    expect(data.nodeData.children).toHaveLength(1);
    const child = data.nodeData.children![0];
    expect(child.topic).toBe('Child');
    expect(child.note).toBe('Child note');
  });

  it('mindElixirDataToOutline round-trips a tree with notes through the converter', () => {
    const src = '- Root\n  > Root note\n  - Child\n    > Child note\n    - Grand';
    const out = mindElixirDataToOutline(outlineToMindElixirData(src));
    expect(out).toBe(src);
  });

  it('mindElixirDataToOutline emits no `> ` lines when the tree has no notes', () => {
    const src = '- Root\n  - A\n  - B';
    const out = mindElixirDataToOutline(outlineToMindElixirData(src));
    expect(out).toBe(src);
    expect(out).not.toContain('>');
  });
});

// ponytail: arrows/summaries/links round-trip through a trailing metadata
// block that references nodes by topic text. Documented ceilings (rename
// orphan-refs, duplicate topics, topic texts containing ` -> `/` <-> `/` | `/` / `)
// are NOT covered here — they're the upgrade path to inline `#id:xxx` or
// JSON metadata. These tests pin the happy path.
describe('arrows / summaries / links metadata block round-trip', () => {
  it('round-trips a one-way arrow with a label', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\narrow: A -> B | relates to\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.arrows).toHaveLength(1);
    expect(data.arrows![0].label).toBe('relates to');
    expect(data.arrows![0].bidirectional).toBeFalsy();
    const fromId = data.arrows![0].from;
    const toId = data.arrows![0].to;
    // from/to resolved to actual node ids in the tree
    expect(fromId).not.toBe(toId);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips a bidirectional arrow with <-> separator', () => {
    const src = '- Root\n  - A\n  - B\n\n<!-- mmap:meta\narrow: A <-> B\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.arrows).toHaveLength(1);
    expect(data.arrows![0].bidirectional).toBe(true);
    expect(data.arrows![0].label).toBe('');
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips multiple arrows on the same tree', () => {
    const src =
      '- Root\n  - A\n  - B\n  - C\n\n<!-- mmap:meta\narrow: A -> B | x\narrow: B <-> C | y\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.arrows).toHaveLength(2);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips a summary on a parent\'s child range', () => {
    const src =
      '- Root\n  - A\n    - A1\n    - A2\n    - A3\n\n<!-- mmap:meta\nsummary: A / 0-2 | wrap\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.summaries).toHaveLength(1);
    expect(data.summaries![0].label).toBe('wrap');
    expect(data.summaries![0].start).toBe(0);
    expect(data.summaries![0].end).toBe(2);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips a node hyperLink (🔗) as a link directive', () => {
    const src =
      '- Root\n  - A\n\n<!-- mmap:meta\nlink: A -> https://example.com\n-->';
    const data = outlineToMindElixirData(src);
    const aNode = data.nodeData.children![0];
    expect(aNode.hyperLink).toBe('https://example.com');
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('emits no metadata block when the tree has no arrows/summaries/links', () => {
    const src = '- Root\n  - A\n  - B';
    const out = mindElixirDataToOutline(outlineToMindElixirData(src));
    expect(out).toBe(src);
    expect(out).not.toContain('mmap:meta');
  });

  it('drops arrows/summaries/links whose topic reference has no match (dangling ref)', () => {
    // ponytail: ceiling — rename orphans the ref. The converter drops the
    // entry rather than handing mind-elixir a non-existent uid.
    const src =
      '- Root\n  - A\n\n<!-- mmap:meta\narrow: A -> Ghost\nsummary: Ghost / 0-0\nlink: Ghost -> https://x.com\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.arrows ?? []).toHaveLength(0);
    expect(data.summaries ?? []).toHaveLength(0);
    // no node carries a hyperLink
    const walk = (n: typeof data.nodeData): boolean =>
      Boolean(n.hyperLink) || (n.children ?? []).some(walk);
    expect(walk(data.nodeData)).toBe(false);
  });

  it('survives the OutlineEditor path: parseOutline → serializeOutline preserves the metadata block on lines[0].meta', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\narrow: A -> B | label\n-->';
    const lines = parseOutline(src);
    expect(lines[0].meta).toBeDefined();
    expect(lines[0].meta!.arrows).toHaveLength(1);
    // serialize re-emits the block verbatim
    const out = serializeOutline(lines);
    expect(out).toBe(src);
  });
});

// ponytail: per-node styles + map-level style (rainbow) round-trip through
// `styles:` / `mapStyle:` JSON directives in the metadata block. Tests pin
// the happy path; dangling-ref handling mirrors arrows/summaries/links.
describe('per-node style round-trip', () => {
  it('round-trips a single styled node', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nstyles: {"A":{"color":"#ffffff","background":"#dc2626","fontWeight":"bold"}}\n-->';
    const data = outlineToMindElixirData(src);
    const aNode = data.nodeData.children![0];
    expect((aNode as { style?: MmapNodeStyle }).style).toMatchObject({
      color: '#ffffff',
      background: '#dc2626',
      fontWeight: 'bold',
    });
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips multiple styled nodes', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nstyles: {"A":{"color":"#ffffff","background":"#dc2626"},"B":{"color":"#ffffff","background":"#2563eb"}}\n-->';
    const data = outlineToMindElixirData(src);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips italic via fontStyle (key not in mind-elixir TS type but honored at runtime)', () => {
    const src =
      '- Root\n  - A\n\n<!-- mmap:meta\nstyles: {"A":{"fontStyle":"italic","fontWeight":"bold"}}\n-->';
    const data = outlineToMindElixirData(src);
    const aNode = data.nodeData.children![0];
    expect((aNode as { style?: MmapNodeStyle }).style?.fontStyle).toBe('italic');
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('round-trips shape fields: border shorthand + width', () => {
    const src =
      '- Root\n  - A\n\n<!-- mmap:meta\nstyles: {"A":{"border":"2px solid #00f","width":"120px","background":"#f3f4f6"}}\n-->';
    const data = outlineToMindElixirData(src);
    const aNode = data.nodeData.children![0];
    expect((aNode as { style?: MmapNodeStyle }).style).toMatchObject({
      border: '2px solid #00f',
      width: '120px',
      background: '#f3f4f6',
    });
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('drops style on a renamed/dangling topic (no match in tree)', () => {
    // ponytail: ceiling — rename orphans the style ref. The converter drops
    // the entry rather than hand mind-elixir a non-existent uid.
    const src =
      '- Root\n  - A\n\n<!-- mmap:meta\nstyles: {"Ghost":{"color":"#f00"}}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.nodeData.children).toHaveLength(1);
    const aNode = data.nodeData.children![0];
    expect((aNode as { style?: MmapNodeStyle }).style).toBeUndefined();
    // re-serialize emits no metadata block (no surviving styles)
    const out = mindElixirDataToOutline(data);
    expect(out).not.toContain('mmap:meta');
  });

  it('emits no metadata block when no node has a style', () => {
    const src = '- Root\n  - A\n  - B';
    const out = mindElixirDataToOutline(outlineToMindElixirData(src));
    expect(out).toBe(src);
    expect(out).not.toContain('mmap:meta');
  });

  it('each preset theme style is a valid MmapNodeStyle object', () => {
    for (const [key, preset] of Object.entries(PRESET_STYLES)) {
      expect(typeof preset.label).toBe('string');
      expect(preset.label.length).toBeGreaterThan(0);
      expect(typeof preset.style).toBe('object');
      expect(Object.keys(preset.style).length).toBeGreaterThan(0);
      // every key is a known CSS property name
      for (const styleKey of Object.keys(preset.style)) {
        expect([
          'fontSize',
          'fontFamily',
          'color',
          'background',
          'fontWeight',
          'fontStyle',
          'textDecoration',
          'border',
          'width',
        ]).toContain(styleKey);
      }
      // sanity: each preset carries at least a color or background
      const hasColorOrBg = 'color' in preset.style || 'background' in preset.style;
      expect(hasColorOrBg).toBe(true);
      // skip unused var-warning
      void key;
    }
  });

  it('preset styles: important is red bg + bold + white text', () => {
    expect(PRESET_STYLES.important.style).toMatchObject({
      color: '#ffffff',
      background: '#dc2626',
      fontWeight: 'bold',
    });
  });

  it('preset styles: done has strikethrough + green bg', () => {
    expect(PRESET_STYLES.done.style).toMatchObject({
      background: '#16a34a',
      textDecoration: 'line-through',
    });
  });
});

describe('map-level style (rainbow) round-trip', () => {
  it('rainbow OFF persists a mono theme palette', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"rainbow":false}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.theme).toBeDefined();
    expect(data.theme!.palette).toHaveLength(1);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('rainbow ON (default, no meta) emits no mapStyle directive', () => {
    const src = '- Root\n  - A\n  - B';
    const data = outlineToMindElixirData(src);
    // no theme on default — multi-color Latte palette is applied by
    // mind-elixir at init time, not encoded in our data model.
    expect(data.theme).toBeUndefined();
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
    expect(out).not.toContain('mapStyle');
  });

  it('round-trips rainbow OFF alongside per-node styles', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nstyles: {"A":{"color":"#fff","background":"#dc2626"}}\nmapStyle: {"rainbow":false}\n-->';
    const data = outlineToMindElixirData(src);
    const aNode = data.nodeData.children![0];
    expect((aNode as { style?: MmapNodeStyle }).style?.background).toBe('#dc2626');
    expect(data.theme?.palette).toHaveLength(1);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });
});

// ponytail: canvas-level mapStyle round-trip. direction/compact live on
// MindElixirData (mind-elixir owns them). palette/background/alignment/
// topicSpacing are runtime-only — they survive via the override the canvas
// passes to mindElixirDataToOutline. Tests pin both paths.
describe('canvas-level mapStyle (direction/compact/palette/background/alignment/topicSpacing) round-trip', () => {
  it('direction round-trips through data.direction (LEFT/SIDE; default RIGHT omitted)', () => {
    // direction=0 (LEFT) is non-default — must survive.
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"direction":0}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.direction).toBe(0);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('direction=2 (SIDE) round-trips', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"direction":2}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.direction).toBe(2);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('direction=1 (default RIGHT) emits no directive', () => {
    const src = '- Root\n  - A\n  - B';
    const data = outlineToMindElixirData(src);
    expect(data.direction).toBeUndefined();
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
    expect(out).not.toContain('mapStyle');
  });

  it('compact=true round-trips', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"compact":true}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.compact).toBe(true);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('palette preset name round-trips via canvas override', () => {
    // palette is runtime-only (no MindElixirData field). The canvas passes
    // its source-of-truth as the override arg.
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"palette":"dark"}\n-->';
    const data = outlineToMindElixirData(src);
    const runtime = readRuntimeMapStyle(src);
    expect(runtime.palette).toBe('dark');
    const out = mindElixirDataToOutline(data, runtime);
    expect(out).toBe(src);
  });

  it('background color round-trips via canvas override', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"background":"#fff8e1"}\n-->';
    const data = outlineToMindElixirData(src);
    const runtime = readRuntimeMapStyle(src);
    expect(runtime.background).toBe('#fff8e1');
    const out = mindElixirDataToOutline(data, runtime);
    expect(out).toBe(src);
  });

  it('sibling alignment "nodes" round-trips via canvas override', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"alignment":"nodes"}\n-->';
    const data = outlineToMindElixirData(src);
    const runtime = readRuntimeMapStyle(src);
    expect(runtime.alignment).toBe('nodes');
    const out = mindElixirDataToOutline(data, runtime);
    expect(out).toBe(src);
  });

  it('alignment "root" (default) is omitted from mapStyle', () => {
    const src = '- Root\n  - A\n  - B';
    const data = outlineToMindElixirData(src);
    // No override — alignment defaults to 'root', which is the default, so
    // it's NOT persisted.
    const out = mindElixirDataToOutline(data, { alignment: 'root' });
    expect(out).toBe(src);
    expect(out).not.toContain('mapStyle');
  });

  it('topic spacing round-trips via canvas override', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"topicSpacing":24}\n-->';
    const data = outlineToMindElixirData(src);
    const runtime = readRuntimeMapStyle(src);
    expect(runtime.topicSpacing).toBe(24);
    const out = mindElixirDataToOutline(data, runtime);
    expect(out).toBe(src);
  });

  it('all canvas fields round-trip together', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"direction":2,"compact":true,"palette":"dark","background":"#1a1a1a","alignment":"nodes","topicSpacing":18}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.direction).toBe(2);
    expect(data.compact).toBe(true);
    const runtime = readRuntimeMapStyle(src);
    expect(runtime).toMatchObject({
      palette: 'dark',
      background: '#1a1a1a',
      alignment: 'nodes',
      topicSpacing: 18,
    });
    const out = mindElixirDataToOutline(data, runtime);
    expect(out).toBe(src);
  });

  it('direction + rainbow OFF compose on the same mapStyle directive', () => {
    // direction=0 + rainbow:false — both on one mapStyle line.
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"direction":0,"rainbow":false}\n-->';
    const data = outlineToMindElixirData(src);
    expect(data.direction).toBe(0);
    expect(data.theme?.palette).toHaveLength(1);
    const out = mindElixirDataToOutline(data);
    expect(out).toBe(src);
  });

  it('emits no mapStyle directive when all fields are at default', () => {
    const src = '- Root\n  - A\n  - B';
    const data = outlineToMindElixirData(src);
    const out = mindElixirDataToOutline(data, {});
    expect(out).toBe(src);
    expect(out).not.toContain('mapStyle');
  });

  it('deriveMapStyle omits defaults and returns undefined when empty', () => {
    const data = outlineToMindElixirData('- Root\n  - A\n  - B');
    // no override — all defaults
    expect(deriveMapStyle(data)).toBeUndefined();
  });

  it('deriveMapStyle keeps override palette + data-derived direction', () => {
    const data = outlineToMindElixirData(
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"direction":2}\n-->',
    );
    const out = deriveMapStyle(data, { palette: 'pastel' });
    expect(out).toEqual({ direction: 2, palette: 'pastel' });
  });

  it('readRuntimeMapStyle drops rainbow/direction/compact (data-owned fields)', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"rainbow":false,"direction":0,"compact":true,"palette":"dark","background":"#abc","alignment":"nodes","topicSpacing":12}\n-->';
    const runtime = readRuntimeMapStyle(src);
    // Only runtime-only fields surfaced — direction/compact/rainbow are read
    // from data by outlineToMindElixirData.
    expect(runtime).toEqual({
      palette: 'dark',
      background: '#abc',
      alignment: 'nodes',
      topicSpacing: 12,
    });
  });
  it('deriveMapStyle round-trips non-default skeleton presets', () => {
    const data = outlineToMindElixirData('- Root\n  - A\n  - B');
    expect(deriveMapStyle(data, { skeleton: 'tree' })).toEqual({ skeleton: 'tree' });
    expect(deriveMapStyle(data, { skeleton: 'fishbone' })).toEqual({ skeleton: 'fishbone' });
    expect(deriveMapStyle(data, { skeleton: 'timeline' })).toEqual({ skeleton: 'timeline' });
    expect(deriveMapStyle(data, { skeleton: 'bracket' })).toEqual({ skeleton: 'bracket' });
    expect(deriveMapStyle(data, { skeleton: 'org' })).toEqual({ skeleton: 'org' });
    // mind is the default and is omitted
    expect(deriveMapStyle(data, { skeleton: 'mind' })).toBeUndefined();
  });

  it('readRuntimeMapStyle surfaces non-default skeleton', () => {
    const src =
      '- Root\n  - A\n  - B\n\n<!-- mmap:meta\nmapStyle: {"skeleton":"org"}\n-->';
    expect(readRuntimeMapStyle(src)).toEqual({ skeleton: 'org' });
    expect(readRuntimeMapStyle('- Root\n  - A')).toEqual({});
  });

});

describe('canvas palette presets (CANVAS_PALETTES / resolveCanvasPalette)', () => {
  it('every preset has a label and a non-empty colors array', () => {
    for (const [key, p] of Object.entries(CANVAS_PALETTES)) {
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(Array.isArray(p.colors)).toBe(true);
      expect(p.colors.length).toBeGreaterThan(1);
      // every entry is a hex color string
      for (const c of p.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      void key;
    }
  });

  it('resolveCanvasPalette returns the colors for known names and undefined otherwise', () => {
    expect(resolveCanvasPalette('dark')).toBe(CANVAS_PALETTES.dark.colors);
    expect(resolveCanvasPalette('classic')).toBe(CANVAS_PALETTES.classic.colors);
    expect(resolveCanvasPalette(undefined)).toBeUndefined();
    expect(resolveCanvasPalette('nope')).toBeUndefined();
  });

  it('classic palette matches mind-elixir default Latte (rainbow-ON)', () => {
    // The canvas treats picking 'classic' as a no-op (re-applies default).
    // Pin the exact colors so a future editor doesn't drift.
    expect(CANVAS_PALETTES.classic.colors).toEqual([
      '#dd7878', '#ea76cb', '#8839ef', '#e64553', '#fe640b',
      '#df8e1d', '#40a02b', '#209fb5', '#1e66f5', '#7287fd',
    ]);
  });
});
