/**
 * DiffPane — inline-diff variant of the JSON viewer's Diff tab.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────┐
 *   │ [☑ 排序后再比较]                                  │
 *   │ ─────────────────────────────────────────────────  │
 *   │ <Json5CodeMirror> (always editable)                │
 *   │   - doc = user's raw `rightInput`                  │
 *   │   - diffBaseline = formatted `left` (sorted if     │
 *   │     `sortBoth` is on)                              │
 *   │   - "added" lines highlighted green inline         │
 *   └────────────────────────────────────────────────────┘
 *
 * The right pane is a single always-editable CodeMirror editor — no
 * textarea, no iframe, no "清空" button, no mode toggle. The diff is
 * shown inline as colored line backgrounds via the
 * `diffLineDecorator` CM6 extension.
 *
 * Baseline: `JSON.stringify(left, null, 2)`, or
 * `JSON.stringify(sortKeysDeep(left), null, 2)` when `sortBoth` is on.
 * The editor's doc is the user's raw `rightInput` — NOT normalized — so
 * the user can type freely. Only "added" lines (present in the doc but
 * not in the baseline) are highlighted; "removed" lines have no
 * position in the doc and are silently skipped.
 *
 * The `right` and `onRightValueChange` props are kept in
 * `DiffPaneProps` for interface compatibility but are no longer used
 * (we diff raw text, not parsed values).
 */
import { useMemo } from 'react';
import { sortKeysDeep } from '../lib/sortKeysDeep';
import { Json5CodeMirror } from '../editor/Json5CodeMirror';

export interface DiffPaneProps {
  left: unknown;
  rightInput: string;
  right: unknown;
  sortBoth: boolean;
  onRightInputChange: (text: string) => void;
  onRightValueChange: (value: unknown) => void;
  onToggleSortBoth: () => void;
  onCopyValue: (value: string) => void;
}

export function DiffPane({
  left,
  rightInput,
  sortBoth,
  onRightInputChange,
  onToggleSortBoth,
}: DiffPaneProps) {
  // Baseline text for the inline diff. Recomputed only when `left` or
  // `sortBoth` changes — NOT on every `rightInput` keystroke (the
  // extension's ViewPlugin handles doc-side recompute).
  const baselineText = useMemo(() => {
    const base = sortBoth ? sortKeysDeep(left) : left;
    return JSON.stringify(base, null, 2);
  }, [left, sortBoth]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex h-[28px] shrink-0 items-center gap-3 border-b border-brd bg-surf px-2 text-[11px]">
        <label className="flex items-center gap-1 text-t2">
          <input
            type="checkbox"
            checked={sortBoth}
            onChange={onToggleSortBoth}
            className="h-3 w-3 accent-acc"
          />
          <span>排序后再比较</span>
        </label>
      </div>

      {/* Always-editable CodeMirror editor with inline diff highlights. */}
      <div className="min-h-0 flex-1">
        <Json5CodeMirror
          value={rightInput}
          onChange={onRightInputChange}
          diffBaseline={baselineText}
        />
      </div>
    </div>
  );
}
