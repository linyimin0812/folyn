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

// ponytail: O(n) scan per row per ancestor for tree-line L-turn detection.
// Fine for outline-scale doc sizes (hundreds of rows). If huge docs become a
// thing, precompute a "last visible descendant at depth" map once per render
// instead of scanning per (row, ancestor) pair.
function isLastAtDepth(
  lines: OutlineLine[],
  hidden: Set<number>,
  i: number,
  a: number,
): boolean {
  for (let j = i + 1; j < lines.length; j++) {
    if (hidden.has(j)) continue;
    if (lines[j].depth <= a) return true;
    return false;
  }
  return true;
}

// ponytail: tree-line x-offset = bullet center. Row layout (per depth D) is
//   paddingLeft(D*16) + chevron slot(w-4=16) + gap-1(4) + bullet wrap(4)
// so bullet center = D*16 + 16 + 4 + 2 = D*16 + 22. The ancestor line for
// depth a draws at a*16 + 22, dropping through the subtree at the ancestor's
// own bullet column. The chevron svg is left-aligned (justify-start) and
// shrunk to 6px so the a=D-1 line (at D*16+6, i.e. 6px into the chevron
// slot) clears the triangle — chevron sits left of the line, line sits left
// of the bullet. Magic number — recompute if row layout changes.
const BULLET_CENTER_OFFSET = 22;
const ROW_HALF_HEIGHT = 15; // ~half of single-line row height for L-turn

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

  // ponytail: option 3 — compute `next` from closure `lines`, call
  // `setLines(next)` value-form, then `emit(next)`. Safe because these run
  // in event handlers (onChange/onKeyDown), each its own tick — no batched
  // stale-closure risk. Avoids calling `emit` inside a `setLines` updater
  // (which executes during render phase and trips the "Cannot update a
  // component while rendering a different component" warning via the parent
  // setState in `onChange`).
  const updateLineText = (idx: number, text: string) => {
    const next = lines.slice();
    next[idx] = { ...next[idx], text };
    setLines(next);
    emit(next);
  };

  const changeDepth = (idx: number, delta: 1 | -1) => {
    const cur = lines[idx];
    const newDepth = Math.max(0, Math.min(20, cur.depth + delta));
    if (newDepth === cur.depth) return;
    const next = lines.slice();
    next[idx] = { ...cur, depth: newDepth };
    setLines(next);
    emit(next);
  };

  const splitLine = (idx: number, cursorPos: number) => {
    const cur = lines[idx];
    const before = cur.text.slice(0, cursorPos);
    const after = cur.text.slice(cursorPos);
    const next = lines.slice();
    next[idx] = { ...cur, text: before };
    next.splice(idx + 1, 0, { text: after, depth: cur.depth });
    focusIdxRef.current = idx + 1;
    focusCaretRef.current = 0;
    setLines(next);
    emit(next);
  };

  // Backspace handling — WorkFlowy contract:
  //   - mid-text (caret > 0): default textarea behavior, no intercept.
  //   - caret 0 + non-empty row: merge current row's text into the previous
  //     visible row, caret lands at the merge boundary.
  //   - empty row: delete the row, focus moves to previous visible row at end.
  //   - no previous visible row (root): do nothing.
  const backspaceAtStart = (idx: number) => {
    const hidden = computeHiddenIdx(lines, collapsed);
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (!hidden.has(i)) {
        prevIdx = i;
        break;
      }
    }
    if (prevIdx < 0) return; // root — no-op
    const cur = lines[idx];
    const prevRow = lines[prevIdx];
    const next = lines.slice();
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
    setLines(next);
    emit(next);
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
      <div className="flex-1 overflow-auto px-6 py-4">
        {lines.map((line, idx) => {
          if (hiddenIdx.has(idx)) return null;
          const isCollapsed = collapsed.has(idx);
          const hasKids = hasChildren(idx);
          return (
            <div
              key={idx}
              className="group relative flex items-start gap-1 rounded-[3px] min-h-[30px] transition-colors duration-100 hover:bg-hov/40"
              style={{ paddingLeft: `${line.depth * 16}px` }}
            >
              {/* Tree connecting lines: one vertical segment per ancestor
                  depth. Last visible descendant at depth a draws a half-height
                  segment (L-turn); others draw full-height. */}
              {Array.from({ length: line.depth }, (_, a) => {
                const last = isLastAtDepth(lines, hiddenIdx, idx, a);
                return (
                  <span
                    key={a}
                    className="absolute pointer-events-none border-l border-brd"
                    style={{
                      left: `${a * 16 + BULLET_CENTER_OFFSET}px`,
                      top: 0,
                      bottom: last ? 'auto' : 0,
                      height: last ? `${ROW_HALF_HEIGHT}px` : 'auto',
                    }}
                  />
                );
              })}
              {/* Hover-triggered action zone (fold toggle only, only when row
                  has children). Invisible by default to keep the clean look;
                  reveals on row hover. Always takes layout space so the bullet
                  column stays aligned across rows. The zone itself is the
                  chevron's first-line centering box: h-[30px] matches the row
                  min-height and the textarea's first-line center (py-[3px] +
                  half of 14*1.7 ≈ 15px), so items-center puts the chevron on
                  the first text line. */}
              <div className="flex items-center justify-start w-4 h-[30px] self-start shrink-0">
                {hasKids ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(idx)}
                    className="flex items-center justify-start w-[16px] h-[16px] text-t1"
                    title={isCollapsed ? '展开' : '折叠'}
                  >
                    <svg
                      width="6"
                      height="6"
                      viewBox="0 0 8 8"
                      fill="currentColor"
                      style={{
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 100ms',
                        transformOrigin: '50% 50%',
                      }}
                    >
                      {/* ponytail: solid right-pointing triangle (collapsed).
                          Rotated 90deg → down-pointing (expanded). Fill currentColor
                          inherits text-t1 from the button. */}
                      <polygon points="1.5,1 6.5,4 1.5,7" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {/* Bullet as a CSS-drawn dot (not a • char). Wrapped in a
                  fixed-height first-line box (h-[30px], matching the row
                  min-height and textarea first-line center ~15px) so
                  items-center centers the dot on the first text line without
                  manual mt-[Npx] hacks. */}
              <div className="self-start h-[30px] flex items-center justify-center shrink-0">
                <span className="w-[4px] h-[4px] rounded-full bg-t1 shrink-0" />
              </div>
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
                placeholder="输入文字"
                style={{ color: 'var(--t1)', caretColor: 'var(--t1)' }}
                className={
                  'flex-1 resize-none bg-transparent outline-none text-t1 text-[14px] leading-[1.7] py-[3px] px-[4px] rounded-[3px] overflow-hidden transition-colors duration-100 placeholder:text-t3 placeholder:opacity-50 focus:bg-surf/60 '
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
