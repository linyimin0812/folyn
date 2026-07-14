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

  // Compute hidden rows (subtrees of collapsed ancestors).
  const hiddenIdx = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (hiddenIdx.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hiddenIdx.add(j);
        j++;
      }
      continue;
    }
    if (collapsed.has(i)) {
      let j = i + 1;
      while (j < lines.length && lines[j].depth > lines[i].depth) {
        hiddenIdx.add(j);
        j++;
      }
    }
  }

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
      <div className="flex-1 overflow-auto px-5 py-3">
        {lines.map((line, idx) => {
          if (hiddenIdx.has(idx)) return null;
          const isCollapsed = collapsed.has(idx);
          const hasKids = hasChildren(idx);
          return (
            <div
              key={idx}
              className="flex items-start gap-1 leading-[1.6] min-h-[24px]"
              style={{ paddingLeft: `${line.depth * 16}px` }}
            >
              {hasKids ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(idx)}
                  className="mt-[5px] w-3 h-3 flex items-center justify-center text-t3 hover:text-t1 shrink-0"
                  title={isCollapsed ? '展开' : '折叠'}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    style={{
                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      transition: 'transform 100ms',
                    }}
                  >
                    <path d="M2 1.5 L6 4 L2 6.5" />
                  </svg>
                </button>
              ) : (
                <span className="mt-[5px] w-3 shrink-0" />
              )}
              <span className="mt-[6px] text-t3 shrink-0 select-none">•</span>
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
                    // ponytail: split-on-Enter. WorkFlowy also does
                    // "delete empty row + outdent on backspace" and "merge
                    // with prev on Backspace at start" — deferred until
                    // requested.
                    e.preventDefault();
                    splitLine(idx, e.currentTarget.selectionStart);
                  }
                }}
                onFocus={() => {
                  focusIdxRef.current = idx;
                }}
                rows={1}
                className="flex-1 resize-none bg-transparent outline-none text-t1 text-[14px] leading-[1.6] py-[2px] overflow-hidden"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
