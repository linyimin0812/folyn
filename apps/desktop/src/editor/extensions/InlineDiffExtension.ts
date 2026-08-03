import {
  StateField,
  StateEffect,
  RangeSet,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view';
import { diffLines, type Change } from 'diff';

// ── Types ──

export interface DiffHunk {
  id: string;
  type: 'add' | 'remove';
  fromLine: number;
  toLine: number;
  content: string;
}

interface DiffState {
  hunks: DiffHunk[];
  active: boolean;
}

// ── State Effects ──

export const setDiffHunks = StateEffect.define<DiffHunk[]>();
export const acceptHunk = StateEffect.define<string>();
export const rejectHunk = StateEffect.define<string>();
export const acceptAllHunks = StateEffect.define<void>();
export const rejectAllHunks = StateEffect.define<void>();
export const clearDiff = StateEffect.define<void>();

// ── Widget ──

function deleteHunkLines(view: EditorView, hunk: DiffHunk, allHunks: DiffHunk[]) {
  const fromLineInfo = view.state.doc.line(hunk.fromLine);
  const toLineInfo = view.state.doc.line(hunk.toLine);
  let from = fromLineInfo.from;
  let to = toLineInfo.to;
  if (to < view.state.doc.length) {
    to += 1;
  } else if (from > 0) {
    from -= 1;
  }
  const deletedLineCount = hunk.toLine - hunk.fromLine + 1;
  const remaining = allHunks
    .filter((h) => h.id !== hunk.id)
    .map((h) =>
      h.fromLine > hunk.toLine
        ? { ...h, fromLine: h.fromLine - deletedLineCount, toLine: h.toLine - deletedLineCount }
        : h,
    );
  view.dispatch({
    changes: { from, to, insert: '' },
    effects: setDiffHunks.of(remaining),
  });
}

class DiffButtonWidget extends WidgetType {
  constructor(private hunkId: string) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-diff-widget';

    const acceptBtn = document.createElement('span');
    acceptBtn.className = 'cm-diff-accept';
    acceptBtn.textContent = '✓';
    acceptBtn.title = '接受';
    acceptBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const state = view.state.field(diffField);
      const hunk = state.hunks.find((h) => h.id === this.hunkId);
      if (!hunk) return;
      if (hunk.type === 'remove') {
        deleteHunkLines(view, hunk, state.hunks);
      } else {
        view.dispatch({ effects: acceptHunk.of(this.hunkId) });
      }
    });

    const rejectBtn = document.createElement('span');
    rejectBtn.className = 'cm-diff-reject';
    rejectBtn.textContent = '✗';
    rejectBtn.title = '拒绝';
    rejectBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const state = view.state.field(diffField);
      const hunk = state.hunks.find((h) => h.id === this.hunkId);
      if (!hunk) return;
      if (hunk.type === 'add') {
        deleteHunkLines(view, hunk, state.hunks);
      } else {
        view.dispatch({ effects: rejectHunk.of(this.hunkId) });
      }
    });

    container.appendChild(acceptBtn);
    container.appendChild(rejectBtn);
    return container;
  }

  eq(other: DiffButtonWidget): boolean {
    return this.hunkId === other.hunkId;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ── Decorations ──

const addedLineDeco = Decoration.line({ class: 'cm-diff-added' });
const deletedLineDeco = Decoration.line({ class: 'cm-diff-deleted' });

function buildDecorations(state: DiffState, doc: { line: (n: number) => { from: number; to: number }; lines: number }): DecorationSet {
  if (!state.active || state.hunks.length === 0) {
    return RangeSet.empty;
  }

  const decorations: { from: number; to: number; value: Decoration }[] = [];

  for (const hunk of state.hunks) {
    const lineDeco = hunk.type === 'add' ? addedLineDeco : deletedLineDeco;

    for (let lineNum = hunk.fromLine; lineNum <= hunk.toLine; lineNum++) {
      if (lineNum < 1 || lineNum > doc.lines) continue;
      const lineInfo = doc.line(lineNum);
      decorations.push({ from: lineInfo.from, to: lineInfo.from, value: lineDeco });
    }

    // Add widget at end of the first line of the hunk
    if (hunk.fromLine >= 1 && hunk.fromLine <= doc.lines) {
      const firstLine = doc.line(hunk.fromLine);
      decorations.push({
        from: firstLine.to,
        to: firstLine.to,
        value: Decoration.widget({ widget: new DiffButtonWidget(hunk.id), side: 1 }),
      });
    }
  }

  // Sort by position (required for RangeSet)
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  return RangeSet.of(decorations.map((d) => d.value.range(d.from, d.to)));
}

// ── State Field ──

export const diffField = StateField.define<DiffState>({
  create() {
    return { hunks: [], active: false };
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffHunks)) {
        return { hunks: effect.value, active: effect.value.length > 0 };
      }
      if (effect.is(acceptHunk)) {
        const remaining = value.hunks.filter((h) => h.id !== effect.value);
        return { hunks: remaining, active: remaining.length > 0 };
      }
      if (effect.is(rejectHunk)) {
        const remaining = value.hunks.filter((h) => h.id !== effect.value);
        return { hunks: remaining, active: remaining.length > 0 };
      }
      if (effect.is(acceptAllHunks) || effect.is(rejectAllHunks) || effect.is(clearDiff)) {
        return { hunks: [], active: false };
      }
    }
    return value;
  },
});

// ── Decoration provider ──

const diffDecorations = EditorView.decorations.compute([diffField], (state) => {
  const diffState = state.field(diffField);
  return buildDecorations(diffState, state.doc);
});

// ── Read-only when diff is active ──

const diffEditable = EditorView.editable.compute([diffField], (state) => {
  return !state.field(diffField).active;
});

// ── Compute Diff Hunks ──

export interface ComputedDiff {
  hunks: DiffHunk[];
  mergedContent: string;
}

/**
 * Computes line-level diff hunks between old and new content and produces a
 * merged document that interleaves removed and added lines at their positions.
 */
export function computeDiffHunks(oldContent: string, newContent: string): ComputedDiff {
  // ponytail: diffLines merges a no-trailing-newline last line with the next
  // change, marking the unchanged line as removed and duplicating it in added.
  // Normalize both to trailing-newline form so line boundaries line up with
  // actual content lines. Skip empty string — diffLines("", "x\n") already
  // produces a single add hunk, but diffLines("\n", "x\n") would emit a
  // phantom removed empty line.
  const normOld = oldContent && !oldContent.endsWith('\n') ? oldContent + '\n' : oldContent;
  const normNew = newContent && !newContent.endsWith('\n') ? newContent + '\n' : newContent;
  const changes: Change[] = diffLines(normOld, normNew);
  const hunks: DiffHunk[] = [];
  const mergedLines: string[] = [];
  let currentLine = 1;
  let hunkCounter = 0;

  for (const change of changes) {
    // diffLines may include trailing newlines in value; split and handle carefully
    const lines = change.value.replace(/\n$/, '').split('\n');

    if (!change.added && !change.removed) {
      // Context lines — unchanged
      mergedLines.push(...lines);
      currentLine += lines.length;
    } else if (change.removed) {
      // Removed lines — show in merged doc with red decoration
      const fromLine = currentLine;
      mergedLines.push(...lines);
      currentLine += lines.length;
      const toLine = currentLine - 1;
      hunkCounter++;
      hunks.push({
        id: `hunk-${hunkCounter}`,
        type: 'remove',
        fromLine,
        toLine,
        content: change.value,
      });
    } else if (change.added) {
      // Added lines — show in merged doc with green decoration
      const fromLine = currentLine;
      mergedLines.push(...lines);
      currentLine += lines.length;
      const toLine = currentLine - 1;
      hunkCounter++;
      hunks.push({
        id: `hunk-${hunkCounter}`,
        type: 'add',
        fromLine,
        toLine,
        content: change.value,
      });
    }
  }

  return {
    hunks,
    mergedContent: mergedLines.join('\n'),
  };
}

// ── Hunk change callback ──

let onHunksChange: ((count: number) => void) | null = null;

export function setOnHunksChange(cb: ((count: number) => void) | null) {
  onHunksChange = cb;
}

const diffUpdateListener = EditorView.updateListener.of((update) => {
  if (!onHunksChange) return;
  const hasDiffEffect = update.transactions.some((tr) =>
    tr.effects.some((e) =>
      e.is(setDiffHunks) || e.is(acceptHunk) || e.is(rejectHunk)
      || e.is(acceptAllHunks) || e.is(rejectAllHunks) || e.is(clearDiff),
    ),
  );
  if (!hasDiffEffect) return;
  try {
    const state = update.state.field(diffField);
    onHunksChange(state.hunks.length);
  } catch { /* field not available */ }
});

// ── Extension Export ──

export const inlineDiffExtension: Extension[] = [
  diffField,
  diffDecorations,
  diffEditable,
  diffUpdateListener,
];
