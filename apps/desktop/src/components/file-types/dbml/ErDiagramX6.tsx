import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Graph, Node } from '@antv/x6';
import type { PreviewProps } from '../types';
import { parseDbml, type ErSchema, type ErParseError } from './parseDbml';
import {
  layoutEr,
  HEADER_H,
  ROW_H,
  type Point,
  type ErLayout,
  type PositionedTable,
  type PositionedEnum,
} from './erLayout';

const DEBOUNCE_MS = 300;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; schema: ErSchema; layout: ErLayout }
  | { kind: 'error'; errors: ErParseError[] };

// Module-level guard so shape/marker registration runs once even if the
// component mounts/unmounts multiple times across tabs.
let registered = false;

// Per-graph overlay element (the React-managed sibling of the graph's own
// container div). X6 react-shape node components reach back through this map
// to render popovers as React portals attached to the overlay, decoupling
// popover DOM from the transformed SVG (foreignObject pointer-events inside
// a transformed SVG are unreliable in Chromium).
const overlayByGraph = new WeakMap<Graph, HTMLDivElement>();

/**
 * ER diagram preview backed by @antv/x6 v3. Replaces the hand-rolled SVG
 * renderer (ErDiagramPreview.tsx). x6 + react-shape are dynamic-imported
 * inside the mount effect so they don't enter the main bundle — the chunk
 * loads only when a .dbml preview is first opened (mirrors parseDbml's
 * dynamic-import of @dbml/core).
 */
export default function ErDiagramX6({ content }: PreviewProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [graphReady, setGraphReady] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  // Persisted manual positions (top-left {x,y}) per card name. Survives
  // content edits so user-dragged cards keep their coordinates; only new /
  // undragged cards re-enter d3-force on the next layout.
  const manualPositionsRef = useRef<Map<string, Point>>(new Map());
  // True until the first content load completes — drives auto-fit-on-open
  // so the first .dbml view centers content, but subsequent re-parses
  // (edits) don't override the user's manual pan/zoom.
  const firstLoadRef = useRef(true);

  // Mount: lazy-load x6 + react-shape, register shapes + markers, create graph.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ Graph }, { register }] = await Promise.all([
        import('@antv/x6'),
        import('@antv/x6-react-shape'),
      ]);
      if (cancelled) return;
      if (!registered) {
        registered = true;
        register({ shape: 'er-table', component: TableCardNode });
        register({ shape: 'er-enum', component: EnumCardNode });
        // Crow's foot markers — port of the SVG <marker> defs from the
        // previous renderer. `auto-start-reverse` makes markerStart point
        // outward from the path start and markerEnd outward from the end.
        // Marker attrs are flat at the top level of the result (tagName,
        // refX, refY, markerOrient, markerUnits are special-cased; the rest
        // become attributes on the marker's child SVG element).
        Graph.registerMarker('er-one', () => ({
          tagName: 'line',
          x1: 0,
          y1: 1,
          x2: 0,
          y2: 9,
          stroke: 'var(--t3)',
          strokeWidth: 1.4,
          refX: 2,
          refY: 5,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
        Graph.registerMarker('er-many', () => ({
          tagName: 'path',
          d: 'M 3 0 L 12 7 M 3 7 L 12 7 M 3 14 L 12 7',
          fill: 'none',
          stroke: 'var(--t3)',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          refX: 12,
          refY: 7,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
      }
      const el = containerRef.current!;
      const graph = new Graph({
        container: el,
        width: el.clientWidth,
        height: el.clientHeight,
        autoResize: true,
        grid: { visible: false, type: 'dot', size: 20, args: { color: 'var(--t3)' } },
        panning: { enabled: true, eventTypes: ['leftMouseDown'] },
        mousewheel: {
          enabled: true,
          factor: 1.1,
          minScale: ZOOM_MIN,
          maxScale: ZOOM_MAX,
          zoomAtMousePosition: true,
        },
        connecting: {
          // `er` router emits strictly orthogonal vertices (horizontal exit →
          // vertical mid-segment → horizontal entry), so all segments meet at
          // right angles. The `rounded` connector's default radius is 10,
          // which produces a large bezier arc at each corner that reads as a
          // curve; clamping to 4 keeps a slight arc without the curvy look.
          router: { name: 'er', args: { direction: 'H' } },
          connector: { name: 'rounded', args: { radius: 4 } },
          anchor: 'center',
          connectionPoint: 'anchor',
        },
        interacting: { nodeMovable: true, edgeMovable: false, magnetConnectable: false },
      });
      graph.on('node:change:position', ({ node }) => {
        const pos = node.getPosition();
        const data = node.getData() as { table?: { name: string }; enum?: { name: string } } | undefined;
        const id = data?.table?.name ?? data?.enum?.name;
        if (id) manualPositionsRef.current.set(id, { x: pos.x, y: pos.y });
      });
      graph.on('scale', ({ sx }: { sx: number }) => setZoomPct(Math.round(sx * 100)));
      graphRef.current = graph;
      if (overlayRef.current) overlayByGraph.set(graph, overlayRef.current);
      setGraphReady(true);
    })();
    return () => {
      cancelled = true;
      if (graphRef.current) overlayByGraph.delete(graphRef.current);
      graphRef.current?.dispose();
      graphRef.current = null;
      setGraphReady(false);
    };
  }, []);

  // Track container size so the graph canvas follows the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const g = graphRef.current;
      if (g) g.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Debounced parse + layout. Re-runs on content change. Container size is
  // read live so d3-force centers against the current viewport.
  useEffect(() => {
    const src = content ?? '';
    let cancelled = false;
    setState({ kind: 'loading' });
    const handle = setTimeout(async () => {
      const result = await parseDbml(src);
      if (cancelled) return;
      if (result.errors.length > 0) {
        setState({ kind: 'error', errors: result.errors });
        return;
      }
      const el = containerRef.current;
      const w = el?.clientWidth ?? 800;
      const h = el?.clientHeight ?? 600;
      const layout = layoutEr(result.schema!, w, h, manualPositionsRef.current);
      if (cancelled) return;
      setState({ kind: 'ok', schema: result.schema!, layout });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [content]);

  // Sync state → graph: rebuild nodes + edges whenever a new layout arrives.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || state.kind !== 'ok') return;
    const { layout, schema } = state;
    graph.clearCells();
    const tableMap = new Map(layout.tables.map((t) => [t.name, t]));

    for (const t of layout.tables) {
      // Field notes render as hover-only icons now — every row is ROW_H.
      const fieldRowH = ROW_H;
      const ports: Record<string, unknown>[] = [];
      t.fields.forEach((f, i) => {
        const y = HEADER_H + i * fieldRowH + fieldRowH / 2;
        ports.push({ id: `f-${f.name}-L`, group: 'left', args: { x: 0, y } });
        ports.push({ id: `f-${f.name}-R`, group: 'right', args: { x: t.width, y } });
      });
      graph.addNode({
        shape: 'er-table',
        id: `t:${t.name}`,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        data: { table: t },
        ports: {
          groups: {
            left: {
              position: 'absolute',
              attrs: { circle: { r: 0, fill: 'none', stroke: 'none' } },
            },
            right: {
              position: 'absolute',
              attrs: { circle: { r: 0, fill: 'none', stroke: 'none' } },
            },
          },
          items: ports,
        },
      });
    }

    for (const e of layout.enums) {
      graph.addNode({
        shape: 'er-enum',
        id: `e:${e.name}`,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        data: { enum: e },
      });
    }

    for (const r of schema.refs) {
      const fromTable = tableMap.get(r.fromTable);
      const toTable = tableMap.get(r.toTable);
      if (!fromTable || !toTable) continue;
      // Pick the port on the side facing the other table so the er router
      // exits the field row horizontally toward the target.
      const fromOnRight = toTable.x + toTable.width / 2 >= fromTable.x + fromTable.width / 2;
      const toOnRight = fromTable.x + fromTable.width / 2 >= toTable.x + toTable.width / 2;
      const fromField = r.fromFields[0];
      const toField = r.toFields[0];
      const [fromLabel, toLabel] = r.cardinality.split(':');
      const sourcePort = fromField ? `f-${fromField}-${fromOnRight ? 'R' : 'L'}` : undefined;
      const targetPort = toField ? `f-${toField}-${toOnRight ? 'R' : 'L'}` : undefined;
      graph.addEdge({
        source: { cell: `t:${r.fromTable}`, ...(sourcePort ? { port: sourcePort } : {}) },
        target: { cell: `t:${r.toTable}`, ...(targetPort ? { port: targetPort } : {}) },
        attrs: {
          line: {
            stroke: 'var(--t3)',
            strokeWidth: 1.5,
            opacity: 0.9,
            sourceMarker: fromLabel === '1' ? 'er-one' : 'er-many',
            targetMarker: toLabel === '1' ? 'er-one' : 'er-many',
          },
        },
      });
    }

    // First content load: fit all content into view so the user starts
    // centered. Subsequent re-parses (content edits) leave pan/zoom alone.
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      requestAnimationFrame(() => graph.zoomToFit({ padding: 40 }));
    }
  }, [state, graphReady]);

  const onZoomIn = useCallback(() => graphRef.current?.zoom(0.1), []);
  const onZoomOut = useCallback(() => graphRef.current?.zoom(-0.1), []);
  const onFit = useCallback(() => graphRef.current?.zoomToFit({ padding: 20 }), []);
  const onToggleGrid = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    setShowGrid((v) => {
      if (v) g.hideGrid();
      else g.showGrid();
      return !v;
    });
  }, []);

  const empty = state.kind === 'ok' && state.layout.tables.length === 0 && state.layout.enums.length === 0;

  return (
    <div className="er-preview relative h-full w-full overflow-hidden bg-[var(--bg)]">
      {/* X6 owns this div's DOM exclusively — React must not render siblings
          here, or reconciler mutation effects hit X6's canvas nodes and
          throw NotFoundError. */}
      <div ref={containerRef} className="absolute inset-0" />
      {/* Overlay for React-portal popovers. Sibling of the X6-owned container
          div (not a child — React must not render inside containerRef). The
          overlay itself is pointer-events:none so it doesn't block graph
          panning; individual popover portals set pointer-events:auto. */}
      <div ref={overlayRef} className="absolute inset-0 z-20 pointer-events-none" />
      {state.kind === 'loading' && <StatusMsg>正在解析 DBML…</StatusMsg>}
      {state.kind === 'error' && <ErrorView errors={state.errors} />}
      {empty && <StatusMsg>空 ER 图 — 在编辑器中定义 Table 以渲染关系图</StatusMsg>}
      {state.kind === 'ok' && state.schema.projectNote && (
        <ProjectBanner
          name={state.schema.projectName}
          databaseType={state.schema.databaseType}
          note={state.schema.projectNote}
        />
      )}
      <Toolbar
        zoom={zoomPct}
        showGrid={showGrid}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
        onToggleGrid={onToggleGrid}
      />
    </div>
  );
}

function StatusMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--t3)]">
      {children}
    </div>
  );
}

function ErrorView({ errors }: { errors: ErParseError[] }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <div className="text-[13px] font-medium text-[var(--t1)] mb-2">DBML 解析错误</div>
      <div className="flex flex-col gap-1.5 max-w-[520px] text-left">
        {errors.slice(0, 8).map((e, i) => (
          <div
            key={i}
            className="text-[12px] text-[var(--t2)] bg-[var(--surf)] border border-[var(--brd)] rounded-md px-3 py-2 break-words"
          >
            {e.line > 0 && <span className="text-[var(--t3)] mr-2">Ln {e.line}:{e.column}</span>}
            <span>{e.message}</span>
          </div>
        ))}
        {errors.length > 8 && (
          <div className="text-[11px] text-[var(--t3)] mt-1">还有 {errors.length - 8} 条错误…</div>
        )}
      </div>
    </div>
  );
}

function Toolbar({
  zoom,
  showGrid,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleGrid,
}: {
  zoom: number;
  showGrid: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleGrid: () => void;
}) {
  const btn =
    'flex items-center justify-center h-6 w-6 text-[var(--t2)] hover:bg-[var(--hov)] disabled:opacity-40 transition-colors';
  return (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-1 bg-[var(--bg)] border border-[var(--brd)] rounded-md px-1 py-0.5 text-[11px] text-[var(--t3)] shadow-sm">
      <button type="button" className={btn} onClick={onZoomOut} title="缩小" aria-label="缩小">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
      <span className="min-w-[34px] text-center tabular-nums">{zoom}%</span>
      <button type="button" className={btn} onClick={onZoomIn} title="放大" aria-label="放大">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="3" y1="8" x2="13" y2="8" />
          <line x1="8" y1="3" x2="8" y2="13" />
        </svg>
      </button>
      <button
        type="button"
        className="px-1.5 h-6 text-[var(--t2)] hover:bg-[var(--hov)] transition-colors"
        onClick={onFit}
        title="适应所有元素"
      >
        适应
      </button>
      <button
        type="button"
        className={`${btn} ${showGrid ? 'text-[var(--acc)]' : ''}`}
        onClick={onToggleGrid}
        title={showGrid ? '隐藏网格' : '显示网格'}
        aria-label="切换网格"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" />
          <line x1="6" y1="1.5" x2="6" y2="14.5" />
          <line x1="10.5" y1="1.5" x2="10.5" y2="14.5" />
          <line x1="1.5" y1="6" x2="14.5" y2="6" />
          <line x1="1.5" y1="10.5" x2="14.5" y2="10.5" />
        </svg>
      </button>
    </div>
  );
}

function ProjectBanner({
  name,
  databaseType,
  note,
}: {
  name?: string;
  databaseType?: string;
  note: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const header = [
    name ? `Project: ${name}` : 'Project',
    databaseType ? `· ${databaseType}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="absolute left-2 top-2 z-10 max-w-[min(560px,calc(100%-32px))] bg-[var(--surf)] border border-[var(--brd)] rounded-md px-3 py-2 text-[12px] shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--t1)] truncate">{header}</span>
        {note.length > 80 && (
          <button
            type="button"
            className="text-[10px] text-[var(--acc)] hover:underline shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>
      {expanded ? (
        <div className="mt-1 text-[11px] text-[var(--t3)] whitespace-pre-wrap break-words">{note}</div>
      ) : (
        <div className="mt-1 text-[11px] text-[var(--t3)] truncate" title={note}>
          {note.length > 80 ? `${note.slice(0, 79)}…` : note}
        </div>
      )}
    </div>
  );
}

// --- React-shape node components -------------------------------------------

interface TableNodeData {
  table: PositionedTable;
}
interface EnumNodeData {
  enum: PositionedEnum;
}

/**
 * Table card rendered inside x6's foreignObject. SVG content is positioned
 * relative to the node's top-left (0,0). Node size = estimateTableSize()
 * (always expanded height); when note/index blocks are collapsed a chip at
 * the bottom of the card indicates expandability.
 *
 * Visual decisions (per refactor PRD):
 *  - Neutral header by default (var(--surf) + brd); DBML `headerColor` opts in.
 *  - Table note + indexes collapse into a bottom chip "⋯ N notes · M indexes";
 *    field notes stay visible so per-field ports keep their row alignment.
 */
function TableCardNode({ node }: { node: Node }) {
  const data = node.getData() as TableNodeData;
  const table = data.table;
  const PAD = 14;
  const width = table.width;

  // Field notes are hover-only icons now (no inline text row), so every
  // field row is exactly ROW_H tall — no FIELD_NOTE_H reservation.
  const fieldRowH = ROW_H;
  const fieldsEnd = HEADER_H + table.fields.length * fieldRowH;

  const indexes = table.indexes ?? [];
  const hasIndexes = indexes.length > 0;
  // Table-level note OR any field note OR any index note → show info button.
  const hasAnyNote =
    !!table.note ||
    table.fields.some((f) => f.note) ||
    indexes.some((ix) => ix.note);

  // Card height is just header + fields (no expanded block, no bottom chip).
  const height = fieldsEnd + 8;

  useEffect(() => {
    node.resize(width, height);
  }, [node, width, height]);

  const headerColor = table.headerColor ?? undefined;

  // Unified popover state — either the table-info popover (opened from the
  // header) or a field-info popover (opened from a field row). Only one is
  // open at a time; both share the 150ms close timer, the drag-close, and the
  // scale/translate reposition effect below.
  type PopoverState =
    | { kind: 'table' }
    | { kind: 'field'; idx: number }
    | null;
  const [popover, setPopover] = useState<PopoverState>(null);
  // Tick state forces a re-render (and thus a portal-position recompute) when
  // the graph pans/zooms while the popover is open, so the popover tracks the
  // card instead of stranding at the old screen position.
  const [, setTick] = useState(0);
  const closeTimeoutRef = useRef<number | null>(null);
  const clearCloseTimer = useCallback(() => {
    if (closeTimeoutRef.current != null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimeoutRef.current = window.setTimeout(() => setPopover(null), 150);
  }, [clearCloseTimer]);
  const openTable = useCallback(() => {
    clearCloseTimer();
    setPopover({ kind: 'table' });
  }, [clearCloseTimer]);
  const openField = useCallback((idx: number) => {
    clearCloseTimer();
    setPopover((p) =>
      p?.kind === 'field' && p.idx === idx ? p : { kind: 'field', idx });
  }, [clearCloseTimer]);
  useEffect(() => {
    if (!popover) return;
    // Bring the whole card to the front so the popover (now portaled into the
    // overlay above the graph) isn't occluded by edges or other cards added
    // after this one.
    node.toFront();
    const close = () => setPopover(null);
    node.on('change:position', close);
    const graph = node.model?.graph;
    const recompute = () => setTick((t) => t + 1);
    graph?.on('scale', recompute);
    graph?.on('translate', recompute);
    graph?.on('resize', recompute);
    return () => {
      node.off('change:position', close);
      graph?.off('scale', recompute);
      graph?.off('translate', recompute);
      graph?.off('resize', recompute);
      clearCloseTimer();
    };
  }, [popover, node, clearCloseTimer]);

  // Popover content: structured noteLines (table note + per-field + per-index
  // notes) + indexLines (full index list). The portal popover wraps content
  // to a fixed width, so lines stay verbatim — no char-width fit, no cap.
  const noteLines = [
    table.note ?? null,
    ...table.fields
      .filter((f) => f.note)
      .map((f) => `[${f.name}] ${f.note}`),
    ...indexes
      .filter((ix) => ix.note)
      .map((ix) => `[${ix.name ?? '(unnamed)'}] ${ix.note}`),
  ].filter(Boolean) as string[];
  const indexLines = indexes.map(
    (ix) =>
      `${ix.name ?? '(unnamed)'} (${ix.columns.join(', ')})${ix.unique ? ' unique' : ''}`,
  );

  const indexPillLabel = `${indexes.length} idx`;
  const indexPillW = 8 + indexPillLabel.length * 6.5;
  const indexPillX = width - PAD - indexPillW;

  const hasInfo = hasIndexes || hasAnyNote;

  // Fixed-width portal popover: render into the React-managed overlay div
  // (sibling of the X6-owned container) so HTML mouse events work reliably
  // and the popover is decoupled from the node's transformed SVG.
  const POPOVER_W = 320;
  const graph = node.model?.graph;
  const overlay = graph ? overlayByGraph.get(graph) : null;
  let popoverX = 0;
  let popoverY = 0;
  if (graph && overlay) {
    const pos = node.getPosition();
    const size = node.getSize();
    const screen = graph.localToGraph(pos.x, pos.y, size.width, size.height);
    const containerW = overlay.clientWidth;
    const spaceRight = containerW - (screen.x + screen.width);
    const openRight = spaceRight >= POPOVER_W + 16;
    popoverX = openRight
      ? screen.x + screen.width + 8
      : screen.x - POPOVER_W - 8;
    // ponytail: if the chosen side clips the popover off the left edge
    // (card sits very near the left), fall back to opening right even though
    // space is tight — better a slightly cramped popover than one clipped to
    // invisibility. Symmetric right-edge clip isn't worth the branch: opening
    // left was already the "tight on the right" fallback.
    if (popoverX < 8) popoverX = Math.min(screen.x + screen.width + 8, Math.max(8, containerW - POPOVER_W - 8));
    // Y: table-info popover anchors at the card top; field-info popover
    // anchors at the hovered row so it reads as "about this field".
    const scale = graph.zoom();
    const rowTop =
      popover?.kind === 'field' ? HEADER_H + popover.idx * fieldRowH : 0;
    popoverY = screen.y + rowTop * scale;
  }

  return (
    <>
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {/* card body — no CSS filter (drop-shadow creates a compositing layer
          that lags behind scale transforms during zoom, leaving ghost edges). */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill="var(--surf)"
        stroke="var(--brd)"
        strokeWidth={1}
      />
      {/* header — darker neutral band by default; DBML `headerColor` overrides.
          Hover on the header opens the table-info popover beside the card. */}
      <path
        d={`M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z`}
        fill={headerColor ?? 'var(--brd2)'}
        style={hasInfo ? { cursor: 'help' } : undefined}
        onMouseEnter={hasInfo ? openTable : undefined}
        onMouseLeave={hasInfo ? scheduleClose : undefined}
      />
      <text
        x={PAD}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={15}
        fontWeight={700}
        fill={headerColor ? '#ffffff' : 'var(--t1)'}
        pointerEvents="none"
      >
        {table.name}
      </text>
      {/* index pill — non-interactive count badge (popover opens via header hover) */}
      {hasIndexes && (
        <IndexPill
          x={indexPillX}
          y={HEADER_H / 2 - 9}
          w={indexPillW}
          label={indexPillLabel}
          headerColor={headerColor}
        />
      )}

      {table.fields.map((f, i) => {
        const blockTop = HEADER_H + i * fieldRowH;
        const fy = blockTop + ROW_H / 2;
        return (
          <g key={f.name + i}>
            {i > 0 && (
              <line
                x1={0}
                y1={blockTop}
                x2={width}
                y2={blockTop}
                stroke="var(--brd2)"
                strokeWidth={1}
              />
            )}
            {f.pk ? <KeyIcon cx={PAD + 7} cy={fy} /> : null}
            <text
              x={PAD + (f.pk ? 22 : 0)}
              y={fy}
              dominantBaseline="central"
              fontSize={13}
              fill="var(--t1)"
              fontWeight={f.pk ? 600 : 400}
            >
              {f.name}
            </text>
            <text
              x={width - PAD}
              y={fy}
              dominantBaseline="central"
              textAnchor="end"
              fontSize={12}
              fill="var(--t2)"
            >
              {f.type}
            </text>
            {/* Hover catcher for the field-info popover. Transparent rect over
                the full row, last in DOM so it's on top and catches pointer
                events across the whole row width (text/icons below are
                pointer-events:none or just sit under it). Only fields with a
                note get a popover — gating avoids a header-only popover that
                just echoes the inline name/type. */}
            {f.note && (
              <rect
                x={0}
                y={blockTop}
                width={width}
                height={fieldRowH}
                fill="transparent"
                style={{ cursor: 'help' }}
                onMouseEnter={() => openField(i)}
                onMouseLeave={scheduleClose}
              />
            )}
          </g>
        );
      })}

      {popover && overlay && (
        popover.kind === 'table' ? (
          createPortal(
            <TableInfoPopoverHTML
              x={popoverX}
              y={popoverY}
              width={POPOVER_W}
              tableName={table.name}
              noteLines={noteLines}
              indexLines={indexLines}
              onContentMouseEnter={clearCloseTimer}
              onContentMouseLeave={scheduleClose}
            />,
            overlay,
          )
        ) : (
          createPortal(
            <FieldInfoPopoverHTML
              x={popoverX}
              y={popoverY}
              width={POPOVER_W}
              fieldName={table.fields[popover.idx].name}
              fieldType={table.fields[popover.idx].type}
              fieldNote={table.fields[popover.idx].note}
              onContentMouseEnter={clearCloseTimer}
              onContentMouseLeave={scheduleClose}
            />,
            overlay,
          )
        )
      )}
    </svg>
    </>
  );
}

/**
 * Enum card — dashed border + «enum» tag + name, no colored header.
 * Value notes render as hover-only icons (no inline text row, no chip).
 */
function EnumCardNode({ node }: { node: Node }) {
  const data = node.getData() as EnumNodeData;
  const enumCard = data.enum;
  const PAD = 14;
  const width = enumCard.width;

  // Value notes are hover-only icons now — every value row is ROW_H.
  const valueRowH = ROW_H;
  const valuesEnd = HEADER_H + enumCard.values.length * valueRowH;

  const height = valuesEnd + 8;

  useEffect(() => {
    node.resize(width, height);
  }, [node, width, height]);

  // Per-value popover state — same pattern as TableCardNode's field popover:
  // 150ms close timer, drag-close, scale/translate reposition. Only values
  // with a note get a popover (enum values have no type/default, so a
  // note-less row would render a header-only popover that echoes the name).
  type PopoverState = { idx: number } | null;
  const [popover, setPopover] = useState<PopoverState>(null);
  const [, setTick] = useState(0);
  const closeTimeoutRef = useRef<number | null>(null);
  const clearCloseTimer = useCallback(() => {
    if (closeTimeoutRef.current != null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimeoutRef.current = window.setTimeout(() => setPopover(null), 150);
  }, [clearCloseTimer]);
  const openValue = useCallback((idx: number) => {
    clearCloseTimer();
    setPopover((p) => (p?.idx === idx ? p : { idx }));
  }, [clearCloseTimer]);
  useEffect(() => {
    if (!popover) return;
    node.toFront();
    const close = () => setPopover(null);
    node.on('change:position', close);
    const graph = node.model?.graph;
    const recompute = () => setTick((t) => t + 1);
    graph?.on('scale', recompute);
    graph?.on('translate', recompute);
    graph?.on('resize', recompute);
    return () => {
      node.off('change:position', close);
      graph?.off('scale', recompute);
      graph?.off('translate', recompute);
      graph?.off('resize', recompute);
      clearCloseTimer();
    };
  }, [popover, node, clearCloseTimer]);

  const POPOVER_W = 280;
  const graph = node.model?.graph;
  const overlay = graph ? overlayByGraph.get(graph) : null;
  let popoverX = 0;
  let popoverY = 0;
  if (graph && overlay) {
    const pos = node.getPosition();
    const size = node.getSize();
    const screen = graph.localToGraph(pos.x, pos.y, size.width, size.height);
    const containerW = overlay.clientWidth;
    const spaceRight = containerW - (screen.x + screen.width);
    const openRight = spaceRight >= POPOVER_W + 16;
    popoverX = openRight
      ? screen.x + screen.width + 8
      : screen.x - POPOVER_W - 8;
    if (popoverX < 8) popoverX = Math.min(screen.x + screen.width + 8, Math.max(8, containerW - POPOVER_W - 8));
    const scale = graph.zoom();
    const rowTop =
      popover ? HEADER_H + popover.idx * valueRowH : 0;
    popoverY = screen.y + rowTop * scale;
  }

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill="var(--surf)"
        stroke="var(--brd)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {/* «enum» tag + name on a darker neutral header band */}
      <path
        d={`M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z`}
        fill="var(--brd2)"
      />
      <text
        x={PAD}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={12}
        fill="var(--t3)"
      >
        {'«enum»'}
      </text>
      <text
        x={PAD + 48}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={15}
        fontWeight={700}
        fill="var(--t1)"
      >
        {enumCard.name}
      </text>

      {enumCard.values.map((v, i) => {
        const blockTop = HEADER_H + i * valueRowH;
        const vy = blockTop + ROW_H / 2;
        return (
          <g key={v.name + i}>
            {i > 0 && (
              <line
                x1={0}
                y1={blockTop}
                x2={width}
                y2={blockTop}
                stroke="var(--brd2)"
                strokeWidth={1}
              />
            )}
            <text
              x={PAD}
              y={vy}
              dominantBaseline="central"
              fontSize={13}
              fill="var(--t1)"
            >
              {v.name}
            </text>
            {/* Hover catcher for the value-info popover — same pattern as
                table field rows. Only values with a note get a popover. */}
            {v.note && (
              <rect
                x={0}
                y={blockTop}
                width={width}
                height={valueRowH}
                fill="transparent"
                style={{ cursor: 'help' }}
                onMouseEnter={() => openValue(i)}
                onMouseLeave={scheduleClose}
              />
            )}
          </g>
        );
      })}

      {popover && overlay && (
        createPortal(
          <FieldInfoPopoverHTML
            x={popoverX}
            y={popoverY}
            width={POPOVER_W}
            fieldName={enumCard.values[popover.idx].name}
            fieldNote={enumCard.values[popover.idx].note}
            onContentMouseEnter={clearCloseTimer}
            onContentMouseLeave={scheduleClose}
          />,
          overlay,
        )
      )}
    </svg>
  );
}

/** Gold key icon — marks primary key fields (dbdiagram.io style). */
function KeyIcon({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
      <circle cx={-4} cy={0} r={4} fill="none" stroke="#f1c40f" strokeWidth={1.6} />
      <path
        d="M 0 0 L 10 0 M 7 0 L 7 3 M 10 0 L 10 3"
        fill="none"
        stroke="#f1c40f"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </g>
  );
}


/**
 * Unified table-info popover, rendered as plain HTML via a React portal into
 * the graph's overlay div (sibling of the X6-owned container). Decoupling it
 * from the node's transformed SVG fixes the foreignObject pointer-events bug
 * where `onMouseEnter` on the inner div never fired — the scheduleClose
 * (150ms) timer would elapse while the user was still hovering the popover
 * and it would auto-close. As a normal HTML div, mouse events work reliably.
 *
 * Structure: header bar (table icon + name) → divider → "Note" label +
 * content (wraps) → divider → "Indexes" label + bulleted list (wraps).
 * Fixed width; content wraps naturally — no truncation, no horizontal
 * overflow.
 */
function TableInfoPopoverHTML({
  x,
  y,
  width,
  tableName,
  noteLines,
  indexLines,
  onContentMouseEnter,
  onContentMouseLeave,
}: {
  x: number;
  y: number;
  width: number;
  tableName: string;
  noteLines: string[];
  indexLines: string[];
  onContentMouseEnter: () => void;
  onContentMouseLeave: () => void;
}) {
  const hasNotes = noteLines.length > 0;
  const hasIndexes = indexLines.length > 0;
  return (
    <div
      className="rounded-md border bg-[var(--surf)] text-[var(--t1)] text-[13px] font-semibold shadow-md"
      // ponytail: pointer-events:auto on the popover (overlay parent is
      // pointer-events:none so it doesn't block graph panning). position:
      // absolute + left/top are container-relative pixel coords from
      // graph.localToGraph. No CSS filter / transform — keep this a plain
      // stacking layer so it never lags behind graph transforms (the popover
      // repositions on every scale/translate event, see TableCardNode).
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        borderColor: 'var(--brd)',
        pointerEvents: 'auto',
        // ponytail: maxHeight tied to this popover's top so very long
        // note/index lists scroll inside the popover instead of overflowing
        // past the canvas bottom. calc(): 100% is the overlay (= container)
        // height; subtract the popover's own top + 8px margin.
        maxHeight: `calc(100% - ${y}px - 8px)`,
        overflowY: 'auto',
      }}
      onMouseEnter={onContentMouseEnter}
      onMouseLeave={onContentMouseLeave}
    >
      {/* header bar */}
      <div className="flex items-center gap-1.5 min-w-0 px-3 py-2.5 bg-[var(--hov)] rounded-t-md">
        <svg
          width="12"
          height="10"
          viewBox="0 0 12 10"
          fill="none"
          className="shrink-0 text-[var(--t1)]"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.93182 0.909091H2.31818C1.8161 0.909091 1.40909 1.3161 1.40909 1.81818V8.18182C1.40909 8.6839 1.8161 9.09091 2.31818 9.09091H9.93182C10.4339 9.09091 10.8409 8.6839 10.8409 8.18182V1.81818C10.8409 1.3161 10.4339 0.909091 9.93182 0.909091ZM2.31818 0C1.31403 0 0.5 0.814028 0.5 1.81818V8.18182C0.5 9.18597 1.31403 10 2.31818 10H9.93182C10.936 10 11.75 9.18597 11.75 8.18182V1.81818C11.75 0.814028 10.936 0 9.93182 0H2.31818Z"
            fill="currentColor"
          />
          <path
            d="M0.5 1.81818C0.5 0.814028 1.31403 0 2.31818 0H9.93182C10.936 0 11.75 0.814028 11.75 1.81818V2.5H0.5V1.81818Z"
            fill="currentColor"
          />
        </svg>
        <span className="text-sm font-semibold break-all">{tableName}</span>
      </div>
      <div className="h-px bg-[var(--brd2)]" />
      {hasNotes && (
        <>
          <div className="px-3 pt-1 pb-1 text-xs font-semibold text-[var(--t2)]">
            Note
          </div>
          {/* pre-wrap: preserve \n between note entries AND wrap long lines
              instead of clipping or overflowing horizontally. */}
          <div
            className="px-3 pb-2.5 text-xs font-normal text-[var(--t2)]"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {noteLines.join('\n')}
          </div>
        </>
      )}
      {hasNotes && hasIndexes && <div className="h-px bg-[var(--brd2)]" />}
      {hasIndexes && (
        <>
          <div className="px-3 pt-1 pb-0 text-xs font-semibold text-[var(--t2)]">
            Indexes
          </div>
          <ul className="px-3 pb-1.5 pl-7 font-normal leading-relaxed text-[12px] list-disc text-[var(--acc)]">
            {indexLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Per-field / per-value info popover, rendered as plain HTML via a React
 * portal into the graph's overlay div (same decoupling rationale as
 * TableInfoPopoverHTML — foreignObject pointer-events inside a transformed
 * SVG are unreliable in Chromium, so a normal HTML div keeps mouse events
 * firing and the 150ms close timer honest).
 *
 * Structure: header bar (table-grid icon + field name + optional type) →
 * divider → "Note" label + note content (preserves line breaks, scrolls past
 * 260px). No Default section: ErField doesn't expose a default value today
 * (parseDbml doesn't map `dbdefault`), so rendering that section would be
 * dead code — add it when/if parseDbml gains `default`.
 *
 * For enum values, fieldType is omitted and only the note section renders.
 */
function FieldInfoPopoverHTML({
  x,
  y,
  width,
  fieldName,
  fieldType,
  fieldNote,
  onContentMouseEnter,
  onContentMouseLeave,
}: {
  x: number;
  y: number;
  width: number;
  fieldName: string;
  fieldType?: string;
  fieldNote?: string;
  onContentMouseEnter: () => void;
  onContentMouseLeave: () => void;
}) {
  const hasNote = !!fieldNote;
  return (
    <div
      className="rounded-md border bg-[var(--surf)] text-[var(--t1)] text-[13px] font-semibold shadow-md"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        borderColor: 'var(--brd)',
        pointerEvents: 'auto',
        maxHeight: `calc(100% - ${y}px - 8px)`,
        overflowY: 'auto',
      }}
      onMouseEnter={onContentMouseEnter}
      onMouseLeave={onContentMouseLeave}
    >
      {/* header bar: grid icon + field name + type (orange/acc, monospace) */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[var(--hov)] rounded-t-md">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg
            viewBox="0 0 12 12"
            fill="none"
            width="12"
            height="12"
            className="w-3 h-3 shrink-0 text-[var(--t1)]"
          >
            <rect x="0.5" y="0.5" width="11" height="11" rx="1.5" stroke="currentColor" />
            <line x1="0.5" y1="4" x2="11.5" y2="4" stroke="currentColor" />
            <line x1="4" y1="4" x2="4" y2="11.5" stroke="currentColor" />
          </svg>
          <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
            <span className="text-sm font-semibold break-all">{fieldName}</span>
            {fieldType && (
              <span
                className="text-sm font-normal min-w-0 break-all text-[var(--acc)]"
                style={{ fontFamily: 'Inconsolata, monospace' }}
              >
                {fieldType}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="h-px bg-[var(--brd2)]" />
      {hasNote && (
        <>
          <div className="px-3 pt-1 pb-1 text-xs font-semibold text-[var(--t2)]">
            Note
          </div>
          {/* pre-wrap: preserve \n in the note AND wrap long lines instead of
              overflowing horizontally. max-h-[260px] mirrors the reference. */}
          <div
            className="px-3 pb-2.5 text-xs font-normal text-[var(--t2)] max-h-[260px] overflow-y-auto overflow-x-hidden"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {fieldNote}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Header index pill — non-interactive count badge. The popover opens via
 * header hover; this just signals "N idx" visually.
 */
function IndexPill({
  x,
  y,
  w,
  label,
  headerColor,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  headerColor?: string;
}) {
  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={w}
        height={18}
        rx={9}
        ry={9}
        fill={headerColor ? 'rgba(255,255,255,0.18)' : 'var(--hov)'}
        stroke={headerColor ? 'rgba(255,255,255,0.35)' : 'var(--brd2)'}
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + 9}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={11}
        fill={headerColor ? '#ffffff' : 'var(--t3)'}
        pointerEvents="none"
      >
        {label}
      </text>
    </g>
  );
}
