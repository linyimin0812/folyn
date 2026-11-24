import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { chunkMarkdown } from './chunkMarkdown';

// The REAL parser stack the preview uses (minus raw-HTML handling, which the
// pipeline handles via rehypeRaw — html block spans are covered by the
// dedicated raw-tag cases below). The chunker's contract is that it never
// splits inside a top-level node: each chunk's line span
// [startLine, startLine+lineCount-1] must TILE the top-level node line
// spans — no boundary strictly inside a node, and full coverage.
const parser = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkGfm)
  .use(remarkDirective);

interface NodeSpan { type: string; start: number; end: number }

function nodeSpans(md: string): NodeSpan[] {
  const tree = parser.parse(md);
  return (tree.children as any[]).map((c) => ({
    type: c.type,
    start: c.position.start.line,
    end: c.position.end.line,
  }));
}

function chunkSpans(md: string) {
  const { chunks } = chunkMarkdown(md);
  return chunks.map((c) => ({
    start: c.startLine,
    end: c.startLine + c.lineCount - 1,
    lineCount: c.lineCount,
    text: c.text,
    blankLinesAfter: c.blankLinesAfter,
  }));
}

/** Every chunk boundary must land on a node boundary (or EOF); every node
 *  line must be covered by some chunk. */
function assertTilesNodes(md: string) {
  const spans = chunkSpans(md);
  const nodes = nodeSpans(md);
  const covered = new Set<number>();
  for (const c of spans) {
    for (const n of nodes) {
      const overlaps = c.start <= n.end && n.start <= c.end;
      if (!overlaps) continue;
      // The chunk must not START or END strictly inside the node.
      expect(
        c.start <= n.start,
        `chunk starts at ${c.start} inside node ${n.type}[${n.start}-${n.end}]: ${JSON.stringify(spans)}`,
      ).toBe(true);
      expect(
        c.end >= n.end,
        `chunk ends at ${c.end} inside node ${n.type}[${n.start}-${n.end}]: ${JSON.stringify(spans)}`,
      ).toBe(true);
    }
    for (let k = c.start; k <= c.end; k++) covered.add(k);
  }
  for (const n of nodes) {
    for (let k = n.start; k <= n.end; k++) {
      expect(covered.has(k), `line ${k} of node ${n.type}[${n.start}-${n.end}] uncovered: ${JSON.stringify(spans)}`).toBe(true);
    }
  }
  // Chunks tile without overlap.
  for (let i = 1; i < spans.length; i++) {
    expect(
      spans[i].start - spans[i - 1].end - 1,
      `chunks must not overlap (got ${JSON.stringify(spans)})`,
    ).toBe(spans[i - 1].blankLinesAfter);
  }
  return spans;
}

describe('chunkMarkdown', () => {
  it('splits simple paragraphs at single blank lines', () => {
    const spans = chunkSpans('a\n\nb\n\nc');
    expect(spans.map((s) => [s.start, s.end])).toEqual([[1, 1], [3, 3], [5, 5]]);
    expect(spans.map((s) => s.blankLinesAfter)).toEqual([1, 1, 0]);
    assertTilesNodes('a\n\nb\n\nc');
  });

  it('splits at multi-blank runs and reports the run length', () => {
    const spans = chunkSpans('a\n\n\n\nb');
    expect(spans.length).toBe(2);
    expect(spans[0].blankLinesAfter).toBe(3);
    assertTilesNodes('a\n\n\n\nb');
  });

  it('emits no chunks for empty / blank-only docs', () => {
    expect(chunkMarkdown('').chunks).toEqual([]);
    expect(chunkMarkdown('\n\n\n').chunks).toEqual([]);
  });

  it('keeps adjacent non-blank lines in one chunk (setext, table, tight list)', () => {
    const spans = chunkSpans('Title\n===\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail');
    expect(spans.length).toBe(3);
    assertTilesNodes('Title\n===\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail');
  });

  it('never splits inside fenced code — blank lines inside a fence are content', () => {
    const md = '```\na\n\nb\n```\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 5, lineCount: 5 });
    assertTilesNodes(md);
  });

  it('tilde fences; a backtick line inside a tilde fence is content; a longer run closes', () => {
    const md = '~~~\nx\n\n```\n```\n\n~~~~\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 7 });
    assertTilesNodes(md);
  });

  it('an unclosed fence runs to EOF as one chunk', () => {
    const md = '```\ncode\n\nmore\n\ntext';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    expect(spans[0].lineCount).toBe(6);
    expect(spans[0].blankLinesAfter).toBe(0);
    assertTilesNodes(md);
  });

  it('an indent-4 close line does not close a fence (indented content)', () => {
    const md = '```\na\n\n    ```\n\nb\n```';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
  });

  it('never splits inside $$ display math flow — closed by a lone $$ line', () => {
    const md = '$$\na = b\n\nx\n\n$$\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 6 });
    assertTilesNodes(md);
  });

  it('math flow with content on the open line spans blanks until a lone $$ line', () => {
    const md = '$$x\n\n$$\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 3 });
    assertTilesNodes(md);
  });

  it('math flow open lines with $ in the meta are paragraphs, not regions', () => {
    // meta rejects '$': $$x$$ / $$ $$ / $$x$y are paragraphs (inline math).
    const md = '$$ $$\n\nx\n\n$$';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(3);
    assertTilesNodes(md);
    assertTilesNodes('$$x$$\n\ny');
    assertTilesNodes('$$x$y\n\nafter');
  });

  it('a text-then-$$ line does NOT close math flow (runs to EOF)', () => {
    const md = '$$\nx a$$\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
    // '$$x … y$$' — the y$$ line is not a close either.
    const md2 = '$$x\n\ny$$\n\nafter';
    expect(chunkSpans(md2).length).toBe(1);
    assertTilesNodes(md2);
  });

  it('unclosed math runs to EOF across blanks', () => {
    const md = '$$x\n\npara\n\ntext';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
  });

  it('a close run must be at least as long as the open run', () => {
    // $$$ open, $$ does not close → math to EOF.
    const md = '$$$\nx\n$$\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
    // $$ open, $$$$ closes.
    const md2 = '$$\nx\n$$$$\n\nafter';
    const spans2 = chunkSpans(md2);
    expect(spans2[0]).toMatchObject({ start: 1, end: 3 });
    assertTilesNodes(md2);
  });

  it('an indented (1–3) lone $$ closes; indent 4+ does not', () => {
    const md = '$$\nx\n  $$\n\nafter';
    const spans = chunkSpans(md);
    expect(spans[0]).toMatchObject({ start: 1, end: 3 });
    assertTilesNodes(md);
    const md2 = '$$\nx\n    $$\n\nafter';
    expect(chunkSpans(md2).length).toBe(1);
    assertTilesNodes(md2);
  });

  it('two $$ lines: the second closes, a third opens a new region (one chunk)', () => {
    const md = '$$\n$$\n$$';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    expect(spans[0].lineCount).toBe(3);
    assertTilesNodes(md);
  });

  it('keeps \\[ … \\] bracket math whole across blank lines', () => {
    const md = 'before\n\n\\[\na = b\n\n\\]\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(3);
    expect(spans[1]).toMatchObject({ start: 3, end: 6 });
    assertTilesNodes(md);
  });

  it('balanced brackets on one line open no region', () => {
    const spans = chunkSpans('text \\(a\\) and \\[b\\]\n\nafter');
    expect(spans.length).toBe(2);
    assertTilesNodes('text \\(a\\) and \\[b\\]\n\nafter');
  });

  it('blockquotes split at blank lines (no quote state)', () => {
    const md = '> a\n\n> b';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    assertTilesNodes(md);
  });

  it('never splits inside a loose list (blank between items / indented continuation)', () => {
    const md = '- a\n\n- b\n\n  cont\n\n- c\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    assertTilesNodes(md);
  });

  it('indented code after a blank stays with the preceding chunk (blank-inside-code)', () => {
    const md = 'para\n\n    code\n\n    more';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
  });

  it('an indented (1-3) paragraph after a blank splits (no list open)', () => {
    const md = 'para\n\n  indented para';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    assertTilesNodes(md);
  });

  it('directive containers span blanks; a close line ends the region', () => {
    const md = ':::note\n\ntext\n\n:::\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 5 });
    assertTilesNodes(md);
  });

  it('a space after ::: makes it a paragraph, not a directive (no region)', () => {
    const spans = chunkSpans('::: note\n\nx\n\n:::');
    expect(spans.length).toBe(3);
  });

  it('nested directives stack; a close line pops one level (parser closes earlier — chunk is a safe superset)', () => {
    const md = ':::a\n\n::::b\n\ny\n\n::::\n\n:::\n\nz';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 9 });
    assertTilesNodes(md);
  });

  it('an unclosed directive runs to EOF', () => {
    const md = ':::note\n\ntext\n\nmore';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
    assertTilesNodes(md);
  });

  it('a fence inside a directive suspends ::: close detection', () => {
    const md = ':::a\n```\ncode\n\n:::\n\n```\n:::';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(1);
  });

  it('raw HTML comments span blanks until -->', () => {
    const md = '<!--\ncomment\n\nmore\n-->\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 5 });
  });

  it('CDATA and declarations span blanks until their closer', () => {
    const spans = chunkSpans('<![CDATA[\nx\n\n]]>\n\nafter');
    expect(spans[0]).toMatchObject({ start: 1, end: 4 });
    const spans2 = chunkSpans('<!DOCTYPE\nhtml>\n\nafter');
    expect(spans2[0]).toMatchObject({ start: 1, end: 2 });
  });

  it('type-1 raw blocks (pre/script/style/textarea) span blanks until a line containing the close tag', () => {
    const md = '<pre>\ncode\n\n</pre>\n\nafter';
    const spans = chunkSpans(md);
    expect(spans[0]).toMatchObject({ start: 1, end: 4 });
    assertTilesNodes(md);
    const md2 = '<script>\nlet a = 1;\n\nalert(1);\n</script>\n\nafter';
    expect(chunkSpans(md2)[0]).toMatchObject({ start: 1, end: 5 });
    // Close tag mid-line ends the block at that line.
    const md3 = '<textarea>\ntext\n\n</textarea> tail\n\nafter';
    expect(chunkSpans(md3)[0]).toMatchObject({ start: 1, end: 4 });
  });

  it('unknown-tag runs: a lone open-tag line opens, a lone or trailing close-tag line ends', () => {
    const md = '<foo>\ncontent\n\n</foo>\n\nafter';
    const spans = chunkSpans(md);
    expect(spans[0]).toMatchObject({ start: 1, end: 4 });
    const md2 = 'text\n\n<foo>\n\nx\n\ntext </foo>\n\nafter';
    const spans2 = chunkSpans(md2);
    expect(spans2[1]).toMatchObject({ start: 3, end: 7 });
  });

  it('void tags and self-closing tags open no run', () => {
    const spans = chunkSpans('<br>\n\nx\n\n<img src="a">\n\ny');
    expect(spans.length).toBe(4);
  });

  it('known containers (div) also open a run — they wrap across blanks via rehypeRaw', () => {
    const md = '<div>\n\nx\n\n</div>\n\nafter';
    const spans = chunkSpans(md);
    expect(spans[0]).toMatchObject({ start: 1, end: 5 });
  });

  it('a multi-line type-6 open tag (bare <name at EOL) opens a run — no boundary between open and close', () => {
    // `<div`⏎`  class="x">` is a valid CommonMark type-6 opener whose
    // attributes continue on the next line. Without a region here, a chunk
    // boundary landed between the open and its close: the FULL render
    // (rehypeRaw) wraps the inner paragraph in the div, the CHUNKED render
    // parsed the open/close tags in separate chunks and did not — a
    // parity violation.
    const md = '<div\n  class="x">\n\ninner paragraph\n\n</div>\n\nafter';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(2);
    expect(spans[0]).toMatchObject({ start: 1, end: 6, lineCount: 6 });
    assertTilesNodes(md);
    // Same shape with a self-closing-lookalike close and deeper attrs.
    const md2 = 'before\n\n<section\n  data-a="1"\n  data-b="2">\n\ninner\n\n</section>\n\nafter';
    const spans2 = chunkSpans(md2);
    expect(spans2[1]).toMatchObject({ start: 3, end: 9 });
    assertTilesNodes(md2);
  });

  it('a bare VOID tag name at EOL opens no run (no close tag exists)', () => {
    // intro | <br | x | after — `<br` cannot open a region: void tags never
    // close, a run would swallow the rest of the doc for nothing.
    const spans = chunkSpans('intro\n\n<br\n\nx\n\nafter');
    expect(spans.map((s) => [s.start, s.end])).toEqual([[1, 1], [3, 3], [5, 5], [7, 7]]);
  });

  it('reference definitions are detected at top level (line start, indent ≤3)', () => {
    expect(chunkMarkdown('[foo]: /url\n\nbar').hasReferenceDefinitions).toBe(true);
    expect(chunkMarkdown('bar\n\n  [a]: /u\n\nqux').hasReferenceDefinitions).toBe(true);
    // 'baz [a]: /u' is a paragraph, not a link definition.
    expect(chunkMarkdown('bar\n\nbaz [a]: /u\n\nqux').hasReferenceDefinitions).toBe(false);
    expect(chunkMarkdown('```\n[x]: url\n```\n\nafter').hasReferenceDefinitions).toBe(false);
    expect(chunkMarkdown('a\n\nb').hasReferenceDefinitions).toBe(false);
  });

  it('trailing blank lines become the last chunk blankLinesAfter, not text', () => {
    const { chunks } = chunkMarkdown('a\n\nb\n\n\n\n');
    expect(chunks.length).toBe(2);
    expect(chunks[1].text).toBe('b');
    expect(chunks[1].blankLinesAfter).toBe(4);
    expect(chunks[1].lineCount).toBe(1);
  });

  it('startLine is body-relative 1-based; text joins exactly the chunk lines', () => {
    const { chunks } = chunkMarkdown('\n\na\n\nb');
    expect(chunks[0].startLine).toBe(3);
    expect(chunks[0].text).toBe('a');
    expect(chunks[0].blankLinesAfter).toBe(1);
  });

  it('CRLF line endings are handled (split chunks, no \\r in text)', () => {
    const { chunks } = chunkMarkdown('a\r\n\r\nb\r\n');
    expect(chunks.length).toBe(2);
    expect(chunks[0].text).toBe('a');
    expect(chunks[1].text).toBe('b');
    expect(chunks[0].blankLinesAfter).toBe(1);
    expect(chunks[1].blankLinesAfter).toBe(1);
  });

  it('over-merges instead of over-splitting: chunk text is an exact source slice', () => {
    // Round-trip: the renderer pads each chunk to its startLine, so each
    // chunk must be the EXACT contiguous slice of body lines.
    const md = '# h\n\n```\ncode\n\nmore\n```\n\n:::note\n\nx\n\n:::\n\ntail  \n\n';
    const { chunks } = chunkMarkdown(md);
    const lines = md.split('\n');
    for (const c of chunks) {
      expect(c.text.split('\n')).toEqual(lines.slice(c.startLine - 1, c.startLine - 1 + c.lineCount));
    }
  });

  it('math inside a blockquote ends when the blockquote ends (blank splits)', () => {
    // Each '> $$ …' quote line group is its own chunk; the unclosed math
    // inside a quote ends at the quote end (parser-verified).
    const md = '> $$\n> a\n\n> $$\n\n> b';
    const spans = chunkSpans(md);
    expect(spans.length).toBe(3);
    assertTilesNodes(md);
  });

  it('performance: 1MB synthetic doc chunks in <30ms', () => {
    const para = 'word '.repeat(20).trim();
    const repeat = Math.ceil(1_000_000 / (para.length + 1));
    const doc = Array.from({ length: repeat }, () => para).join('\n\n');
    const t0 = performance.now();
    const { chunks } = chunkMarkdown(doc);
    const dt = performance.now() - t0;
    expect(chunks.length).toBeGreaterThan(5000);
    expect(dt).toBeLessThan(30);
  });
});
