/**
 * DiffPane — side-by-side diff for the JSON viewer's Diff tab.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────┐
 *   │ [☑ Sort both before diff] [Run diff]                │
 *   ├──────────────────────────────┬─────────────────────┤
 *   │ left (read-only JsonTree)    │ right (textarea +   │
 *   │                              │   parsed JsonTree)  │
 *   ├──────────────────────────────┴─────────────────────┤
 *   │ <iframe srcDoc={html}> — jsondiffpatch HTML output  │
 *   └────────────────────────────────────────────────────┘
 *
 * The diff iframe is CSS-isolated so jsondiffpatch's stylesheet doesn't
 * leak into the app. Theme sync: re-render the iframe HTML when the
 * `prefers-color-scheme` media query changes (the iframe can't see the
 * root's `[data-theme]` attribute).
 */
import { useCallback, useEffect, useState } from 'react';
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

  // Debounced parse of the right textarea → diffValue.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (rightInput.length === 0) {
        onRightValueChange(null);
        return;
      }
      parseInput(rightInput, 'auto')
        .then(onRightValueChange)
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

  const runDiff = useCallback(async () => {
    setError(null);
    try {
      const mod = await import('jsondiffpatch');
      const formatter = await import('jsondiffpatch/formatters/html');
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
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setHtml('');
    }
  }, [left, right, sortBoth, isDark]);

  // Re-render iframe HTML when theme changes (if a diff has been run).
  useEffect(() => {
    if (html === '' || delta === null) return;
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
        <button
          type="button"
          onClick={runDiff}
          className="rounded border border-acc/40 bg-accdim px-3 text-[11px] font-medium text-acc hover:bg-acc hover:text-white"
        >
          运行 Diff
        </button>
        {error !== null && (
          <span className="text-rose-700 dark:text-rose-300">错误: {error}</span>
        )}
      </div>

      {/* Two side-by-side trees */}
      <div className="grid min-h-[40%] grid-cols-2 border-b border-brd">
        <div className="flex min-h-0 flex-col border-r border-brd">
          <div className="flex h-[28px] shrink-0 items-center border-b border-brd bg-surf px-2 text-[11px] text-t3">
            左侧 (当前)
          </div>
          <div className="min-h-0 flex-1">
            <JsonTree value={left} onCopyValue={onCopyValue} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex h-[28px] shrink-0 items-center border-b border-brd bg-surf px-2 text-[11px] text-t3">
            右侧 (粘贴第二个)
          </div>
          <textarea
            value={rightInput}
            onChange={(e) => onRightInputChange(e.target.value)}
            spellCheck={false}
            placeholder="粘贴 JSON / JSON5 / Base64 / YAML / XML / CSV …"
            className="min-h-[60px] flex-1 resize-none border-0 bg-panel px-2 py-1 font-mono text-[12px] leading-[1.5] text-t1 outline-none placeholder:text-t3"
          />
          <div className="min-h-0 flex-1 border-t border-brd">
            <JsonTree value={right} onCopyValue={onCopyValue} />
          </div>
        </div>
      </div>

      {/* Diff iframe */}
      <div className="min-h-0 flex-1">
        <iframe
          title="json-diff"
          srcDoc={html}
          sandbox="allow-same-origin"
          className="h-full w-full border-0 bg-white dark:bg-gray-900"
        />
      </div>
    </div>
  );
}

function wrapHtml(body: string, isDark: boolean): string {
  // jsondiffpatch's HTML formatter emits <li> elements with classes like
  // `added`, `deleted`, `modified`, `moved`. The base stylesheet lives at
  // `jsondiffpatch/formatters/styles/html.css`; we inline a minimal subset
  // here so the iframe doesn't have to fetch it.
  //
  // Diff visibility: each changed row gets a saturated left-border stripe,
  // a git-style +/-/~ prefix marker, and a tinted background so additions,
  // deletions and modifications are readable at a glance in both themes.
  const bg = isDark ? '#1a1a1a' : '#fff';
  const fg = isDark ? '#e6e6e6' : '#111';
  const keyCol = isDark ? '#79c0ff' : '#0550ae';

  // Added — green.
  const addedBg = isDark ? '#16391f' : '#dcffe3';
  const addedBd = isDark ? '#3fb950' : '#1a7f37';
  const addedFg = isDark ? '#7ee787' : '#1a7f37';

  // Deleted — red.
  const delBg = isDark ? '#3d1717' : '#ffebe9';
  const delBd = isDark ? '#f85149' : '#cf222e';
  const delFg = isDark ? '#ff9b9b' : '#cf222e';

  // Modified — amber.
  const modBg = isDark ? '#3a2e10' : '#fff8c5';
  const modBd = isDark ? '#d29922' : '#bf8700';
  const modFg = isDark ? '#e3b341' : '#7d4e00';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.55; background: ${bg}; color: ${fg}; margin: 8px; }
  ul { list-style: none; padding-left: 18px; margin: 0; }
  li { position: relative; padding: 1px 4px 1px 22px; border-radius: 3px; }
  li > .key { color: ${keyCol}; font-weight: 600; }
  li > .jsondiffpatch-textdiff-value { white-space: pre-wrap; }

  /* git-style +/-/~ prefix markers */
  li.added::before, li.deleted::before, li.modified::before {
    position: absolute; left: 6px; width: 14px; text-align: center;
    font-weight: 700; font-family: ui-monospace, monospace;
  }
  li.added::before { content: '+'; color: ${addedFg}; }
  li.deleted::before { content: '-'; color: ${delFg}; }
  li.modified::before { content: '~'; color: ${modFg}; }

  /* left-border stripe + tinted background per change type */
  li.added { background: ${addedBg}; border-left: 3px solid ${addedBd}; }
  li.added > .jsondiffpatch-property-name, li.added > .key { color: ${addedFg}; }
  li.deleted { background: ${delBg}; border-left: 3px solid ${delBd}; }
  li.deleted > .jsondiffpatch-property-name, li.deleted > .key { color: ${delFg}; text-decoration: line-through; }
  li.modified { background: ${modBg}; border-left: 3px solid ${modBd}; }
  li.modified > .jsondiffpatch-textdiff-line { display: inline; }

  .jsondiffpatch-delta { display: block; }
  .jsondiffpatch-textdiff-value { display: inline; }
  .jsondiffpatch-property-name { color: ${keyCol}; }

  /* inline old→new values on modified primitives */
  .jsondiffpatch-value-deleted { color: ${delFg}; text-decoration: line-through; background: ${isDark ? 'rgba(248,81,73,0.12)' : 'rgba(207,34,46,0.08)'}; padding: 0 2px; border-radius: 2px; }
  .jsondiffpatch-value-deleted::after { content: ' → '; color: ${fg}; font-weight: 700; text-decoration: none; }
  .jsondiffpatch-value-added { color: ${addedFg}; background: ${isDark ? 'rgba(63,185,80,0.12)' : 'rgba(26,127,55,0.08)'}; padding: 0 2px; border-radius: 2px; }

  /* char-level string textdiff: jsondiffpatch emits <ins>/<del> */
  .jsondiffpatch-textdiff-value ins { background: ${isDark ? 'rgba(63,185,80,0.28)' : 'rgba(26,127,55,0.22)'}; color: ${addedFg}; text-decoration: none; border-radius: 2px; padding: 0 1px; }
  .jsondiffpatch-textdiff-value del { background: ${isDark ? 'rgba(248,81,73,0.28)' : 'rgba(207,34,46,0.22)'}; color: ${delFg}; text-decoration: line-through; border-radius: 2px; padding: 0 1px; }
</style></head><body>${body}</body></html>`;
}
