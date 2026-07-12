import { useCallback, useEffect, useRef, useState } from 'react';
import type { Graph, Node } from '@antv/x6';
import type { PreviewProps } from '../types';
import { parseDbml, type ErSchema, type ErParseError } from './parseDbml';
import {
  layoutEr,
  HEADER_H,
  ROW_H,
  FIELD_NOTE_H,
  INDEX_ROW_H,
  BLOCK_PAD,
  wrapText,
  type Point,
  type ErLayout,
  type PositionedTable,
  type PositionedEnum,
} from './erLayout';

const DEBOUNCE_MS = 300;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const CHIP_H = 18;

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
      const graph = new Graph({
        container: containerRef.current!,
        grid: { visible: false, type: 'dot', size: 20 },
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
          anchor: 'midpoint',
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
      const hasFieldNotes = t.fields.some((f) => f.note);
      const fieldRowH = ROW_H + (hasFieldNotes ? FIELD_NOTE_H : 0);
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
    <div
      ref={containerRef}
      className="er-preview relative h-full w-full overflow-hidden bg-[var(--bg)]"
    >
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
  const [expanded, setExpanded] = useState(false);
  const PAD = 12;
  const width = table.width;
  const height = table.height;
  const innerW = width - PAD * 2;
  const noteMaxChars = Math.max(8, Math.floor(innerW / 6));

  const hasFieldNotes = table.fields.some((f) => f.note);
  const fieldRowH = ROW_H + (hasFieldNotes ? FIELD_NOTE_H : 0);
  const fieldsEnd = HEADER_H + table.fields.length * fieldRowH;

  const noteLines = table.note ? wrapText(table.note, noteMaxChars) : [];
  const indexes = table.indexes ?? [];
  const hasTableNote = noteLines.length > 0;
  const hasIndexes = indexes.length > 0;
  const hasChip = hasTableNote || hasIndexes;

  const noteBlockH = expanded && hasTableNote ? noteLines.length * 16 + 8 : 0;
  const indexBlockH = expanded && hasIndexes ? indexes.length * INDEX_ROW_H + 8 : 0;
  let cursorY = fieldsEnd;
  const noteY = noteBlockH > 0 ? cursorY + BLOCK_PAD : cursorY;
  cursorY = noteBlockH > 0 ? noteY + noteBlockH : cursorY;
  const indexY = indexBlockH > 0 ? cursorY + BLOCK_PAD : cursorY;
  const chipY = height - CHIP_H;

  const headerColor = table.headerColor ?? undefined;
  const noteCount = (hasTableNote ? 1 : 0) + table.fields.filter((f) => f.note).length;
  const chipLabel = [
    noteCount > 0 ? `${noteCount} notes` : null,
    hasIndexes ? `${indexes.length} indexes` : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
      {/* header — neutral by default, colored only when DBML headerColor is set */}
      <path
        d={`M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z`}
        fill={headerColor ?? 'var(--surf)'}
        stroke={headerColor ? 'none' : 'var(--brd)'}
        strokeWidth={1}
      />
      <text
        x={PAD}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={13}
        fontWeight={700}
        fill={headerColor ? '#ffffff' : 'var(--t1)'}
      >
        {table.name}
      </text>

      {table.fields.map((f, i) => {
        const blockTop = HEADER_H + i * fieldRowH;
        const fy = blockTop + ROW_H / 2;
        const noteY2 = blockTop + ROW_H + (hasFieldNotes ? FIELD_NOTE_H / 2 : 0);
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
            {f.pk ? <KeyIcon cx={PAD + 6} cy={fy} /> : null}
            <text
              x={PAD + (f.pk ? 18 : 0)}
              y={fy}
              dominantBaseline="central"
              fontSize={12}
              fill={f.pk ? 'var(--t1)' : 'var(--t2)'}
              fontWeight={f.pk ? 600 : 400}
            >
              {f.name}
            </text>
            <text
              x={width - PAD}
              y={fy}
              dominantBaseline="central"
              textAnchor="end"
              fontSize={11}
              fill="var(--t3)"
            >
              {f.type}
            </text>
            {hasFieldNotes && f.note && (
              <text
                x={PAD}
                y={noteY2}
                dominantBaseline="central"
                fontSize={11}
                fill="var(--t3)"
              >
                {f.note.length > noteMaxChars ? `${f.note.slice(0, noteMaxChars - 1)}…` : f.note}
                <title>{f.note}</title>
              </text>
            )}
          </g>
        );
      })}

      {/* expanded table-note block */}
      {expanded && noteBlockH > 0 && (
        <g>
          <line
            x1={0}
            y1={noteY}
            x2={width}
            y2={noteY}
            stroke="var(--brd2)"
            strokeWidth={1}
          />
          {noteLines.map((line, i) => (
            <text
              key={i}
              x={PAD}
              y={noteY + 8 + i * 16}
              dominantBaseline="central"
              fontSize={11}
              fill="var(--t3)"
            >
              {line}
            </text>
          ))}
        </g>
      )}

      {/* expanded indexes block */}
      {expanded && indexBlockH > 0 && (
        <g>
          <line
            x1={0}
            y1={indexY}
            x2={width}
            y2={indexY}
            stroke="var(--brd2)"
            strokeWidth={1}
          />
          {indexes.map((ix, i) => {
            const iy = indexY + 8 + i * INDEX_ROW_H + INDEX_ROW_H / 2 - 4;
            const label = `${ix.name ?? '(unnamed)'} (${ix.columns.join(', ')})${ix.unique ? ' unique' : ''}${ix.note ? ' — ' + ix.note : ''}`;
            return (
              <text
                key={i}
                x={PAD}
                y={iy}
                dominantBaseline="central"
                fontSize={11}
                fill="var(--t3)"
                fontStyle="italic"
              >
                {label.length > noteMaxChars ? `${label.slice(0, noteMaxChars - 1)}…` : label}
                <title>{label}</title>
              </text>
            );
          })}
        </g>
      )}

      {/* collapsed chip */}
      {hasChip && (
        <g
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <rect
            x={PAD}
            y={chipY}
            width={Math.min(innerW, 12 + chipLabel.length * 6.5)}
            height={CHIP_H - 2}
            rx={9}
            ry={9}
            fill="var(--hov)"
            stroke="var(--brd2)"
            strokeWidth={1}
          />
          <text
            x={PAD + 8}
            y={chipY + (CHIP_H - 2) / 2}
            dominantBaseline="central"
            fontSize={11}
            fill="var(--t3)"
          >
            {expanded ? '收起' : `⋯ ${chipLabel}`}
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * Enum card — dashed border + «enum» tag + name, no colored header. Note
 * collapses into a bottom chip like table cards.
 */
function EnumCardNode({ node }: { node: Node }) {
  const data = node.getData() as EnumNodeData;
  const enumCard = data.enum;
  const [expanded, setExpanded] = useState(false);
  const PAD = 12;
  const width = enumCard.width;
  const height = enumCard.height;
  const innerW = width - PAD * 2;
  const noteMaxChars = Math.max(8, Math.floor(innerW / 6));

  const hasValueNotes = enumCard.values.some((v) => v.note);
  const valueRowH = ROW_H + (hasValueNotes ? FIELD_NOTE_H : 0);
  const valuesEnd = HEADER_H + enumCard.values.length * valueRowH;

  const noteLines = enumCard.note ? wrapText(enumCard.note, noteMaxChars) : [];
  const hasChip = noteLines.length > 0 || hasValueNotes;
  const noteBlockH = expanded && noteLines.length > 0 ? noteLines.length * 16 + 8 : 0;
  const noteY = noteBlockH > 0 ? valuesEnd + BLOCK_PAD : valuesEnd;
  const chipY = height - CHIP_H;

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
      {/* «enum» tag + name on a neutral header (no color block) */}
      <text
        x={PAD}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={11}
        fill="var(--t3)"
      >
        {'«enum»'}
      </text>
      <text
        x={PAD + 42}
        y={HEADER_H / 2}
        dominantBaseline="central"
        fontSize={13}
        fontWeight={700}
        fill="var(--t1)"
      >
        {enumCard.name}
      </text>
      <line
        x1={0}
        y1={HEADER_H}
        x2={width}
        y2={HEADER_H}
        stroke="var(--brd2)"
        strokeWidth={1}
      />

      {enumCard.values.map((v, i) => {
        const blockTop = HEADER_H + i * valueRowH;
        const vy = blockTop + ROW_H / 2;
        const noteY2 = blockTop + ROW_H + (hasValueNotes ? FIELD_NOTE_H / 2 : 0);
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
              fontSize={12}
              fill="var(--t2)"
            >
              {v.name}
            </text>
            {hasValueNotes && v.note && (
              <text
                x={PAD}
                y={noteY2}
                dominantBaseline="central"
                fontSize={11}
                fill="var(--t3)"
              >
                {v.note.length > noteMaxChars ? `${v.note.slice(0, noteMaxChars - 1)}…` : v.note}
                <title>{v.note}</title>
              </text>
            )}
          </g>
        );
      })}

      {expanded && noteBlockH > 0 && (
        <g>
          <line
            x1={0}
            y1={noteY}
            x2={width}
            y2={noteY}
            stroke="var(--brd2)"
            strokeWidth={1}
          />
          {noteLines.map((line, i) => (
            <text
              key={i}
              x={PAD}
              y={noteY + 8 + i * 16}
              dominantBaseline="central"
              fontSize={11}
              fill="var(--t3)"
            >
              {line}
            </text>
          ))}
        </g>
      )}

      {hasChip && (
        <g
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <rect
            x={PAD}
            y={chipY}
            width={Math.min(innerW, 12 + (noteLines.length + (hasValueNotes ? 1 : 0)) * 6.5)}
            height={CHIP_H - 2}
            rx={9}
            ry={9}
            fill="var(--hov)"
            stroke="var(--brd2)"
            strokeWidth={1}
          />
          <text
            x={PAD + 8}
            y={chipY + (CHIP_H - 2) / 2}
            dominantBaseline="central"
            fontSize={11}
            fill="var(--t3)"
          >
            {expanded ? '收起' : `⋯ ${noteLines.length + (hasValueNotes ? enumCard.values.filter((v) => v.note).length : 0)} notes`}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Gold key icon — marks primary key fields (dbdiagram.io style). */
function KeyIcon({ cx, cy }: { cx: number; cy: number }) {
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
