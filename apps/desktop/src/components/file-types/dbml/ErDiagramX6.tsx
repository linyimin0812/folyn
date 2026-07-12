import { useCallback, useEffect, useRef, useState } from 'react';
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
          router: { name: 'er', args: { direction: 'H' } },
          connector: 'rounded',
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
      setGraphReady(true);
    })();
    return () => {
      cancelled = true;
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
  // Table-level note OR any field note OR any index note → show card note icon.
  const hasAnyNote =
    !!table.note ||
    table.fields.some((f) => f.note) ||
    indexes.some((ix) => ix.note);

  // Index info lives in the header pill now (hover for full details). No
  // expanded block, no bottom chip — card height is just header + fields.
  const height = fieldsEnd + 8;

  useEffect(() => {
    node.resize(width, height);
  }, [node, width, height]);

  const headerColor = table.headerColor ?? undefined;
  // Aggregate all notes on this card for the header note-icon hover tooltip.
  const cardNoteTooltip = [
    table.note ? `[table] ${table.note}` : null,
    ...table.fields
      .filter((f) => f.note)
      .map((f) => `[field ${f.name}] ${f.note}`),
    ...indexes
      .filter((ix) => ix.note)
      .map((ix) => `[index ${ix.name ?? '(unnamed)'}] ${ix.note}`),
  ]
    .filter(Boolean)
    .join('\n');

  // Header index pill: count on the right, <title> shows full index list.
  const indexTooltip = indexes
    .map((ix) => `${ix.name ?? '(unnamed)'} (${ix.columns.join(', ')})${ix.unique ? ' unique' : ''}`)
    .join('\n');
  const indexPillLabel = `${indexes.length} idx`;
  const indexPillW = 8 + indexPillLabel.length * 6.5;
  const indexPillX = width - PAD - indexPillW - (hasAnyNote ? 16 : 0);

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={`er-shadow-${node.id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity={0.08} />
        </filter>
      </defs>
      {/* card body */}
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
        filter={`url(#er-shadow-${node.id})`}
      />
      {/* header — darker neutral band by default; DBML `headerColor` overrides */}
      <path
        d={`M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z`}
        fill={headerColor ?? 'var(--brd2)'}
      />
      <text
        x={PAD}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={15}
        fontWeight={700}
        fill={headerColor ? '#ffffff' : 'var(--t1)'}
      >
        {table.name}
      </text>
      {/* header index pill — count on the right, hover for full index list */}
      {hasIndexes && (
        <g>
          <title>{indexTooltip}</title>
          <rect
            x={indexPillX}
            y={HEADER_H / 2 - 9}
            width={indexPillW}
            height={18}
            rx={9}
            ry={9}
            fill={headerColor ? 'rgba(255,255,255,0.18)' : 'var(--hov)'}
            stroke={headerColor ? 'rgba(255,255,255,0.35)' : 'var(--brd2)'}
            strokeWidth={1}
          />
          <text
            x={indexPillX + indexPillW / 2}
            y={HEADER_H / 2}
            dominantBaseline="central"
            textAnchor="middle"
            fontSize={11}
            fill={headerColor ? '#ffffff' : 'var(--t3)'}
          >
            {indexPillLabel}
          </text>
        </g>
      )}
      {/* card-level note icon — hover shows all notes aggregated in the tooltip */}
      {hasAnyNote && (
        <NoteIcon cx={width - PAD - 4} cy={HEADER_H / 2} note={cardNoteTooltip} />
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
              fill={f.pk ? 'var(--t1)' : 'var(--t2)'}
              fontWeight={f.pk ? 600 : 400}
            >
              {f.name}
            </text>
            <text
              x={f.note ? width - PAD - 16 : width - PAD}
              y={fy}
              dominantBaseline="central"
              textAnchor="end"
              fontSize={12}
              fill="var(--t3)"
            >
              {f.type}
            </text>
            {f.note && <NoteIcon cx={width - PAD - 7} cy={fy} note={f.note} />}
          </g>
        );
      })}
    </svg>
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

  const hasAnyNote = !!enumCard.note || enumCard.values.some((v) => v.note);
  const cardNoteTooltip = [
    enumCard.note ? `[enum] ${enumCard.note}` : null,
    ...enumCard.values
      .filter((v) => v.note)
      .map((v) => `[value ${v.name}] ${v.note}`),
  ]
    .filter(Boolean)
    .join('\n');

  // Enum cards have no indexes → always the collapsed size.
  const height = valuesEnd + 8;

  useEffect(() => {
    node.resize(width, height);
  }, [node, width, height]);

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={`er-eshadow-${node.id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity={0.08} />
        </filter>
      </defs>
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
        filter={`url(#er-eshadow-${node.id})`}
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
      {hasAnyNote && (
        <NoteIcon cx={width - PAD - 5} cy={HEADER_H / 2} note={cardNoteTooltip} />
      )}

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
              fill="var(--t2)"
            >
              {v.name}
            </text>
            {v.note && <NoteIcon cx={width - PAD - 7} cy={vy} note={v.note} />}
          </g>
        );
      })}
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
 * Small "i" icon. Click toggles a popover showing the note text (multi-line
 * aware). SVG `<title>` is kept as a hover fallback for mouse users.
 */
function NoteIcon({ cx, cy, note }: { cx: number; cy: number; note: string }) {
  const [open, setOpen] = useState(false);
  const lines = wrapNote(note, 38);
  const maxLine = Math.max(1, ...lines.map((l) => l.length));
  const boxW = maxLine * 6.4 + 16;
  const boxH = lines.length * 14 + 10;
  // Coords are relative to the icon center (0,0) — parent <g> is translated
  // to (cx, cy). Popover opens above the icon; if it'd clip the top, open below.
  const boxX = -boxW / 2;
  const boxYOpenAbove = -8 - boxH;
  const boxY = cy + boxYOpenAbove >= 0 ? boxYOpenAbove : 8;
  return (
    <g
      transform={`translate(${cx} ${cy})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <title>{note}</title>
      <circle r={5} fill="var(--acc)" />
      <text
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={9}
        fontWeight={700}
        fill="#ffffff"
        pointerEvents="none"
      >
        i
      </text>
      {open && (
        <g pointerEvents="none">
          <rect
            x={boxX}
            y={boxY}
            width={boxW}
            height={boxH}
            rx={4}
            ry={4}
            fill="var(--bg)"
            stroke="var(--brd)"
            strokeWidth={1}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.18))"
          />
          {lines.map((l, i) => (
            <text
              key={i}
              x={boxX + 8}
              y={boxY + 12 + i * 14}
              fontSize={11}
              fill="var(--t2)"
            >
              {l}
            </text>
          ))}
        </g>
      )}
    </g>
  );
}

/** Hard-wrap `text` for the NoteIcon popover. Splits on \n first, then
 *  hard-wraps each paragraph at `maxChars`. */
function wrapNote(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para.length <= maxChars) {
      out.push(para);
      continue;
    }
    for (let i = 0; i < para.length; i += maxChars) {
      out.push(para.slice(i, i + maxChars));
    }
  }
  return out.length > 0 ? out : [''];
}
