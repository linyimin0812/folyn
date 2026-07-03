import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PreviewProps } from '../types';
import { parseDbml, type ErSchema, type ErParseError } from './parseDbml';
import {
  layoutEr,
  refEndpoints,
  tablesBounds,
  HEADER_H,
  ROW_H,
  type ErLayout,
  type PositionedTable,
  type Point,
} from './erLayout';

const DEBOUNCE_MS = 300;
const GRID_SIZE = 20;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

const HEADER_PALETTE = [
  '#6c5ce7',
  '#0984e3',
  '#00b894',
  '#e17055',
  '#d63031',
  '#00cec9',
  '#fd79a8',
  '#fdcb6e',
];

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; schema: ErSchema; layout: ErLayout }
  | { kind: 'error'; errors: ErParseError[] };

export function ErDiagramPreview({ content }: PreviewProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Persisted manual table positions (top-left {x,y}). Survives content
  // edits so user-dragged tables keep their coordinates; only new/undragged
  // tables re-enter d3-force on the next layout.
  const manualPositionsRef = useRef<Map<string, Point>>(new Map());

  // Track container size so the SVG viewport follows the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Debounced parse + layout.
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
      const schema = result.schema!;
      const layout = layoutEr(schema, size.w, size.h, manualPositionsRef.current);
      if (cancelled) return;
      setState({ kind: 'ok', schema, layout });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // size intentionally excluded: re-layout on every resize is wasteful;
    // layout is recomputed on content change which is sufficient for MVP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  return (
    <div ref={containerRef} className="er-preview h-full w-full overflow-auto bg-[var(--bg)]">
      {state.kind === 'loading' && (
        <div className="flex items-center justify-center h-full text-[13px] text-[var(--t3)]">
          正在解析 DBML…
        </div>
      )}
      {state.kind === 'error' && <ErrorView errors={state.errors} />}
      {state.kind === 'ok' && (
        <Diagram
          layout={state.layout}
          manualPositionsRef={manualPositionsRef}
          containerW={size.w}
          containerH={size.h}
        />
      )}
    </div>
  );
}

function ErrorView({ errors }: { errors: ErParseError[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="text-[13px] font-medium text-[var(--t1)] mb-2">DBML 解析错误</div>
      <div className="flex flex-col gap-1.5 max-w-[520px] text-left">
        {errors.slice(0, 8).map((e, i) => (
          <div
            key={i}
            className="text-[12px] text-[var(--t2)] bg-[var(--surf)] border border-[var(--brd)] rounded-md px-3 py-2 break-words"
          >
            {e.line > 0 && (
              <span className="text-[var(--t3)] mr-2">Ln {e.line}:{e.column}</span>
            )}
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

function Diagram({
  layout,
  manualPositionsRef,
  containerW,
  containerH,
}: {
  layout: ErLayout;
  manualPositionsRef: React.MutableRefObject<Map<string, Point>>;
  containerW: number;
  containerH: number;
}) {
  // Local copy of table positions so drags update React state and re-render
  // the SVG without re-running d3-force. Initialized from layout each time
  // the layout identity changes (content re-parse), then mutated by drags.
  const [tables, setTables] = useState<PositionedTable[]>(layout.tables);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStateRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);

  // Viewport state: zoom + pan translate the whole content group; grid is a
  // toggleable dot background that lives inside the same transform so it
  // scales/pans with the diagram.
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  // Panning state (background drag). Table-card pointerdown stops
  // propagation so it never starts a pan.
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  // Keep a ref of the current zoom so the table-drag move handler (attached
  // once per drag) can divide screen deltas by the live zoom without
  // re-subscribing on every zoom change.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setTables(layout.tables);
  }, [layout]);

  // Re-derive ref paths whenever table positions change so relationship lines
  // follow dragged tables in real time (no d3-force re-run).
  const refs = useMemo(() => recomputeRefs(layout.refs, tables), [layout.refs, tables]);

  const clampZoom = useCallback((z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)), []);

  // Wheel zoom toward the cursor. Attached as a native non-passive listener
  // so preventDefault works (React's onWheel is passive on some roots).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const curZoom = zoomRef.current;
      const factor = 1 - e.deltaY * 0.001;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, curZoom * factor));
      if (newZoom === curZoom) return;
      // Keep the world point under the cursor fixed.
      const worldX = (cursorX - panX) / curZoom;
      const worldY = (cursorY - panY) / curZoom;
      setPanX(cursorX - worldX * newZoom);
      setPanY(cursorY - worldY * newZoom);
      setZoom(newZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [panX, panY]);

  // Global pointer listeners while dragging a table OR panning the canvas.
  // Attached to window so tracking continues outside the card/svg.
  useEffect(() => {
    if (!draggingId && !panning) return;
    const onTableMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      // Convert screen delta to world delta by dividing by current zoom so
      // the card follows the cursor 1:1 in world space at any zoom level.
      const z = zoomRef.current;
      const nx = ds.originX + (e.clientX - ds.startX) / z;
      const ny = ds.originY + (e.clientY - ds.startY) / z;
      setTables((prev) =>
        prev.map((t) => (t.name === ds.id ? { ...t, x: nx, y: ny } : t)),
      );
    };
    const onPanMove = (e: PointerEvent) => {
      const ps = panStateRef.current;
      if (!ps) return;
      setPanX(ps.panX + (e.clientX - ps.startX));
      setPanY(ps.panY + (e.clientY - ps.startY));
    };
    const onMove = (e: PointerEvent) => {
      if (dragStateRef.current) onTableMove(e);
      else if (panStateRef.current) onPanMove(e);
    };
    const onUp = () => {
      const ds = dragStateRef.current;
      if (ds) {
        // Persist the final position into manualPositions so the next
        // content-edit re-layout keeps this table where the user dropped it.
        setTables((prev) => {
          const table = prev.find((t) => t.name === ds.id);
          if (table) {
            manualPositionsRef.current.set(ds.id, { x: table.x, y: table.y });
          }
          return prev;
        });
        dragStateRef.current = null;
        setDraggingId(null);
      }
      if (panStateRef.current) {
        panStateRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draggingId, panning, manualPositionsRef]);

  const onTablePointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, table: PositionedTable) => {
      // Only react to primary button drags.
      if (e.button !== 0) return;
      e.stopPropagation();
      // Prevent the container's auto-scroll/selection behavior.
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStateRef.current = {
        id: table.name,
        startX: e.clientX,
        startY: e.clientY,
        originX: table.x,
        originY: table.y,
        width: table.width,
        height: table.height,
      };
      setDraggingId(table.name);
    },
    [],
  );

  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (e.button !== 0) return;
      panStateRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
      setPanning(true);
    },
    [panX, panY],
  );

  // "Fit all": zoom so every table fits the viewport with margin, then
  // center the bounding box.
  const fit = useCallback(() => {
    const b = tablesBounds(tables);
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    if (bw <= 0 || bh <= 0) return;
    const z = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min(containerW / bw, containerH / bh) * 0.9),
    );
    setZoom(z);
    setPanX((containerW - bw * z) / 2 - b.minX * z);
    setPanY((containerH - bh * z) / 2 - b.minY * z);
  }, [tables, containerW, containerH]);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-[var(--t3)]">
        空 ER 图 — 在编辑器中定义 Table 以渲染关系图
      </div>
    );
  }

  // Grid background rect covers the tables' bounds plus a generous margin so
  // panning never reveals empty (grid-less) canvas.
  const b = tablesBounds(tables);
  const gridRect = {
    x: b.minX - 2000,
    y: b.minY - 2000,
    w: b.maxX - b.minX + 4000,
    h: b.maxY - b.minY + 4000,
  };

  return (
    <div className="relative h-full w-full">
      <DiagramToolbar
        zoom={zoom}
        showGrid={showGrid}
        onZoomOut={() => setZoom((z) => clampZoom(z * 0.8))}
        onZoomIn={() => setZoom((z) => clampZoom(z * 1.25))}
        onFit={fit}
        onToggleGrid={() => setShowGrid((v) => !v)}
      />
      <svg
        ref={svgRef}
        className="er-diagram"
        style={{ width: '100%', height: '100%', display: 'block', cursor: panning ? 'grabbing' : 'grab' }}
      >
        <defs>
          <filter id="er-card-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity={0.08} />
          </filter>
          <pattern
            id="er-grid"
            width={GRID_SIZE}
            height={GRID_SIZE}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={0} cy={0} r={1} fill="var(--brd2)" />
          </pattern>
          {/*
            Crow's foot markers. `orient="auto-start-reverse"` makes markerStart
            point outward from the path start and markerEnd outward from the end.
            `markerUnits="userSpaceOnUse"` keeps the marker size independent of
            the path strokeWidth so the symbols render at a stable scale.

            Marker local-space orientation (for BOTH markerStart-reverse and
            markerEnd): the local +x axis points TOWARD the table (away from the
            path interior). The table border sits at local x=refX; the path
            interior lies in the -x direction. So shapes drawn at small x sit
            inside the connection (claw tips / bar), and the apex at refX sits
            on the border.

            er-one: a short bar perpendicular to the path, 2px inside the card
            edge on the path side (x=0 with refX=2).
            er-many: a crow's foot — apex at the border (refX,7) and three toes
            fanning ~9px into the path interior (toward -x) at ±38°, opening
            facing the connection line.
          */}
          <marker
            id="er-one"
            viewBox="0 0 10 10"
            refX={2}
            refY={5}
            markerWidth={10}
            markerHeight={10}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <line x1={0} y1={1} x2={0} y2={9} stroke="var(--t3)" strokeWidth={1.4} />
          </marker>
          <marker
            id="er-many"
            viewBox="0 0 14 14"
            refX={12}
            refY={7}
            markerWidth={14}
            markerHeight={14}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            {/* three-prong crow's foot: apex at (12,7), toes at x=3 spreading ±38° */}
            <path
              d="M 3 0 L 12 7 M 3 7 L 12 7 M 3 14 L 12 7"
              fill="none"
              stroke="var(--t3)"
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </marker>
        </defs>

        {/* Transparent pan-catcher in screen space (below the transformed
            content). pointer-events="all" so it catches presses on empty
            areas even when the grid is hidden; table cards stopPropagation
            so they never reach here. */}
        <rect
          x={0}
          y={0}
          width={containerW}
          height={containerH}
          fill="transparent"
          pointerEvents="all"
          onPointerDown={onBackgroundPointerDown}
        />

        {/* All world-space content lives inside the transform group so zoom
            and pan apply uniformly to grid, refs, and table cards. */}
        <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
          {showGrid && (
            <rect
              x={gridRect.x}
              y={gridRect.y}
              width={gridRect.w}
              height={gridRect.h}
              fill="url(#er-grid)"
              pointerEvents="none"
            />
          )}

          {/* refs first so table cards render on top */}
          {refs.map((r) =>
            r.path ? (
              <g key={r.id} className="er-ref" pointerEvents="none">
                <path
                  d={r.path}
                  fill="none"
                  stroke="var(--t3)"
                  strokeWidth={1.5}
                  markerStart={r.from.label === '1' ? 'url(#er-one)' : 'url(#er-many)'}
                  markerEnd={r.to.label === '1' ? 'url(#er-one)' : 'url(#er-many)'}
                  opacity={0.9}
                />
              </g>
            ) : null,
          )}

          {tables.map((t, i) => (
            <TableCard
              key={t.name}
              table={t}
              headerColor={t.headerColor ?? HEADER_PALETTE[i % HEADER_PALETTE.length]}
              dragging={draggingId === t.name}
              onPointerDown={onTablePointerDown}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function DiagramToolbar({
  zoom,
  showGrid,
  onZoomOut,
  onZoomIn,
  onFit,
  onToggleGrid,
}: {
  zoom: number;
  showGrid: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
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
      <span className="min-w-[34px] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
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

/**
 * Recompute ref anchor points + orthogonal paths from the (possibly dragged)
 * table positions. Delegates to the shared `refEndpoints` so the path math
 * stays identical to the layout-time computation (no duplicated anchor logic).
 */
function recomputeRefs(refs: ErLayout['refs'], tables: PositionedTable[]): ErLayout['refs'] {
  return refs.map((r) => {
    const { from, to, path } = refEndpoints(r, tables);
    return { ...r, from, to, path };
  });
}

function TableCard({
  table,
  headerColor,
  dragging,
  onPointerDown,
}: {
  table: PositionedTable;
  headerColor: string;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, table: PositionedTable) => void;
}) {
  const { x, y, width, height, name, fields } = table;
  const PAD = 12;

  return (
    <g
      className="er-table"
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={(e) => onPointerDown(e, table)}
      filter="url(#er-card-shadow)"
    >
      {/* card body */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill="var(--surf)"
        stroke="var(--brd)"
        strokeWidth={1}
      />
      {/* colored header (clipped to top rounded corners via a path) */}
      <path
        d={`M ${x + 6} ${y} H ${x + width - 6} A 6 6 0 0 1 ${x + width} ${y + 6} V ${y + HEADER_H} H ${x} V ${y + 6} A 6 6 0 0 1 ${x + 6} ${y} Z`}
        fill={headerColor}
      />
      <text
        x={x + PAD}
        y={y + HEADER_H / 2}
        dominantBaseline="central"
        fontSize={13}
        fontWeight={700}
        fill="#ffffff"
      >
        {name}
      </text>

      {/* fields */}
      {fields.map((f, i) => {
        const fy = y + HEADER_H + i * ROW_H + ROW_H / 2;
        return (
          <g key={f.name + i}>
            {/* row separator (skip the first row — header bottom already drawn) */}
            {i > 0 && (
              <line
                x1={x}
                y1={y + HEADER_H + i * ROW_H}
                x2={x + width}
                y2={y + HEADER_H + i * ROW_H}
                stroke="var(--brd2)"
                strokeWidth={1}
              />
            )}
            {f.pk ? (
              <KeyIcon cx={x + PAD + 6} cy={fy} />
            ) : null}
            <text
              x={x + PAD + (f.pk ? 18 : 0)}
              y={fy}
              dominantBaseline="central"
              fontSize={12}
              fill={f.pk ? 'var(--t1)' : 'var(--t2)'}
              fontWeight={f.pk ? 600 : 400}
            >
              {f.name}
            </text>
            <text
              x={x + width - PAD}
              y={fy}
              dominantBaseline="central"
              textAnchor="end"
              fontSize={11}
              fill="var(--t3)"
            >
              {f.type}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Gold key icon — marks primary key fields (dbdiagram.io style). */
function KeyIcon({ cx, cy }: { cx: number; cy: number }) {
  // A small key: bow (circle) on the left, shaft + teeth on the right.
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
      <circle cx={-3} cy={0} r={3} fill="none" stroke="#f1c40f" strokeWidth={1.3} />
      <path
        d="M 0 0 L 8 0 M 6 0 L 6 2 M 8 0 L 8 2"
        fill="none"
        stroke="#f1c40f"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </g>
  );
}
