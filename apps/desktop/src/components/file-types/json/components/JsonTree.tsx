/**
 * JsonTree — custom recursive tree viewer for the JSON file viewer's Input
 * (and later Query / Diff) tab.
 *
 * Design (per PRD R4 + PR3 design decisions):
 *   - Uses `@radix-ui/react-collapsible` for collapse/expand.
 *   - Renders object AND array roots (CSV yields an array root with no
 *     wrapper object — handled by RootNode).
 *   - Each row: key (or `[N]` index) · type badge · value preview (for
 *     primitives) or child-count preview (for obj/arr).
 *   - Default expand depth: 1 (top-level keys expanded, their children
 *     collapsed). Bumped via `expandAllKey` / `collapseAllKey` counters
 *     so the parent toolbar's buttons can force every node open/closed.
 *   - Copy-key-path-on-click: clicking a key calls `onCopyPath(path)`.
 *     Clicking a primitive value calls `onCopyValue(stringifiedValue)`.
 *   - Search: case-insensitive substring match on key OR stringified
 *     value. Matching rows get a yellow highlight; ancestors of matches
 *     auto-expand so the user can see them.
 *   - Sticky block headers: only the top-level object/array's direct
 *     children (depth === 1) get `position: sticky; top: 0` so they
 *     stay visible while scrolling inside the tree container.
 *   - Tailwind tokens throughout; works in light + dark (uses the default
 *     Tailwind palette for type-badge colors so we don't collide with the
 *     overridden `red`/`green`/`amber`/`purple`/`cyan` tokens).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

/* ------------------------------------------------------------------ *
 * Type guards & helpers
 * ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

type NodeType = 'obj' | 'arr' | 'str' | 'num' | 'bool' | 'null';

function getType(value: unknown): NodeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'arr';
  const t = typeof value;
  if (t === 'string') return 'str';
  if (t === 'number') return 'num';
  if (t === 'boolean') return 'bool';
  // Object (including class instances) → treat as obj for display.
  return 'obj';
}

function primitiveToString(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

function joinPath(parent: string, key: string): string {
  // key is either `name` (object field) or `[N]` (array index, already bracketed).
  return key.startsWith('[') ? `${parent}${key}` : `${parent}.${key}`;
}

/** Build a JSON path string for array index. */
function arrayIndexLabel(i: number): string {
  return `[${i}]`;
}

/** Has any descendant (or self, for primitives) matching `search`? */
function hasDescendantMatch(value: unknown, searchLower: string): boolean {
  if (!searchLower) return false;
  if (value === null) {
    return 'null'.includes(searchLower);
  }
  if (Array.isArray(value)) {
    return value.some((v) => hasDescendantMatch(v, searchLower));
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase().includes(searchLower)) return true;
      if (hasDescendantMatch(v, searchLower)) return true;
    }
    return false;
  }
  return primitiveToString(value).toLowerCase().includes(searchLower);
}

/* ------------------------------------------------------------------ *
 * Tree context
 * ------------------------------------------------------------------ */

interface TreeContextValue {
  search: string;
  searchLower: string;
  onCopyPath: (path: string) => void;
  onCopyValue: (value: string) => void;
  expandAllKey: number;
  collapseAllKey: number;
}

const TreeContext = createContext<TreeContextValue>({
  search: '',
  searchLower: '',
  onCopyPath: () => {},
  onCopyValue: () => {},
  expandAllKey: 0,
  collapseAllKey: 0,
});

/* ------------------------------------------------------------------ *
 * Type badge
 * ------------------------------------------------------------------ */

const TYPE_BADGE_CLASS: Record<NodeType, string> = {
  obj: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  arr: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  str: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  num: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  bool: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  null: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
};

function TypeBadge({ type }: { type: NodeType }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono leading-tight ${TYPE_BADGE_CLASS[type]}`}
    >
      {type}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Row pieces
 * ------------------------------------------------------------------ */

function KeyLabel({
  label,
  onClick,
  match,
}: {
  label: string;
  onClick: () => void;
  match: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="复制路径"
      className={`shrink-0 font-mono text-[12px] text-t1 hover:text-acc hover:underline cursor-pointer ${match ? 'bg-yellow-100/60 dark:bg-yellow-500/25 rounded px-0.5' : ''}`}
    >
      {label}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-block w-3 text-t3 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      ▸
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * TreeNode
 * ------------------------------------------------------------------ */

interface TreeNodeProps {
  label: string;
  value: unknown;
  path: string;
  depth: number;
}

const DEFAULT_EXPAND_DEPTH = 1;

function TreeNode({ label, value, path, depth }: TreeNodeProps) {
  const ctx = useContext(TreeContext);
  const type = getType(value);
  const isCollapsible = type === 'obj' || type === 'arr';

  const [open, setOpen] = useState(depth <= DEFAULT_EXPAND_DEPTH);

  // React to expand-all / collapse-all toolbar bumps.
  const prevExpand = useRef(ctx.expandAllKey);
  useEffect(() => {
    if (ctx.expandAllKey !== prevExpand.current) {
      prevExpand.current = ctx.expandAllKey;
      setOpen(true);
    }
  }, [ctx.expandAllKey]);

  const prevCollapse = useRef(ctx.collapseAllKey);
  useEffect(() => {
    if (ctx.collapseAllKey !== prevCollapse.current) {
      prevCollapse.current = ctx.collapseAllKey;
      setOpen(false);
    }
  }, [ctx.collapseAllKey]);

  // Auto-expand when a descendant matches the search query.
  const descendantMatch = useMemo(
    () => (ctx.searchLower ? hasDescendantMatch(value, ctx.searchLower) : false),
    [value, ctx.searchLower],
  );
  useEffect(() => {
    if (descendantMatch && !open) setOpen(true);
    // Only auto-expand on new match — don't force-collapse when search clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descendantMatch]);

  const keyMatch = ctx.searchLower && label.toLowerCase().includes(ctx.searchLower);
  const valueStr = isCollapsible ? '' : primitiveToString(value);
  const valueMatch = ctx.searchLower && valueStr.toLowerCase().includes(ctx.searchLower);
  const isMatch = Boolean(keyMatch || valueMatch);

  // Only the top-level object/array's direct children (depth === 1) get
  // sticky headers when scrolling within the tree container.
  const stickyCls = depth === 1 ? 'sticky top-0 z-10 bg-panel' : '';
  const matchCls = isMatch ? 'bg-yellow-100/40 dark:bg-yellow-500/20' : '';
  const rowCls = `flex items-center gap-2 px-2 py-0.5 rounded ${stickyCls} ${matchCls}`.trim();

  const handleKeyClick = () => ctx.onCopyPath(path);
  const handleValueClick = () => ctx.onCopyValue(valueStr);

  if (!isCollapsible) {
    return (
      <div className={rowCls} style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="inline-block w-3" />
        <KeyLabel label={label} onClick={handleKeyClick} match={Boolean(keyMatch)} />
        <TypeBadge type={type} />
        <span
          role="button"
          tabIndex={0}
          onClick={handleValueClick}
          title="复制值"
          className={`cursor-pointer truncate font-mono text-[12px] text-t2 hover:text-acc hover:underline ${valueMatch ? 'bg-yellow-100/60 dark:bg-yellow-500/25 rounded px-0.5' : ''}`}
        >
          {valueStr}
        </span>
      </div>
    );
  }

  const childCount = type === 'arr' ? (value as unknown[]).length : Object.keys(value as Record<string, unknown>).length;
  const previewStr = type === 'arr' ? `Array(${childCount})` : `{${childCount}}`;

  const entries: Array<{ key: string; childValue: unknown }> = isArr(type)
    ? (value as unknown[]).map((v, i) => ({ key: arrayIndexLabel(i), childValue: v }))
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, childValue: v }));

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={stickyCls}>
      <div className={rowCls} style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="inline-flex w-3 text-t3 hover:text-t1"
            aria-label={open ? '收起' : '展开'}
          >
            <Chevron open={open} />
          </button>
        </Collapsible.Trigger>
        <KeyLabel label={label} onClick={handleKeyClick} match={Boolean(keyMatch)} />
        <TypeBadge type={type} />
        <span className="font-mono text-[11px] text-t3 truncate">{previewStr}</span>
      </div>
      <Collapsible.Content>
        {entries.length === 0 ? (
          <div
            className="px-2 py-0.5 text-[11px] text-t3 italic"
            style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
          >
            {type === 'arr' ? '空数组' : '空对象'}
          </div>
        ) : (
          entries.map(({ key, childValue }) => (
            <TreeNode
              key={key}
              label={key}
              value={childValue}
              path={joinPath(path, key)}
              depth={depth + 1}
            />
          ))
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function isArr(type: NodeType): type is 'arr' {
  return type === 'arr';
}

/* ------------------------------------------------------------------ *
 * RootNode — renders the root value without an extra wrapping row.
 * ------------------------------------------------------------------ */

function RootNode({ value, path }: { value: unknown; path: string }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <div className="px-2 py-1 text-[11px] text-t3 italic">空数组</div>;
    }
    return (
      <>
        {value.map((v, i) => (
          <TreeNode
            key={`root-${i}`}
            label={arrayIndexLabel(i)}
            value={v}
            path={joinPath(path, arrayIndexLabel(i))}
            depth={1}
          />
        ))}
      </>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <div className="px-2 py-1 text-[11px] text-t3 italic">空对象</div>;
    }
    return (
      <>
        {entries.map(([k, v]) => (
          <TreeNode
            key={`root-${k}`}
            label={k}
            value={v}
            path={joinPath(path, k)}
            depth={1}
          />
        ))}
      </>
    );
  }
  // Primitive root — rare but possible (e.g. user pastes `"hello"`).
  return (
    <div className="flex items-center gap-2 px-2 py-0.5">
      <span className="inline-block w-3" />
      <span className="font-mono text-[12px] text-t3">$</span>
      <TypeBadge type={getType(value)} />
      <span
        role="button"
        tabIndex={0}
        className="cursor-pointer truncate font-mono text-[12px] text-t2 hover:text-acc hover:underline"
      >
        {primitiveToString(value)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * JsonTree — public component
 * ------------------------------------------------------------------ */

export interface JsonTreeProps {
  value: unknown;
  search?: string;
  expandAllKey?: number;
  collapseAllKey?: number;
  onCopyPath?: (path: string) => void;
  onCopyValue?: (value: string) => void;
}

export function JsonTree({
  value,
  search = '',
  expandAllKey = 0,
  collapseAllKey = 0,
  onCopyPath,
  onCopyValue,
}: JsonTreeProps) {
  const ctxValue = useMemo<TreeContextValue>(
    () => ({
      search,
      searchLower: search.toLowerCase(),
      onCopyPath: onCopyPath ?? (() => {}),
      onCopyValue: onCopyValue ?? (() => {}),
      expandAllKey,
      collapseAllKey,
    }),
    [search, onCopyPath, onCopyValue, expandAllKey, collapseAllKey],
  );

  return (
    <TreeContext.Provider value={ctxValue}>
      <div
        data-testid="json-tree"
        className="json-tree h-full w-full overflow-auto bg-panel py-1 font-ui text-t1"
      >
        {value === null || value === undefined ? (
          <div className="px-3 py-2 text-[12px] text-t3 italic">无内容</div>
        ) : (
          <RootNode value={value} path="$" />
        )}
      </div>
    </TreeContext.Provider>
  );
}
