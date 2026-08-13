import { describe, it, expect } from 'vitest';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { mathExtension } from './MarkdownMathExtension';
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
