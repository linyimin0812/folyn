import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { EditorProps } from '../types';
import { parseOutline, serializeOutline, type OutlineLine } from './outlineConverter';

// ponytail: per-row textareas, not a single big textarea. Reason: fold
// (collapse/expand) needs to hide a subtree range, which is trivial when each
// row is its own DOM node and a pain when everything is one textarea's
// internal text. Trade-off: focus management across rows is manual (we track
// focusIdxRef + refocus via layout effect after structural edits).
//
// ponytail: deferred — ArrowUp/ArrowDown cross-row navigation. Default
// textarea behavior moves the caret within the row only; switching rows on
// up/down requires intercepting the key + computing a column target. Add
// when the user asks; meanwhile users click or use Tab/Enter to move.

// Compute the set of row indices hidden by collapse (subtree range hide).
// Exported so keyboard handlers can find the previous visible row without
// duplicating the render-side fold walk.
export function computeHiddenIdx(
  lines: OutlineLine[],
  collapsed: Set<number>,
): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (hidden.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hidden.add(j);
        j++;
      }
      continue;
    }
    if (collapsed.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hidden.add(j);
        j++;
      }
    }
  }
  return hidden;
}

function autoSize(ta: HTMLTextAreaElement | null) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

export function OutlineEditor({ content, onChange }: EditorProps) {
  const [lines, setLines] = useState<OutlineLine[]>(() => parseOutline(content));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const lastEmittedRef = useRef<string | null>(null);
  const taRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusIdxRef = useRef<number>(0);
  // Where to place the caret after a structural edit re-renders. -1 = leave
  // default (end of textarea value); 0 = start; N = caret at offset N.
  const focusCaretRef = useRef<number>(-1);

  // External content change → re-parse unless we just emitted it (feedback
  // loop guard mirroring MindMapCanvas).
  useEffect(() => {
    if (content === lastEmittedRef.current) return;
    setLines(parseOutline(content));
  }, [content]);

  const emit = useCallback(
    (newLines: OutlineLine[]) => {
      const src = serializeOutline(newLines);
      lastEmittedRef.current = src;
      onChange(src);
    },
    [onChange],
  );

  // Re-size all textareas whenever line texts change.
  useLayoutEffect(() => {
    taRefs.current.forEach(autoSize);
  }, [lines]);

  // Re-focus the row that should hold the caret after a structural edit.
  useLayoutEffect(() => {
    const idx = focusIdxRef.current;
    const ta = taRefs.current[idx];
    if (!ta) return;
    if (document.activeElement !== ta) ta.focus();
    const caret = focusCaretRef.current;
    if (caret >= 0) {
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        // out of range — ignore
      }
      focusCaretRef.current = -1;
    }
  }, [lines]);

  const updateLineText = (idx: number, text: string) => {
    setLines((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], text };
      emit(next);
      return next;
    });
  };

  const changeDepth = (idx: number, delta: 1 | -1) => {
    setLines((prev) => {
      const cur = prev[idx];
      const newDepth = Math.max(0, Math.min(20, cur.depth + delta));
      if (newDepth === cur.depth) return prev;
      const next = prev.slice();
      next[idx] = { ...cur, depth: newDepth };
      emit(next);
      return next;
    });
  };

  const splitLine = (idx: number, cursorPos: number) => {
    setLines((prev) => {
      const cur = prev[idx];
      const before = cur.text.slice(0, cursorPos);
      const after = cur.text.slice(cursorPos);
      const next = prev.slice();
      next[idx] = { ...cur, text: before };
      next.splice(idx + 1, 0, { text: after, depth: cur.depth });
      focusIdxRef.current = idx + 1;
      focusCaretRef.current = 0;
      emit(next);
      return next;
    });
  };

  // Backspace handling — WorkFlowy contract:
  //   - mid-text (caret > 0): default textarea behavior, no intercept.
  //   - caret 0 + non-empty row: merge current row's text into the previous
  //     visible row, caret lands at the merge boundary.
  //   - empty row: delete the row, focus moves to previous visible row at end.
  //   - no previous visible row (root): do nothing.
  const backspaceAtStart = (idx: number) => {
    setLines((prev) => {
      const hidden = computeHiddenIdx(prev, collapsed);
      let prevIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (!hidden.has(i)) {
          prevIdx = i;
          break;
        }
      }
      if (prevIdx < 0) return prev; // root — no-op
      const cur = prev[idx];
      const prevRow = prev[prevIdx];
      const next = prev.slice();
      if (cur.text === '') {
        // Delete the empty row entirely.
        next.splice(idx, 1);
        focusIdxRef.current = prevIdx;
        focusCaretRef.current = prevRow.text.length;
      } else {
        // Merge: append current row's text to previous visible row.
        next[prevIdx] = { ...prevRow, text: prevRow.text + cur.text };
        next.splice(idx, 1);
        focusIdxRef.current = prevIdx;
        focusCaretRef.current = prevRow.text.length;
      }
      emit(next);
      return next;
    });
  };

  // Compute hidden rows (subtrees of collapsed ancestors).
  const hiddenIdx = computeHiddenIdx(lines, collapsed);

  const hasChildren = (idx: number) =>
    idx + 1 < lines.length && lines[idx + 1].depth > lines[idx].depth;

  const toggleCollapse = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden editor-mmap">
      <div className="flex-1 overflow-auto px-5 py-4">
        {lines.map((line, idx) => {
          if (hiddenIdx.has(idx)) return null;
          const isCollapsed = collapsed.has(idx);
          const hasKids = hasChildren(idx);
          return (
            <div
              key={idx}
              className="flex items-start gap-1.5 leading-[1.6] min-h-[24px] rounded transition-colors duration-100 hover:bg-hov"
              style={{ paddingLeft: `${line.depth * 16}px` }}
            >
              {hasKids ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(idx)}
                  className="mt-[6px] w-3 h-3 flex items-center justify-center text-t3 hover:text-t1 shrink-0"
                  title={isCollapsed ? '展开' : '折叠'}
                >
                  <svg
                    width="6"
                    height="6"
                    viewBox="0 0 8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      transition: 'transform 100ms',
                    }}
                  >
                    <path d="M2.5 1.5 L5.5 4 L2.5 6.5" />
                  </svg>
                </button>
              ) : (
                <span className="mt-[6px] w-3 shrink-0" />
              )}
              <span className="mt-[6px] text-t3 shrink-0 select-none text-[13px]">·</span>
              <textarea
                ref={(el) => {
                  taRefs.current[idx] = el;
                }}
                value={line.text}
                onChange={(e) => updateLineText(idx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    changeDepth(idx, e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    splitLine(idx, e.currentTarget.selectionStart);
                  } else if (e.key === 'Backspace') {
                    const ta = e.currentTarget;
                    const atStart =
                      ta.selectionStart === 0 && ta.selectionEnd === 0;
                    if (!atStart) return; // mid-text — default backspace
                    // Root (no previous visible row) — don't intercept.
                    const hidden = computeHiddenIdx(lines, collapsed);
                    let hasPrev = false;
                    for (let i = idx - 1; i >= 0; i--) {
                      if (!hidden.has(i)) {
                        hasPrev = true;
                        break;
                      }
                    }
                    if (!hasPrev) return;
                    e.preventDefault();
                    backspaceAtStart(idx);
                  }
                }}
                onFocus={() => {
                  focusIdxRef.current = idx;
                }}
                rows={1}
                className="flex-1 resize-none bg-transparent outline-none text-t1 text-[13px] leading-[1.6] py-[3px] px-[6px] rounded overflow-hidden transition-colors duration-100 focus:bg-surf"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
