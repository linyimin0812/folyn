import { describe, it, expect, vi } from 'vitest';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Text, type DecorationSet } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { foldable } from '@codemirror/language';
import { mathExtension, buildMathDecorations, computeMathFoldRange } from './MarkdownMathExtension';
import { findMathSegments } from '@/services/markdown/renderMarkdown';

function makeView(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [keymap.of(defaultKeymap), ...mathExtension],
  });
  return new EditorView({ state, parent: document.body });
}

function mathClasses(view: EditorView): string[] {
  // ponytail: jsdom renders CodeMirror's Decoration.mark classes as real
  // spans. We walk the content DOM to collect them.
  const marks = view.contentDOM.querySelectorAll('.tok-math-inline, .tok-math-display');
  return Array.from(marks).map((el) => el.className);
}

describe('MarkdownMathExtension', () => {
  it('highlights $..$ inline math', () => {
    const view = makeView('inline $x^2$ here');
    const classes = mathClasses(view);
    expect(classes.some((c) => c.includes('tok-math-inline'))).toBe(true);
    view.destroy();
  });

  it('highlights $$..$$ display math', () => {
    const view = makeView('display $$y^2$$ end');
    const classes = mathClasses(view);
    expect(classes.some((c) => c.includes('tok-math-display'))).toBe(true);
    view.destroy();
  });

  it('highlights \\[..\\] and \\(..\\) markers', () => {
    const view = makeView('display \\[a\\] inline \\(b\\)');
    const classes = mathClasses(view);
    expect(classes.filter((c) => c.includes('tok-math-display')).length).toBe(1);
    expect(classes.filter((c) => c.includes('tok-math-inline')).length).toBe(1);
    view.destroy();
  });

  it('does NOT highlight math inside fenced code blocks', () => {
    const view = makeView('```js\nconst x = "$y$";\n```');
    expect(mathClasses(view).length).toBe(0);
    view.destroy();
  });

  it('does NOT highlight math inside inline code spans', () => {
    const view = makeView('see `$x$` here');
    expect(mathClasses(view).length).toBe(0);
    view.destroy();
  });

  it('does NOT treat \\$ escape as math open', () => {
    // \$5 is escape + literal 5 — not a math open. The trailing $x$ IS math.
    const segs = findMathSegments('price \\$5 and $x$');
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('inline');
  });

  it('updates decorations when doc changes', () => {
    const view = makeView('text');
    expect(mathClasses(view).length).toBe(0);
    view.dispatch({ changes: { from: 4, to: 4, insert: ' $x$' } });
    expect(mathClasses(view).some((c) => c.includes('tok-math-inline'))).toBe(true);
    view.destroy();
  });
});

// ── Fold service (run-scoped, cursor-gated) ───────────────────────────────

/** State with the math fold service installed and the cursor at `cursor`. */
function foldState(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, extensions: mathExtension, selection: { anchor: cursor } });
}

describe('computeMathFoldRange', () => {
  it('folds a single-line $$..$$ block (inner range between the markers)', () => {
    // 'display ' is 8 chars; $$y^2$$ spans 8..14 (to 15); inner = y^2
    const state = foldState('display $$y^2$$ end', 12);
    const line = state.doc.line(1);
    expect(computeMathFoldRange(state, line.from, line.to)).toEqual({ from: 10, to: 13 });
  });

  it('folds a multi-line $$..$$ block queried from a middle line', () => {
    const state = foldState('before\n$$\nfoo bar\n$$\nafter', 13);
    const line = state.doc.line(3); // 'foo bar'
    // block = $$\nfoo bar\n$$ at 7..19; inner range 9..18
    expect(computeMathFoldRange(state, line.from, line.to)).toEqual({ from: 9, to: 18 });
  });

  it('folds a multi-line \\[..\\] block', () => {
    const state = foldState('a\n\\[\ninner math\n\\]\nb', 10);
    const line = state.doc.line(3); // 'inner math'
    // block = \[\ninner math\n\] at 2..17; inner range 4..16
    expect(computeMathFoldRange(state, line.from, line.to)).toEqual({ from: 4, to: 16 });
  });

  it('returns null when the cursor is outside the queried line', () => {
    // foldGutter asks for EVERY viewport line — only the cursor's line may fold
    const state = foldState('display $$y^2$$ end', 17); // cursor in 'end', past the block
    const line = state.doc.line(1);
    expect(computeMathFoldRange(state, line.from, line.to)).toBeNull();
  });

  it('returns null for inline math only', () => {
    const state = foldState('inline $x$ here', 8);
    const line = state.doc.line(1);
    expect(computeMathFoldRange(state, line.from, line.to)).toBeNull();
  });

  it('returns null for a display block too short to fold', () => {
    const state = foldState('$$$$', 2); // degenerate 4-char block
    const line = state.doc.line(1);
    expect(computeMathFoldRange(state, line.from, line.to)).toBeNull();
  });

  it('returns null for math inside a fenced code block', () => {
    // one run: the fence markers are in the same run as the math → guard
    const state = foldState('```\n$$\ncode math\n$$\n```', 13);
    const line = state.doc.line(3);
    expect(computeMathFoldRange(state, line.from, line.to)).toBeNull();
  });

  it('is exposed through foldable() (foldGutter path)', () => {
    const state = foldState('before\n$$\nfoo bar\n$$\nafter', 13);
    const line = state.doc.line(3);
    expect(foldable(state, line.from, line.to)).toEqual({ from: 9, to: 18 });
  });

  it('does not materialize the whole doc across per-viewport-line fold queries', () => {
    // Simulate foldGutter: it asks foldable() for every viewport line on
    // every doc/viewport change. On the old whole-doc implementation that
    // was ~N full-doc toString() per keystroke on multi-MB files.
    const lines: string[] = [];
    for (let i = 1; i <= 2000; i++) lines.push(`filler text ${i}`);
    // blank-separator + display math on line 1500: its run is ONE line, so
    // the fold's scan window is 31 chars, not the ≈26KB doc.
    lines[1498] = '';
    lines[1499] = 'before $$huge math block$$ after';
    lines[1500] = '';
    const doc = Text.of(lines);
    const cursorLine = 1500;
    const cursor = doc.line(cursorLine).from + 7;
    const state = EditorState.create({ doc, extensions: mathExtension, selection: { anchor: cursor } });

    const toStringSpy = vi.spyOn(state.doc, 'toString');
    const sliceSpy = vi.spyOn(state.doc, 'sliceString');
    try {
      // 60 viewport lines' worth of queries, cursor's line in the middle
      for (let n = 1470; n <= 1530; n++) {
        const line = state.doc.line(n);
        sliceSpy.mockClear();
        const range = foldable(state, line.from, line.to);
        if (n !== cursorLine) {
          // cheap cursor-range early-return: no string materialization at all
          expect(sliceSpy).not.toHaveBeenCalled();
        } else {
          expect(range).toEqual({
            from: doc.line(cursorLine).from + 9,
            to: doc.line(cursorLine).from + 24,
          });
          expect(sliceSpy).toHaveBeenCalled(); // guards a vacuous pass
          // scans only the run, never the whole (≈26KB) doc
          for (const [f, t] of sliceSpy.mock.calls) {
            expect((t as number) - (f as number)).toBeLessThanOrEqual(200);
          }
        }
      }
      expect(toStringSpy).not.toHaveBeenCalled();
      // sanity: the spies really intercept (a non-intercepting spy would
      // make the assertions above vacuous)
      void state.doc.sliceString(0, 1);
      expect(sliceSpy).toHaveBeenCalled();
      void state.doc.toString();
      expect(toStringSpy).toHaveBeenCalledOnce();
    } finally {
      toStringSpy.mockRestore();
      sliceSpy.mockRestore();
    }
  });
});

// ── Viewport-scoped highlight ─────────────────────────────────────────────

/** Decoration spans of a set as (from, to, class) tuples. RangeCursor
 *  starts at the first range; `value != null` marks the end. */
function decorationSpans(set: DecorationSet): { from: number; to: number; cls: string }[] {
  const out: { from: number; to: number; cls: string }[] = [];
  for (let cur = set.iter(); cur.value != null; cur.next()) {
    const cls = (cur.value.spec as { class?: string }).class ?? '';
    out.push({ from: cur.from, to: cur.to, cls });
  }
  return out;
}

describe('buildMathDecorations (visible-range scoped)', () => {
  it('decorates only math inside the given ranges (scan-window scoped)', () => {
    // runs: 'a $x$' | blank | 'b $$y$$'
    const state = EditorState.create({ doc: 'a $x$\n\nb $$y$$', extensions: mathExtension });
    const line3 = state.doc.line(3);
    const spans = decorationSpans(buildMathDecorations(state, [{ from: line3.from, to: line3.to }]));
    // only the display math of line 3; the off-range inline math of line 1 is skipped
    expect(spans).toEqual([{ from: 9, to: 14, cls: expect.stringContaining('tok-math-display') }]);
  });

  it('returns no decorations for ranges without math', () => {
    const state = EditorState.create({ doc: 'a $x$\n\nplain', extensions: mathExtension });
    const line3 = state.doc.line(3);
    const spans = decorationSpans(buildMathDecorations(state, [{ from: line3.from, to: line3.to }]));
    expect(spans).toEqual([]);
  });

  it('extends the scan to the run around the range (boundary blocks)', () => {
    // one run: intro / $$ / multi / line / $$ / tail — a display block
    // straddling the range must still be decorated as a whole.
    const state = EditorState.create({ doc: 'intro\n$$\nmulti\nline\n$$\ntail', extensions: mathExtension });
    const line3 = state.doc.line(3); // 'multi'
    const spans = decorationSpans(buildMathDecorations(state, [{ from: line3.from, to: line3.to }]));
    expect(spans).toEqual([{ from: 6, to: 22, cls: expect.stringContaining('tok-math-display') }]);
  });

  it('does not materialize the whole doc for visible-range scans', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 2000; i++) {
      lines.push(`filler text ${i}`);
      if (i % 10 === 0) lines.push(''); // blank line every 10 → short runs
    }
    const doc = Text.of(lines);
    const state = EditorState.create({ doc, extensions: mathExtension });
    const toStringSpy = vi.spyOn(state.doc, 'toString');
    const sliceSpy = vi.spyOn(state.doc, 'sliceString');
    try {
      // a viewport-sized range near the top of a ≈27KB doc
      const view0 = doc.line(1).from;
      const view1 = doc.line(35).to;
      const spans = decorationSpans(buildMathDecorations(state, [{ from: view0, to: view1 }]));
      expect(spans).toEqual([]); // no math in the fillers
      expect(toStringSpy).not.toHaveBeenCalled();
      // scans only the window (≈40 lines), never the whole ≈27KB doc
      for (const [f, t] of sliceSpy.mock.calls) {
        expect((t as number) - (f as number)).toBeLessThanOrEqual(1000);
      }
      // sanity: the spies really intercept (a non-intercepting spy would
      // make the assertions above vacuous)
      void state.doc.sliceString(0, 1);
      expect(sliceSpy).toHaveBeenCalled();
      void state.doc.toString();
      expect(toStringSpy).toHaveBeenCalledOnce();
    } finally {
      toStringSpy.mockRestore();
      sliceSpy.mockRestore();
    }
  });
});

describe('MarkdownMathExtension (long document, DOM)', () => {
  it('does not decorate math beyond the viewport', () => {
    const early = 'start $x$ math'; // line 1 — inside the jsdom viewport
    const filler = Array.from({ length: 3000 }, (_, i) => `filler line ${i + 1}`);
    const late = 'end $$y$$ math'; // line 3002 — far beyond the viewport
    const view = makeView([early, ...filler, late].join('\n'));
    const classes = mathClasses(view);
    // near-viewport math is highlighted…
    expect(classes.some((c) => c.includes('tok-math-inline'))).toBe(true);
    // …off-viewport math has no highlight until it scrolls into view
    expect(classes.some((c) => c.includes('tok-math-display'))).toBe(false);
    view.destroy();
  });
});
