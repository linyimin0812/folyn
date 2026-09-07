import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { computeHeadingFoldRange, headingFoldExtension } from './headingFoldExtension';
import { foldable } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

function stateAt(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [...headingFoldExtension] });
}

/** line number → {start, end} document offsets for that line (1-based n). */
function lineOffsets(state: EditorState, n: number) {
  const line = state.doc.line(n);
  return { start: line.from, end: line.to };
}

describe('computeHeadingFoldRange', () => {
  it('folds an H1 section including its H2 subsection (lower level does NOT stop)', () => {
    // # H1  \n a \n ## H2 \n b
    const doc = '# H1\na\n## H2\nb';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    const range = computeHeadingFoldRange(state, start, end)!;
    // H2 is a LOWER level (2 > 1), so it belongs to the H1 section — the fold
    // range extends to the end of the document (no same/higher heading follows).
    expect(range.from).toBe(end);
    expect(range.to).toBe(state.doc.line(4).to); // last line end
  });

  it('stops at the same-level heading', () => {
    const doc = '# A\nbody\n# B\nbody';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    const range = computeHeadingFoldRange(state, start, end)!;
    // folds 'body' (line 2), stops before '# B' (line 3)
    expect(range.to).toBe(state.doc.line(2).to);
  });

  it('stops at a HIGHER-level heading (## section stops at next #)', () => {
    const doc = '## A\nbody\n# B';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    const range = computeHeadingFoldRange(state, start, end)!;
    expect(range.to).toBe(state.doc.line(2).to); // 'body'
  });

  it('folds to the end of the document when no same/higher heading follows', () => {
    const doc = '# A\nb\nc';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    const range = computeHeadingFoldRange(state, start, end)!;
    expect(range.to).toBe(state.doc.line(3).to); // last line end
  });

  it('returns null for a single heading with no following line', () => {
    const doc = '# Only';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(computeHeadingFoldRange(state, start, end)).toBeNull();
  });

  it('returns null when the next line is already a SAME-level heading', () => {
    const doc = '# A\n# B';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(computeHeadingFoldRange(state, start, end)).toBeNull();
  });

  it('returns null when the next line is a HIGHER-level heading (## stops at #)', () => {
    const doc = '## A\n# B';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(computeHeadingFoldRange(state, start, end)).toBeNull();
  });

  it('returns null for a non-heading line', () => {
    const doc = 'plain text\nmore';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(computeHeadingFoldRange(state, start, end)).toBeNull();
  });

  it('handles all six heading levels as headings', () => {
    for (const h of ['#', '##', '###', '####', '#####', '######']) {
      const doc = `${h} T\nbody`;
      const state = stateAt(doc);
      const { start, end } = lineOffsets(state, 1);
      expect(computeHeadingFoldRange(state, start, end)).not.toBeNull();
    }
  });

  it('does not treat `#` without a space (tag) as a heading', () => {
    const doc = '#tag\nbody';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(computeHeadingFoldRange(state, start, end)).toBeNull();
  });
});

describe('headingFoldExtension — foldService integration', () => {
  it('foldable() returns the heading range via the registered foldService', () => {
    const doc = '# A\nbody\n## B\nc';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    // foldable() is what foldGutter calls internally; it consults foldService.
    const range = foldable(state, start, end);
    expect(range).not.toBeNull();
    // H1 section includes the H2 subsection → folds to end of document.
    expect(range!.to).toBe(state.doc.line(4).to);
  });

  it('foldable() returns null for a non-heading line', () => {
    const doc = 'plain\nmore';
    const state = stateAt(doc);
    const { start, end } = lineOffsets(state, 1);
    expect(foldable(state, start, end)).toBeNull();
  });

  it('mounts without error in a real EditorView', () => {
    const state = EditorState.create({
      doc: '# A\nbody',
      extensions: [...headingFoldExtension, EditorView.editable.of(true)],
    });
    const view = new EditorView({ state, parent: document.body });
    expect(view.state.doc.toString()).toBe('# A\nbody');
    view.destroy();
  });
});
