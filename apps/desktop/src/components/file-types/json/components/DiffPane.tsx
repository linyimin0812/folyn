/**
 * DiffPane — side-by-side diff for the JSON viewer's Diff tab.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────┐
 *   │ [☑ Sort both before diff]                          │
 *   ├──────────────────────────────┬─────────────────────┤
 *   │ left (read-only JsonTree)    │ right: [编辑][Diff]  │
 *   │                              │ ──────────────────  │
 *   │                              │ textarea            │
 *   │                              │   OR                │
 *   │                              │ diff iframe         │
 *   └──────────────────────────────┴─────────────────────┘
 *
 * The right column is a single box that shows EITHER the textarea
 * (edit mode) OR the diff iframe (diff mode) — never both at once.
 * When the user pastes/types JSON for the first time (empty → non-
 * empty transition), the box auto-switches to diff mode. After that
 * the user owns the mode; [编辑] / [Diff] toggle buttons in the
 * right header switch manually.
 *
 * The diff runs automatically once the right input is parsed into a
 * value (the parent owns the debounced parse; this component re-runs
 * the diff whenever `left`, `right`, or `sortBoth` changes). The
 * diff iframe is CSS-isolated so jsondiffpatch's stylesheet doesn't
 * leak into the app. Theme sync: re-render the iframe HTML when the
 * `prefers-color-scheme` media query changes (the iframe can't see
 * the root's `[data-theme]` attribute).
 */
import { useEffect, useState } from 'react';
import { JsonTree } from './JsonTree';
import { parseInput } from '../lib/parseInput';
import { sortKeysDeep } from '../lib/sortKeysDeep';

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

const DIFF_DEBOUNCE_MS = 400;

export function DiffPane({
  left,
  rightInput,
  right,
  sortBoth,
  onRightInputChange,
  onRightValueChange,
  onToggleSortBoth,
  onCopyValue,
}: DiffPaneProps) {
  const [delta, setDelta] = useState<unknown>(null);
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [rightViewMode, setRightViewMode] = useState<'edit' | 'diff'>('edit');

  // Debounced parse of the right textarea → diffValue.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (rightInput.length === 0) {
        onRightValueChange(null);
        return;
      }
      parseInput(rightInput, 'auto')
        .then((value) => {
          setError(null);
          onRightValueChange(value);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`右侧解析失败: ${msg}`);
          onRightValueChange(null);
        });
    }, DIFF_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [rightInput, onRightValueChange]);

  // Track system theme for iframe CSS injection.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Auto-switch the right column from edit → diff mode the first time
  // the user pastes/types non-empty input. After that the user owns
  // the mode (the [编辑] / [Diff] buttons toggle it manually); we don't
  // force-switch back to edit when the input becomes empty again, so
  // the user can clear+re-paste without losing their diff view.
  useEffect(() => {
    if (rightInput.trim().length > 0 && rightViewMode === 'edit') {
      setRightViewMode('diff');
    }
  }, [rightInput, rightViewMode]);

  // Auto-run diff whenever left/right/sortBoth changes (right is updated
  // by the parent's debounced parse effect, so this fires AFTER parsing
  // completes — no race). Skipped when rightInput is empty (handled by
  // the placeholder branch in JSX).
  useEffect(() => {
    if (rightInput.length === 0) {
      setError(null);
      setDelta(null);
      setHtml('');
      return;
    }
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const mod = await import('jsondiffpatch');
        const formatter = await import('jsondiffpatch/formatters/html');
        if (cancelled) return;
        const a = sortBoth ? sortKeysDeep(left) : left;
        const b = sortBoth ? sortKeysDeep(right) : right;
        const d = mod.diff(a, b);
        setDelta(d);
        if (d === undefined) {
          setHtml('<div style="font-family: monospace; padding: 8px;">无差异</div>');
          return;
        }
        const htmlStr = formatter.format(d, a) ?? '';
        setHtml(wrapHtml(htmlStr, isDark));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setHtml('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [left, right, sortBoth, isDark, rightInput]);

  // Re-render iframe HTML when theme changes (if a diff has been run).
  useEffect(() => {
    if (html === '' || delta === null) return;
    if (delta === undefined) return;
    void (async () => {
      try {
        const formatter = await import('jsondiffpatch/formatters/html');
        const htmlStr = formatter.format(delta as never, left) ?? '';
        setHtml(wrapHtml(htmlStr, isDark));
      } catch {
        /* keep previous html */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

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
        {error !== null && (
          <span className="text-rose-700 dark:text-rose-300">错误: {error}</span>
        )}
      </div>

      {/* Two side-by-side panes: left tree, right textarea + diff iframe */}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        {/* Left: current value tree */}
        <div className="flex min-h-0 flex-col border-r border-brd">
          <div className="flex h-[28px] shrink-0 items-center border-b border-brd bg-surf px-2 text-[11px] text-t3">
            左侧 (当前)
          </div>
          <div className="min-h-0 flex-1">
            <JsonTree value={left} onCopyValue={onCopyValue} />
          </div>
        </div>

        {/* Right: textarea OR diff iframe (one at a time) */}
        <div className="flex min-h-0 flex-col">
          <div className="flex h-[28px] shrink-0 items-center justify-between border-b border-brd bg-surf px-2 text-[11px] text-t3">
            <span>右侧 (输入要比对的 JSON)</span>
            <div className="flex items-center gap-px">
              <button
                type="button"
                onClick={() => setRightViewMode('edit')}
                className={`px-2 py-0.5 text-[11px] font-medium border ${
                  rightViewMode === 'edit'
                    ? 'bg-accdim text-acc border-acc/40'
                    : 'bg-surf text-t3 border-brd hover:bg-hov hover:text-t1'
                }`}
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => setRightViewMode('diff')}
                className={`px-2 py-0.5 text-[11px] font-medium border ${
                  rightViewMode === 'diff'
                    ? 'bg-accdim text-acc border-acc/40'
                    : 'bg-surf text-t3 border-brd hover:bg-hov hover:text-t1'
                }`}
              >
                Diff
              </button>
            </div>
          </div>
          {rightViewMode === 'edit' ? (
            <textarea
              value={rightInput}
              onChange={(e) => onRightInputChange(e.target.value)}
              spellCheck={false}
              placeholder="粘贴 JSON / JSON5 / Base64 / YAML / XML / CSV …"
              className="min-h-0 flex-1 resize-none border-0 bg-panel px-2 py-1 font-mono text-[12px] leading-[1.5] text-t1 outline-none placeholder:text-t3"
            />
          ) : rightInput.length === 0 || html === '' ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-2 text-center text-[12px] text-t3">
              在编辑模式输入要比对的 JSON
            </div>
          ) : (
            <iframe
              title="json-diff"
              srcDoc={html}
              sandbox="allow-same-origin"
              className="min-h-0 flex-1 w-full border-0 bg-white dark:bg-gray-900"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function wrapHtml(body: string, isDark: boolean): string {
  // jsondiffpatch's HTML formatter emits <li> elements with classes prefixed
  // by `jsondiffpatch-`: `jsondiffpatch-added`, `jsondiffpatch-deleted`,
  // `jsondiffpatch-modified`, `jsondiffpatch-unchanged`. Property names live
  // in `<div class="jsondiffpatch-property-name">`, values in
  // `<div class="jsondiffpatch-value">` (with `jsondiffpatch-left-value` /
  // `jsondiffpatch-right-value` modifiers on modified rows). Char-level
  // string textdiff emits `<ins>`/`<del>` inside `.jsondiffpatch-textdiff-value`.
  // The base stylesheet at `jsondiffpatch/formatters/styles/html.css` is NOT
  // loaded here; we inline a tailored subset so the iframe stays self-contained.
  //
  // GitHub-style diff: full-width colored row backgrounds (not a left-border
  // stripe), `+`/`-`/`~` gutter prefixes, char-level `<ins>`/`<del>` highlights.
  // Palette mirrors GitHub's web diff with bumped saturation so the (typically
  // short) delta reads as prominently "diff-like" in both light and dark mode.
  // Unchanged rows stay transparent with normal text color (GitHub does not dim
  // them — colored rows are obvious enough without dimming context).
  const bg = isDark ? '#0d1117' : '#ffffff';
  const fg = isDark ? '#e6edf3' : '#24292f';
  const muted = isDark ? '#7d8590' : '#57606a';
  const keyCol = isDark ? '#79c0ff' : '#0550ae';

  // Added — green (GitHub hue, bumped alpha).
  const addedBg = isDark ? 'rgba(46,160,67,0.25)' : '#d6ffd6';
  const addedFg = isDark ? '#7ee787' : '#1a7f37';
  const addedInsBg = isDark ? 'rgba(46,160,67,0.4)' : '#acf2bd';

  // Deleted — red.
  const delBg = isDark ? 'rgba(248,81,73,0.25)' : '#ffd6d3';
  const delFg = isDark ? '#ffa198' : '#cf222e';
  const delDelBg = isDark ? 'rgba(248,81,73,0.4)' : '#ffd5d4';

  // Modified — amber (jsondiffpatch-specific; GitHub has no exact equivalent
  // for in-place object value changes).
  const modBg = isDark ? 'rgba(187,128,9,0.25)' : '#fff8c5';
  const modFg = isDark ? '#e3b341' : '#7d4e00';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6; background: ${bg}; color: ${fg}; margin: 8px;
  }
  ul { list-style: none; padding-left: 18px; margin: 0; }
  li { position: relative; padding: 2px 6px 2px 24px; }

  .jsondiffpatch-delta { display: block; }
  .jsondiffpatch-property-name { color: ${keyCol}; font-weight: 600; }
  .jsondiffpatch-value pre {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    margin: 0;
  }
  .jsondiffpatch-value { display: inline; }

  /* Unchanged rows: transparent background, muted text (no dimming). */
  li.jsondiffpatch-unchanged { background: transparent; color: ${muted}; }
  li.jsondiffpatch-unchanged > .jsondiffpatch-property-name { color: ${keyCol}; font-weight: 400; }

  /* git-style +/-/~ prefix markers — only on changed rows. */
  li.jsondiffpatch-added::before,
  li.jsondiffpatch-deleted::before,
  li.jsondiffpatch-modified::before {
    position: absolute; left: 6px; width: 14px; text-align: center;
    font-weight: 700; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px; top: 2px;
  }
  li.jsondiffpatch-added::before { content: '+'; color: ${addedFg}; }
  li.jsondiffpatch-deleted::before { content: '-'; color: ${delFg}; }
  li.jsondiffpatch-modified::before { content: '~'; color: ${modFg}; }

  /* Added — full-width green row. */
  li.jsondiffpatch-added {
    background: ${addedBg};
    border-radius: 3px;
  }
  li.jsondiffpatch-added > .jsondiffpatch-property-name { color: ${addedFg}; font-weight: 700; }
  li.jsondiffpatch-added > .jsondiffpatch-value { color: ${addedFg}; }

  /* Deleted — full-width red row; value struck through. */
  li.jsondiffpatch-deleted {
    background: ${delBg};
    border-radius: 3px;
  }
  li.jsondiffpatch-deleted > .jsondiffpatch-property-name { color: ${delFg}; font-weight: 700; }
  li.jsondiffpatch-deleted > .jsondiffpatch-value { color: ${delFg}; text-decoration: line-through; }

  /* Modified — full-width amber row; old value red+struck, new value green. */
  li.jsondiffpatch-modified {
    background: ${modBg};
    border-radius: 3px;
  }
  li.jsondiffpatch-modified > .jsondiffpatch-property-name { color: ${modFg}; font-weight: 700; }
  li.jsondiffpatch-modified > .jsondiffpatch-value.jsondiffpatch-left-value {
    color: ${delFg}; text-decoration: line-through;
    background: ${delDelBg};
    padding: 0 3px; border-radius: 2px; margin-right: 4px;
  }
  li.jsondiffpatch-modified > .jsondiffpatch-value.jsondiffpatch-left-value::after {
    content: ' → '; color: ${fg}; font-weight: 700; text-decoration: none; margin-left: 2px;
  }
  li.jsondiffpatch-modified > .jsondiffpatch-value.jsondiffpatch-right-value {
    color: ${addedFg};
    background: ${addedInsBg};
    padding: 0 3px; border-radius: 2px;
  }

  /* char-level string textdiff: jsondiffpatch emits <ins>/<del> inside
     .jsondiffpatch-textdiff-value (used when both sides are strings). */
  .jsondiffpatch-textdiff-value { white-space: pre-wrap; display: inline; }
  .jsondiffpatch-textdiff-line { display: block; }
  .jsondiffpatch-textdiff-value ins {
    background: ${addedInsBg}; color: ${addedFg};
    text-decoration: none; border-radius: 2px; padding: 0 1px;
  }
  .jsondiffpatch-textdiff-value del {
    background: ${delDelBg}; color: ${delFg};
    text-decoration: line-through; border-radius: 2px; padding: 0 1px;
  }
</style></head><body>${body}</body></html>`;
}
