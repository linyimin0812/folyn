// @vitest-environment jsdom
/**
 * Parity tests for chunked markdown rendering (Phase A2 of the
 * markdown-large-file-open-lag fix): rendering a document chunk-by-chunk
 * through the shared pipeline (with '\n' padding + per-chunk blank-gap
 * offset/totalLines) must match the full-document render.
 *
 * What is asserted, and why:
 *
 * 1. STRICT mode (default — docs whose every root element carries
 *    data-source-line): the ENTIRE normalized child sequence must match —
 *    same tags, same data-source-line stamps, same .md-blank-gap heights.
 *    This is the contract cursor-sync (block queries), gap compensation
 *    (children walk) and export extraction depend on.
 *
 * 2. STRUCTURE mode (docs containing nodes that render WITHOUT
 *    data-source-line and without source positions — mjx-containers from
 *    display math, the raw-tag fallback for unknown tags with an empty
 *    component map, link reference definitions that render nothing): the
 *    STAMPED entry sequence (tags + lines + root text) must still match
 *    exactly, but gap heights/positions are compared loosely. Reason: the
 *    full render's static gap arithmetic cannot see those nodes — it
 *    overcounts their lines as blanks (e.g. a gap after display math is
 *    sized for blank+math lines) or emits a trailing gap where the doc ends
 *    in unstamped content; the per-chunk arithmetic counts the REAL blank
 *    lines (the chunker knows the spanning regions), so the two disagree
 *    statically exactly where the full value is wrong. The runtime gap
 *    compensation (MarkdownPreview's useLayoutEffect) pins every following
 *    block to the editor's line grid in both modes, equalizing the final
 *    geometry — and no consumer reads static gap heights.
 *
 * The walker inspects only the rehype-react root's TOP-LEVEL children;
 * deep structure is covered by the full-render suites (renderMarkdown.test.ts
 * / MarkdownPreview.*), and chunk-boundary-vs-parser-node parity is covered
 * by chunkMarkdown.test.ts (assertTilesNodes).
 */
import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import { parseFrontmatter } from './frontmatter';
import { chunkMarkdown } from './chunkMarkdown';
import { renderMarkdownBody, type MarkdownPipelineOptions } from './markdownPipeline';

/** Minimal component map — parity must hold with zero custom components. */
const CM: Record<string, React.ComponentType<any>> = {};

/**
 * Per-parse / whitespace-noise elements with no contract consumer (no
 * data-source-line, not blocks):
 *  - `style`: rehype-mathjax scoped styles — one per PARSE, so chunked
 *    renders carry one per chunk (full render: one for the whole doc).
 *  - `br`: root-level brs appear only via rehypeShowRawTags' sibling
 *    newline→br rule when an unknown element is spliced at root level;
 *    chunked parses lack the inter-block separator newline at chunk
 *    boundaries.
 */
const NOISE_TAGS = new Set(['style', 'br']);

type Entry =
  | { t: 'text'; v: string }
  | { t: 'gap'; h: number }
  | { t: 'el'; tag: string; line: number | undefined };

function parseGapHeight(styleHeight: unknown): number {
  const m = /calc\((\d+) \*/.exec(String(styleHeight ?? ''));
  return m ? Number(m[1]) : 0;
}

function describeChild(kid: unknown): Entry | null {
  if (kid == null || typeof kid === 'boolean') return null;
  if (typeof kid === 'string' || typeof kid === 'number') {
    // remark-rehype keeps the source newline between blocks as a root
    // whitespace text node; per-chunk parses don't see the separator. Pure
    // whitespace between block elements is layout-inert and invisible to
    // every consumer (children walks / querySelectorAll) — normalize out.
    if (/^\s*$/.test(String(kid))) return null;
    return { t: 'text', v: String(kid) };
  }
  if (!isValidElement(kid)) return null;
  const props: Record<string, unknown> = (kid.props ?? {}) as Record<string, unknown>;
  const cls = typeof props.className === 'string' ? props.className : '';
  const tag = typeof kid.type === 'string' ? kid.type : `comp:${String((kid.type as any)?.displayName ?? 'anon')}`;
  if (NOISE_TAGS.has(tag)) return null;
  if (cls.includes('md-blank-gap')) {
    const style = (props.style ?? {}) as Record<string, unknown>;
    return { t: 'gap', h: parseGapHeight(style.height) };
  }
  const line = props['data-source-line'];
  return { t: 'el', tag, line: line == null ? undefined : Number(line) };
}

function topLevel(el: React.ReactElement): Entry[] {
  const kids = (el.props as { children?: unknown }).children;
  const arr = Array.isArray(kids) ? kids : [kids];
  return arr.map(describeChild).filter((x): x is Entry => x != null);
}

/** Render a doc's FULL body — the reference sequence. */
function renderFull(body: string, fl: number, docTotal: number, sync: boolean): Entry[] {
  const opts: MarkdownPipelineOptions = {
    componentMap: CM,
    sourceLineOffset: fl,
    blankGap: sync ? { offset: fl, totalLines: docTotal } : undefined,
  };
  return topLevel(renderMarkdownBody(body, opts));
}

/** Render a doc chunk-by-chunk exactly like MarkdownPreview does. */
function renderChunked(body: string, fl: number, docTotal: number, sync: boolean): Entry[] {
  const { chunks } = chunkMarkdown(body);
  const out: Entry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const isLast = i === chunks.length - 1;
    const prevEnd = i === 0 ? 0 : chunks[i - 1].startLine + chunks[i - 1].lineCount - 1;
    const gapOffset = i === 0 ? fl : -prevEnd;
    const totalLines = isLast ? Math.max(0, docTotal - fl - (i === 0 ? 0 : prevEnd)) : undefined;
    const padded = '\n'.repeat(c.startLine - 1) + c.text;
    out.push(...topLevel(renderMarkdownBody(padded, {
      componentMap: CM,
      sourceLineOffset: fl,
      blankGap: sync ? { offset: gapOffset, totalLines } : undefined,
    })));
  }
  return out;
}

function expectChunkedMatchesFull(md: string, mode: 'strict' | 'structure' = 'strict') {
  const { body, frontmatterLineCount: fl } = parseFrontmatter(md);
  const docTotal = md.split('\n').length;
  for (const sync of [true, false]) {
    const chunked = renderChunked(body, fl, docTotal, sync);
    const full = renderFull(body, fl, docTotal, sync);
    if (mode === 'structure') {
      // Drop gaps entirely; everything else (tags, data-source-line, text)
      // must still match 1:1 — no content may be dropped, duplicated or
      // re-stamped by chunking.
      const dropGaps = (s: Entry[]) => s.filter((e) => e.t !== 'gap');
      expect(dropGaps(chunked)).toEqual(dropGaps(full));
    } else {
      expect(chunked).toEqual(full);
    }
  }
}

describe('markdownPipeline chunk/full parity', () => {
  it('plain paragraphs with varying blank runs', () => {
    expectChunkedMatchesFull([
      'first para.',
      '',
      'second para spans',
      'two lines.',
      '',
      '',
      '',
      'third para after a triple blank.',
      '',
      'final.',
    ].join('\n'));
  });

  it('frontmatter + leading blanks', () => {
    expectChunkedMatchesFull([
      '---',
      'title: t',
      'tags: [a]',
      '---',
      '',
      'body starts here.',
      '',
      'more body.',
    ].join('\n'));
  });

  it('fenced code blocks (unclosed fence runs to EOF)', () => {
    expectChunkedMatchesFull([
      'para one.',
      '',
      '```js',
      'const a = 1;',
      '',
      'const b = 2; // blank INSIDE the fence must not split',
      '```',
      '',
      'para two.',
      '',
      '~~~',
      'tilde fence with ``` inside',
      '~~~',
      '',
      'para three.',
      '',
      '```',
      'unclosed fence runs to EOF',
      'still inside',
    ].join('\n'));
  });

  it('display math (open/close runs, $$ does not close $$$)', () => {
    // mjx-containers are unpositioned → STRUCTURE mode (see file header).
    expectChunkedMatchesFull([
      'para.',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      'para two.',
      '',
      '$$',
      'a + b',
      '',
      'blank inside math must not split',
      '$$$',
      '',
      'para three.',
      '',
      '$$',
      'unclosed math to EOF',
    ].join('\n'), 'structure');
  });

  it('loose lists + nested content', () => {
    expectChunkedMatchesFull([
      'intro.',
      '',
      '- item one',
      '',
      '  continuation of item one',
      '',
      '- item two',
      '  second line',
      '',
      'after list.',
      '',
      '1. ordered',
      '',
      '2. second',
      '',
      'after ordered.',
    ].join('\n'));
  });

  it('directives (container with inner fences + blanks)', () => {
    // With an empty component map the directive falls back to the
    // raw-tag display (unpositioned splices) → STRUCTURE mode.
    expectChunkedMatchesFull([
      'before.',
      '',
      '::::file-preview',
      '',
      'inner paragraph',
      '',
      '```',
      'code inside directive',
      '',
      'still inside',
      '```',
      '',
      '::::',
      '',
      'after directive.',
    ].join('\n'), 'structure');
  });

  it('headings, setext, hr, blockquote, tables', () => {
    expectChunkedMatchesFull([
      '# Heading',
      '',
      'setext heading',
      '===',
      '',
      '---',
      '',
      '> quote line',
      '>',
      '> quote continues',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '### Another heading',
      '',
      'done.',
    ].join('\n'));
  });

  it('raw HTML runs (pre/comment/tag-run)', () => {
    expectChunkedMatchesFull([
      'para.',
      '',
      '<div class="raw">',
      'inner line',
      '</div>',
      '',
      'para two.',
      '',
      '<pre>',
      'raw pre content',
      '</pre>',
      '',
      'para three.',
      '',
      '<!-- multi-line comment',
      '',
      'still comment',
      '-->',
      '',
      'after comment.',
    ].join('\n'));
  });

  it('trailing EOF blank lines (EOF gap parity)', () => {
    expectChunkedMatchesFull([
      'para.',
      '',
      'another.',
      '',
      '',
      '',
    ].join('\n'));
  });

  it('inline link + reference usage keeps parity when defs are local', () => {
    // Reference definitions render nothing (invisible to the gap plugin's
    // static arithmetic — full overcounts their lines) → STRUCTURE mode.
    expectChunkedMatchesFull([
      'para with [link](https://x.dev) and [ref] usage.',
      '',
      '[ref]: https://ref.dev',
      '',
      'next para uses [ref] after the def.',
    ].join('\n'), 'structure');
  });

  it('kitchen-sink doc (every construct interleaved)', () => {
    // Contains display math + raw runs → STRUCTURE mode.
    expectChunkedMatchesFull([
      '---',
      'title: kitchen sink',
      '---',
      '',
      '# Top',
      '',
      'intro para **bold** with `code` and $inline math$.',
      '',
      '```ts',
      'const x: number = 1; // fence',
      '',
      'const y = 2;',
      '```',
      '',
      '$$',
      'block math',
      '$$',
      '',
      '- list a',
      '',
      '- list b',
      '',
      '> quote',
      '',
      '<div>',
      'raw run',
      '</div>',
      '',
      '<!-- comment',
      '',
      'end -->',
      '',
      'tail para.',
      '',
      '',
    ].join('\n'), 'structure');
  });

  it('every chunk boundary is a real boundary (no dropped/dup lines)', () => {
    // Chunks must TILE the body exactly: every line is either inside one
    // chunk's text or a declared inter-chunk blank (blankLinesAfter).
    const body = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? `# h ${i}` : i % 3 === 1 ? `para ${i}\ncont ${i}` : `- item ${i}\n- item ${i}b`,
    ).join('\n\n');
    const srcLines = body.split('\n');
    const total = srcLines.length;
    const { chunks } = chunkMarkdown(body);
    const covered = new Array<boolean>(total).fill(false);
    for (const c of chunks) {
      const textLines = c.text.split('\n');
      expect(textLines.length).toBe(c.lineCount);
      for (let k = 0; k < textLines.length; k++) {
        const idx = c.startLine - 1 + k;
        expect(idx).toBeLessThan(total);
        expect(covered[idx]).toBe(false); // no overlap between chunks
        covered[idx] = true;
        expect(srcLines[idx]).toBe(textLines[k]); // exact source text
      }
    }
    let blankSum = 0;
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const prevEnd = prev.startLine + prev.lineCount - 1; // 1-based last line
      const blanks = chunks[i].startLine - prevEnd - 1;
      expect(blanks).toBe(prev.blankLinesAfter);
      blankSum += blanks;
      for (let k = 0; k < blanks; k++) {
        expect(srcLines[prevEnd + k]).toBe(''); // declared gaps are blank lines
        expect(covered[prevEnd + k]).toBe(false);
      }
    }
    // Trailing blanks after the last chunk are its blankLinesAfter.
    blankSum += chunks[chunks.length - 1].blankLinesAfter;
    // Complete tiling: content lines + gap lines = the whole body.
    expect(covered.filter(Boolean).length + blankSum).toBe(total);
  });
});
