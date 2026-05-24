import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type { FileChange } from '@quill/cli-adapter';

export interface InlineDiffCallbacks {
  onAccept: (path: string) => void;
  onReject: (path: string) => void;
}

let diffCallbacks: InlineDiffCallbacks | null = null;

export function setDiffCallbacks(cbs: InlineDiffCallbacks) {
  diffCallbacks = cbs;
}

export function getDiffCallbacks(): InlineDiffCallbacks | null {
  return diffCallbacks;
}

export const setInlineDiffs = StateEffect.define<FileChange[]>();

interface DiffEntry {
  type: 'add' | 'remove' | 'context';
  text: string;
  newLineNo?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffEntry[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffEntry[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', text: oldLines[i - 1], newLineNo: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: newLines[j - 1], newLineNo: j });
      j--;
    } else {
      result.unshift({ type: 'remove', text: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

class DeletedLineWidget extends WidgetType {
  constructor(private lineText: string) { super(); }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'ai-diff-deleted-line';
    wrap.textContent = this.lineText || ' ';
    return wrap;
  }

  eq(other: DeletedLineWidget) { return this.lineText === other.lineText; }
}


const addLineDeco = Decoration.line({ class: 'ai-diff-add' });

interface DiffState {
  changes: FileChange[];
  decorations: DecorationSet;
}

function buildDecorations(changes: FileChange[], doc: { lines: number; line: (n: number) => { from: number } }): DecorationSet {
  if (changes.length === 0) return Decoration.none;

  const ranges: any[] = [];

  for (const change of changes) {
    if (change.status !== 'pending') continue;

    const diff = computeLineDiff(change.oldContent, change.newContent);
    let lastAnchorLineNo = 0;

    for (const entry of diff) {
      if (entry.type === 'add' && entry.newLineNo != null) {
        if (entry.newLineNo > doc.lines) continue;
        const line = doc.line(entry.newLineNo);
        ranges.push(addLineDeco.range(line.from) as any);
        lastAnchorLineNo = entry.newLineNo;
      } else if (entry.type === 'remove') {
        const anchorLineNo = lastAnchorLineNo >= 1 ? lastAnchorLineNo : 1;
        if (anchorLineNo > doc.lines) continue;
        const anchor = doc.line(Math.min(anchorLineNo, doc.lines));
        ranges.push(
          Decoration.widget({
            widget: new DeletedLineWidget(entry.text),
            block: true,
            side: -1,
          }).range(anchor.from) as any,
        );
      }
    }
  }

  try {
    return RangeSet.of(ranges, true);
  } catch {
    return Decoration.none;
  }
}

const inlineDiffField = StateField.define<DiffState>({
  create: () => ({ changes: [], decorations: Decoration.none }),
  update(value, tr) {
    let changes = value.changes;
    for (const effect of tr.effects) {
      if (effect.is(setInlineDiffs)) {
        changes = effect.value;
      }
    }
    if (changes !== value.changes || tr.docChanged) {
      return { changes, decorations: buildDecorations(changes, tr.state.doc) };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

export function dispatchDiffs(view: EditorView, changes: FileChange[]) {
  view.dispatch({ effects: setInlineDiffs.of(changes) });
}

export const inlineDiffExtension = [inlineDiffField];
