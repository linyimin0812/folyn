import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Graph } from '@antv/x6';
import type { PreviewProps } from '../types';
import { parseDbml, type ErSchema, type ErParseError } from './parseDbml';
import {
  extractDbmlMeta,
  withDbmlMeta,
  type DbmlMeta,
} from './parseDbml';
import {
  layoutEr,
  boxesTooClose,
  zOrthPath,
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
// Minimum clearance enforced between any two cards while dragging — see the
// `node:change:position` handler below and `boxesTooClose` in erLayout.ts.
const DRAG_MIN_GAP = 24;

// Relationship-line click feedback: a flowing dashed line (stroke-dashoffset
// keyframe), toggled via `attrs.line.style`/`stroke`/`strokeDasharray` on the
// clicked edge — see `setEdgeSelected` + the `edge:click`/`blank:click`
// handlers in the mount effect. Pure CSS animation (no rAF polling); the
// `@keyframes` lives in a `<style>` tag rendered by this component so it
// doesn't leak into global stylesheets used by other file-type previews.
const EDGE_FLOW_ANIMATION_CSS = `@keyframes er-edge-flow { to { stroke-dashoffset: -20; } }`;
const EDGE_LINE_DEFAULT = { stroke: 'var(--t3)', strokeWidth: 1.5, strokeDasharray: null, style: { animation: 'none' } } as const;
const EDGE_LINE_SELECTED = { stroke: 'var(--acc)', strokeWidth: 2, strokeDasharray: '6 4', style: { animation: 'er-edge-flow .6s linear infinite' } } as const;

function setEdgeSelected(edge: Edge, selected: boolean): void {
  const line = selected ? EDGE_LINE_SELECTED : EDGE_LINE_DEFAULT;
  edge.attr('line/stroke', line.stroke);
  edge.attr('line/strokeWidth', line.strokeWidth);
  edge.attr('line/strokeDasharray', line.strokeDasharray);
  edge.attr('line/style', line.style);
}

/**
 * Custom Z-shape orthogonal router — delegates to `zOrthPath` in erLayout.ts
 * so the in-app preview and the standalone SVG export share the same geometry
 * (grid-snapped midX, perpendicular L/R exits). Recomputed on every node
 * move (x6 calls the router dynamically), so dragging a card keeps the route
 * orthogonal.
 *
 * Uses `sourceAnchor`/`targetAnchor` (the actual port points x6 resolves per
 * field row) — NOT `sourceBBox`/`targetBBox` center. The bbox center Y drifts
 * from the field-row Y the port sits on, so routing through it left a small
 * diagonal kink at each end ("一点折线"). The SVG export already builds
 * zero-height boxes at field Y for the same reason (services/export/dbml.ts);
 * we mirror that here.
 *
 * Trade-off: doesn't avoid OTHER cards in the gap — accepted earlier.
 */
// ponytail: edgeView typed loosely (x6's EdgeView type is awkward to import
// here); we only read sourceAnchor/targetAnchor which are stable public
// Point fields (src/view/edge/index.ts:73).
const zOrthRoute = (
  _vertices: Point[],
  _options: Record<string, unknown>,
  edgeView: {
    sourceBBox: { x: number; y: number; width: number; height: number };
    targetBBox: { x: number; y: number; width: number; height: number };
    sourceAnchor: { x: number; y: number };
    targetAnchor: { x: number; y: number };
  },
): Point[] => {
  const sa = edgeView.sourceAnchor;
  const ta = edgeView.targetAnchor;
  const path = zOrthPath(
    { x: sa.x, y: sa.y, width: 0, height: 0 },
    { x: ta.x, y: ta.y, width: 0, height: 0 },
  );
  return path ? [path[1], path[2]] : [];
};

/**
 * Pure toggle logic for the single-selected-edge model (see prd.md's "点击
 * 连线动效" amendment). `clickedEdgeId: null` models a blank-canvas click,
 * which always clears the selection. Clicking the already-selected edge
 * again deselects it (toggle); clicking any other edge switches to it.
 */
export function nextSelectedEdgeId(
  current: string | null,
  clickedEdgeId: string | null,
): string | null {
  if (clickedEdgeId === null) return null;
  return current === clickedEdgeId ? null : clickedEdgeId;
}

// ── Native X6 SVG markup builders ──────────────────────────────────────────
// Cards render as native SVG primitives (no react-shape / foreignObject) so
// they composite in lockstep with the zoom/pan transform — no ghost outlines.
// Markup is per-node (built from PositionedTable/PositionedEnum) since field
// rows vary; X6 accepts a per-node `markup` array on addNode that overrides
// the (absent) shape markup. Text content is set via the `text` attr (X6 sets
// it as the element's textContent). All visual decisions mirror the old
// TableCardNode/EnumCardNode React components exactly (same coords, sizes,
// colors, PAD=14) so the card appearance is unchanged.
interface MarkupElem {
  tagName: string;
  selector?: string;
  attrs?: Record<string, string | number | null>;
  // ponytail: presentation props (fill/stroke/font/text-anchor/…) MUST go here,
  // NOT in `attrs`. X6 applies `attrs` as SVG *attributes* via setAttribute; CSS
  // variables (`var(--t1)` etc.) in SVG attributes do NOT reliably re-resolve
  // when the theme flips (dark mode), so a card drawn with `fill="var(--surf)"`
  // stays light-mode colored. `style` goes through Dom.css → `elem.style.*`
  // (real CSS), where var() is live and theme-reactive.
  style?: Record<string, string | number>;
  // ponytail: textContent (NOT attrs.text). X6's markup renderer sets
  // element.textContent only from `define.textContent` (markup.js:70); an
  // `attrs.text` key gets kebablized to the invalid SVG attr `text` and
  // silently ignored, leaving <text> elements empty — the "卡片什么内容都没
  // 显示" bug.
  textContent?: string;
  children?: MarkupElem[];
}

const TABLE_PAD = 14;
const ENUM_PALETTE_LINE = 'var(--brd2)'; // header band fill for enums

function buildTableMarkup(t: PositionedTable): MarkupElem[] {
  const width = t.width;
  const fieldRowH = ROW_H;
  const height = HEADER_H + t.fields.length * fieldRowH + 8;
  const indexes = t.indexes ?? [];
  const hasIndexes = indexes.length > 0;
  const headerColor = t.headerColor ?? undefined;
  const children: MarkupElem[] = [
    // Inert `text`-selector anchor. The default 'rect' shape (Node.create's
    // fallback when no `shape` is passed) inherits Base's `attrs.text =
    // { refX:0.5, refY:0.5, textAnchor:'middle', fontFamily:'Arial', ... }`
    // (shape/base.js:12-20). That group targets selector 'text', but our real
    // <text> elements carry no selector, so `viewFind` (view/view/util.js:33-42)
    // would fall back to `querySelectorAll('text')` and match EVERY <text>,
    // relocating each to the node center via refX/refY — the "文字在卡片外"
    // bug. Registering a dummy element under selector 'text' makes viewFind
    // hit the selector map and stop the CSS fallback, so the group applies to
    // this empty <g> (a no-op) and our inline x/y/text-anchor/baseline/font win.
    { tagName: 'g', selector: 'text' },
    // card body — plain rect, no filter (filter/opacity would re-introduce the
    // compositing layer that ghosts during zoom — see comment on the removed
    // drop-shadow in the old TableCardNode). Stroke uses --brd2 (not --brd) to
    // match the header band fill, so the card outline reads as one color; --brd
    // is a much darker token in dark mode (#1c2136 vs #252d4a) and made the
    // left/right/bottom edges look too black next to the header. 0.5px keeps
    // the outline as light as the header's own (stroke-less) top edge.
    { tagName: 'rect', attrs: { x: 0, y: 0, width, height, rx: 6, ry: 6 }, style: { fill: 'var(--surf)', stroke: 'var(--brd2)', strokeWidth: 0.5 } },
    // header band
    { tagName: 'path', attrs: { d: `M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z` }, style: { fill: headerColor ?? ENUM_PALETTE_LINE } },
    { tagName: 'text', attrs: { x: TABLE_PAD, y: HEADER_H / 2 }, style: { dominantBaseline: 'central', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700, fill: headerColor ? '#ffffff' : 'var(--t1)', pointerEvents: 'none' }, textContent: t.name },
  ];
  if (hasIndexes) {
    const label = `${indexes.length} idx`;
    const pillW = 8 + label.length * 6.5;
    const pillX = width - TABLE_PAD - pillW;
    children.push(
      { tagName: 'rect', attrs: { x: pillX, y: HEADER_H / 2 - 9, width: pillW, height: 18, rx: 9, ry: 9 }, style: { fill: headerColor ? 'rgba(255,255,255,0.18)' : 'var(--hov)', stroke: headerColor ? 'rgba(255,255,255,0.35)' : 'var(--brd2)', strokeWidth: 1, pointerEvents: 'none' } },
      { tagName: 'text', attrs: { x: pillX + pillW / 2, y: HEADER_H / 2 }, style: { dominantBaseline: 'central', textAnchor: 'middle', fontFamily: 'var(--font-ui)', fontSize: 11, fill: headerColor ? '#ffffff' : 'var(--t3)', pointerEvents: 'none' }, textContent: label },
    );
  }
  t.fields.forEach((f, i) => {
    const blockTop = HEADER_H + i * fieldRowH;
    const fy = blockTop + ROW_H / 2;
    if (i > 0) {
      children.push({ tagName: 'line', attrs: { x1: 0, y1: blockTop, x2: width, y2: blockTop }, style: { stroke: 'var(--brd2)', strokeWidth: 1 } });
    }
    if (f.pk) {
      children.push({
        tagName: 'g',
        attrs: { transform: `translate(${TABLE_PAD + 7} ${fy})`, pointerEvents: 'none' },
        children: [
          { tagName: 'circle', attrs: { cx: -4, cy: 0, r: 4 }, style: { fill: 'none', stroke: '#f1c40f', strokeWidth: 1.6 } },
          { tagName: 'path', attrs: { d: 'M 0 0 L 10 0 M 7 0 L 7 3 M 10 0 L 10 3' }, style: { fill: 'none', stroke: '#f1c40f', strokeWidth: 1.6, strokeLinecap: 'round' } },
        ],
      });
    }
    children.push({ tagName: 'text', attrs: { x: TABLE_PAD + (f.pk ? 22 : 0), y: fy }, style: { dominantBaseline: 'central', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: f.pk ? 600 : 400, fill: 'var(--t1)', pointerEvents: 'none' }, textContent: f.name });
    children.push({ tagName: 'text', attrs: { x: width - TABLE_PAD, y: fy }, style: { dominantBaseline: 'central', textAnchor: 'end', fontFamily: 'var(--font-ui)', fontSize: 12, fill: 'var(--t2)', pointerEvents: 'none' }, textContent: f.type });
  });
  return children;
}

function buildEnumMarkup(e: PositionedEnum): MarkupElem[] {
  const width = e.width;
  const valueRowH = ROW_H;
  const height = HEADER_H + e.values.length * valueRowH + 8;
  const children: MarkupElem[] = [
    // Inert `text`-selector anchor — see buildTableMarkup for the full story.
    { tagName: 'g', selector: 'text' },
    { tagName: 'rect', attrs: { x: 0, y: 0, width, height, rx: 6, ry: 6 }, style: { fill: 'var(--surf)', stroke: 'var(--brd2)', strokeWidth: 0.5, strokeDasharray: '3 2' } },
    { tagName: 'path', attrs: { d: `M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z` }, style: { fill: ENUM_PALETTE_LINE } },
    { tagName: 'text', attrs: { x: TABLE_PAD, y: HEADER_H / 2 }, style: { dominantBaseline: 'central', fontFamily: 'var(--font-ui)', fontSize: 12, fill: 'var(--t3)', pointerEvents: 'none' }, textContent: '«enum»' },
    { tagName: 'text', attrs: { x: TABLE_PAD + 48, y: HEADER_H / 2 }, style: { dominantBaseline: 'central', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700, fill: 'var(--t1)', pointerEvents: 'none' }, textContent: e.name },
  ];
  e.values.forEach((v, i) => {
    const blockTop = HEADER_H + i * valueRowH;
    const vy = blockTop + ROW_H / 2;
    if (i > 0) {
      children.push({ tagName: 'line', attrs: { x1: 0, y1: blockTop, x2: width, y2: blockTop }, style: { stroke: 'var(--brd2)', strokeWidth: 1 } });
    }
    children.push({ tagName: 'text', attrs: { x: TABLE_PAD, y: vy }, style: { dominantBaseline: 'central', fontFamily: 'var(--font-ui)', fontSize: 13, fill: 'var(--t1)', pointerEvents: 'none' }, textContent: v.name });
  });
  return children;
}

/** True when a table card carries anything worth a popover (note/index). */
function tableHasInfo(t: PositionedTable): boolean {
  return !!t.note
    || t.fields.some((f) => f.note)
    || (t.indexes ?? []).some((ix) => ix.note)
    || (t.indexes?.length ?? 0) > 0;
}
/** True when an enum card has a note (table-level or per-value). */
function enumHasInfo(e: PositionedEnum): boolean {
  return !!e.note || e.values.some((v) => v.note);
}

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
export default function ErDiagramX6({ content, onChange }: PreviewProps) {
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
  // Last known non-colliding {x,y} per card name — the drag guard (see
  // `node:change:position` below) reverts to this when a drag would push a
  // card closer than MIN_GAP to another card. Reseeded whenever the graph
  // is rebuilt from a fresh layout (layoutEr already keeps auto-placed
  // cards apart; this just tracks the baseline so drags can be undone).
  const lastValidPositionsRef = useRef<Map<string, Point>>(new Map());
  // Currently click-selected edge id (see `setEdgeSelected` / `edge:click` /
  // `blank:click` below). Reset to null whenever `graph.clearCells()` runs
  // (content re-sync) since that destroys the underlying edge cell.
  const selectedEdgeIdRef = useRef<string | null>(null);
  // True after a node drag (node:change:position fired). Suppresses the next
  // edge:click / blank:click so a short drag that x6 treats as a click
  // doesn't accidentally select an edge (dashed-flow highlight) when the
  // user just meant to move a card. Cleared on the next click or after the
  // drag ends via setTimeout(0) so legitimate clicks right after a drag still
  // work.
  const nodeDraggedRef = useRef(false);
  // True until the first content load completes — drives auto-fit-on-open
  // so the first .dbml view centers content, but subsequent re-parses
  // (edits) don't override the user's manual pan/zoom.
  const firstLoadRef = useRef(true);

  // ponytail: persistence write-back plumbing. `contentRef` mirrors the
  // latest content prop so the debounced emit can read user-typed dbml text
  // (preserving typing when preview appends meta). `lastCompletedDbmlRef`
  // tracks the dbml-text portion of the LAST successfully completed parse —
  // set inside the timer callback AFTER setState ok/error, so a content
  // change that cancels a pending parse timer (e.g. user drags during the
  // initial @dbml/core dynamic-import window) doesn't leave us stuck in
  // the loading state with no future setState. Seeding runtime refs from
  // meta happens on first load only — re-seeding on every content change
  // would clobber drag state because CodeMirror's doc carries a stale meta
  // block. `restoreZoomRef` carries the meta's saved zoom into the
  // first-load zoom branch (restore vs. zoomToFit).
  const contentRef = useRef(content);
  contentRef.current = content;
  const lastCompletedDbmlRef = useRef<string | null>(null);
  const hasSeededFromMetaRef = useRef(false);
  const restoreZoomRef = useRef<number | null>(null);

  // ponytail: popover state for native-SVG cards. The old react-shape
  // TableCardNode/EnumCardNode owned their own popover state (open on click,
  // 150ms mouseleave auto-close, reposition on scale/translate). With native
  // markup there's no React component per node, so the PARENT owns a single
  // popover target {cell, kind, idx?}. Opening: node:click + geometry
  // hit-test (click y within the card → header row vs field row index — no
  // DOM-selector fragility, survives markup changes). Closing: blank:click,
  // node drag (change:position), mouseleave on the popover content, and
  // scale/translate just reposition (no close). `popoverRef` mirrors state for
  // the mount-effect event handlers (which close over `null` otherwise).
  // `tick` forces re-render on translate/resize so an open popover tracks its
  // card; `scale` already re-renders via setZoomPct.
  const [popover, setPopover] = useState<{ cell: string; kind: 'table' | 'field'; idx?: number } | null>(null);
  const popoverRef = useRef<typeof popover>(null);
  popoverRef.current = popover;
  const [, setTick] = useState(0);

  // Debounced meta write-back: read current content, strip old meta, append
  // new meta derived from runtime state, emit via onChange. Skipped when the
  // content already carries this exact meta (no-op). Each invocation replaces
  // the pending timer so rapid drags collapse into one emit 500ms after the
  // last change. Comparing against the content's CURRENT meta (not a
  // lastEmitted ref) handles the CodeMirror-stale-doc case: when user typing
  // emits content with a stale meta block, this still emits the correct
  // latest meta — and the resulting content change is meta-only, so the
  // parse effect skips (no graph rebuild).
  const metaEmitTimerRef = useRef<number | null>(null);
  const scheduleMetaEmit = useCallback(() => {
    if (!onChange) return;
    if (metaEmitTimerRef.current != null) {
      window.clearTimeout(metaEmitTimerRef.current);
    }
    metaEmitTimerRef.current = window.setTimeout(() => {
      metaEmitTimerRef.current = null;
      const meta: DbmlMeta = { positions: {} };
      for (const [name, p] of manualPositionsRef.current.entries()) {
        meta.positions[name] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      const view: { zoomPct?: number; showGrid?: boolean } = {};
      if (zoomPct !== 100) view.zoomPct = zoomPct;
      if (showGrid) view.showGrid = true;
      if (Object.keys(view).length > 0) meta.view = view;
      const { dbml, meta: currentMeta } = extractDbmlMeta(contentRef.current);
      if (JSON.stringify(currentMeta) === JSON.stringify(meta)) return;
      const next = withDbmlMeta(dbml, meta);
      if (next !== contentRef.current) onChange(next);
    }, 500);
  }, [onChange, zoomPct, showGrid]);
  const scheduleMetaEmitRef = useRef(scheduleMetaEmit);
  scheduleMetaEmitRef.current = scheduleMetaEmit;

  // Mount: lazy-load x6, register shapes + markers, create graph.
  // ponytail: shapes are native X6 SVG nodes (Graph.registerNode-less — per-node
  // `markup` passed at addNode), NOT react-shape/foreignObject. The previous
  // react-shape implementation wrapped each card in a <foreignObject> whose
  // HTML/SVG content composited on its own layer and lagged behind the SVG
  // `transform`-attribute pan/zoom, leaving ghost card outlines during
  // zoom/pan that vanished once the compositor caught up — the
  // "很多border，一会才消失" + "移动时也有" symptom. Native SVG markup has
  // no foreignObject, so it composites in lockstep with the zoom transform.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Graph } = await import('@antv/x6');
      if (cancelled) return;
      if (!registered) {
        registered = true;
        // Crow's foot markers — separate start/end variants because X6 applies
        // `transform: 'rotate(180)'` to the child element of marker-end only
        // (see `@antv/x6` src/registry/attr/marker.ts:17-24 — targetMarker
        // passes `{ transform: 'rotate(180)' }` as manual options, which
        // `defs.marker` spreads onto the child <path>/<line>). sourceMarker
        // does NOT rotate. Combined with `markerOrient: 'auto-start-reverse'`
        // (which reverses marker-start's orient but leaves marker-end as
        // 'auto'), the NET effect on the child's local +d_x axis is:
        //   marker-start: +d_x = +marker_x = OUT of path (toward source entity)
        //   marker-end:   +d_x = -marker_x = INTO path (away from target entity)
        // So the d path must be MIRRORED between start and end variants to
        // render the same visual shape at both ends. For marker-start (no
        // rotate): prongs at d_x=refX sit at the entity boundary, convergence
        // at d_x=refX-9 sits 9px into the path interior. For marker-end
        // (rotate 180): prongs at d_x=refX still sit at the entity boundary
        // (refX-x flips sign around refX), but convergence must move to
        // d_x=refX+9 so that after the rotate it lands 9px into the path
        // interior (marker_x = refX - d_x = -9).
        Graph.registerMarker('er-one-start', () => ({
          // Perpendicular bar 2px inside the path from the source entity
          // boundary. marker_x = d_x - refX = 0 - 2 = -2 (into path interior).
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
        Graph.registerMarker('er-one-end', () => ({
          // Mirrored: bar at d_x=2, refX=0. After rotate(180),
          // marker_x = refX - d_x = 0 - 2 = -2 (into path interior).
          tagName: 'line',
          x1: 2,
          y1: 1,
          x2: 2,
          y2: 9,
          stroke: 'var(--t3)',
          strokeWidth: 1.4,
          refX: 0,
          refY: 5,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
        Graph.registerMarker('er-many-start', () => ({
          // Three prongs AT the source entity boundary (d_x=12=refX), splaying
          // in y, converging 9px INTO the path interior (d_x=3, marker_x=-9).
          tagName: 'path',
          d: 'M 3 7 L 12 0 M 3 7 L 12 7 M 3 7 L 12 14',
          fill: 'none',
          stroke: 'var(--t3)',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          refX: 12,
          refY: 7,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
        Graph.registerMarker('er-many-end', () => ({
          // For marker-end X6 applies `transform: 'rotate(180)'` to the
          // child (src/registry/attr/marker.ts:17-24) — rotation around the
          // marker viewport origin (0,0), NOT around (refX, refY). So the
          // registered d is rotated 180° about (0,0) before rendering.
          //
          // With refX=0, refY=0 the path endpoint (vertex) aligns with the
          // marker origin, so the post-rotate shape's "attachment point"
          // stays at (0,0)=vertex=target boundary. We want post-rotate:
          //   - prongs AT boundary (x=0), y ∈ {-7, 0, +7} (fan perpendicular
          //     to path)
          //   - convergence 9px INTO path interior (x=-9, y=0)
          // Pre-rotate (mirror across origin): prongs at (0, ±7), (0, 0);
          // convergence at (9, 0). d below.
          //
          // With `startDirections: ['left','right']` the last segment is
          // horizontal, so marker +x (path direction of travel, toward
          // target) is horizontal: prongs fan vertically AT the boundary
          // and the convergence sits 9px into the path — correct crow's
          // foot (three prongs fanning OUTWARD toward the card, single
          // convergence on the path side).
          tagName: 'path',
          d: 'M 0 -7 L 9 0 M 0 0 L 9 0 M 0 7 L 9 0',
          fill: 'none',
          stroke: 'var(--t3)',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          refX: 0,
          refY: 0,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
        // Double perpendicular bar — "exactly one / mandatory one" Chen
        // notation. ALWAYS used as sourceMarker regardless of cardinality
        // (the source end of every ER relationship is mandatory-one). Two
        // vertical bar subpaths in one <path>, 3px apart. With refX=7,
        // marker_x = d_x - refX: bar at d_x=5 → marker_x=-2 (2px into path,
        // matching er-one-start placement), bar at d_x=2 → marker_x=-5 (5px
        // into path). Both bars sit just inside the path from the source
        // entity boundary — the standard "||" notation. Single <path> with
        // two subpaths (not `children: [<line/>,<line/>]`) so the return
        // type stays a plain MarkerResult without BaseResult index-signature
        // friction — matches er-many-start's shape exactly.
        Graph.registerMarker('er-one-double-start', () => ({
          tagName: 'path',
          d: 'M 5 1 L 5 9 M 2 1 L 2 9',
          fill: 'none',
          stroke: 'var(--t3)',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          refX: 7,
          refY: 5,
          markerOrient: 'auto-start-reverse' as const,
          markerUnits: 'userSpaceOnUse',
        }));
        Graph.registerRouter('z-orth', zOrthRoute);
      }
      const el = containerRef.current!;
      const graph = new Graph({
        container: el,
        width: el.clientWidth,
        height: el.clientHeight,
        autoResize: true,
        // ponytail: async:false makes the scheduler flush synchronously after
        // every addNode/addEdge (src/renderer/scheduler.ts:333 — flush uses
        // queueFlushSync instead of queueFlush). Without this, when addEdge
        // runs in the same tick as addNode, the node's portsCache isn't built
        // yet, so `findPortElem` returns null, `sourceMagnet` becomes null,
        // and the edge's sourceMarker/targetMarker anchors against the WHOLE
        // NODE bbox instead of the field-row port. With sync rendering, ports
        // render before edges resolve magnets, so markers sit at the port.
        async: false,
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
          // Router is set PER EDGE (addEdge below) — each edge needs its own
          // single start/end direction matching the port side it connects on.
          // `connector: 'normal'` draws straight polyline segments between the
          // router-computed vertices — no bezier, no rounding.
          connector: { name: 'normal' },
          anchor: 'center',
          connectionPoint: 'anchor',
        },
        interacting: { nodeMovable: true, edgeMovable: false, magnetConnectable: false },
      });
      // ponytail: decouple drag snap from visual grid size. x6 ties both to
      // the same `grid.size` field — `dragNode` reads via
      // `graph.getGridSize()` (view/node/index.ts:1169), GridManager.update
      // reads the field directly (grid.ts:82). Override the instance method so
      // drag snaps to 1px (Math.round) regardless of the visual grid size,
      // letting two field rows (ROW_H=28) align exactly. Visual grid keeps
      // using grid.size=20 for dot spacing when shown.
      (graph as Graph & { getGridSize: () => number }).getGridSize = () => 1;
      graph.on('node:change:position', ({ node }) => {
        const data = node.getData() as { table?: { name: string }; enum?: { name: string } } | undefined;
        const id = data?.table?.name ?? data?.enum?.name;
        if (!id) return;
        const pos = node.getPosition();
        const size = node.getSize();
        // Drag collision guard — see `boxesTooClose` in erLayout.ts for why.
        const collides = graph.getNodes().some((other) => {
          if (other.id === node.id) return false;
          const p = other.getPosition();
          const s = other.getSize();
          return boxesTooClose(
            { x: pos.x, y: pos.y, width: size.width, height: size.height },
            { x: p.x, y: p.y, width: s.width, height: s.height },
            DRAG_MIN_GAP,
          );
        });
        if (collides) {
          const last = lastValidPositionsRef.current.get(id);
          if (last) node.position(last.x, last.y, { silent: true });
          return;
        }
        lastValidPositionsRef.current.set(id, { x: pos.x, y: pos.y });
        manualPositionsRef.current.set(id, { x: pos.x, y: pos.y });
        nodeDraggedRef.current = true;
        scheduleMetaEmitRef.current?.();
      });
      // Clear the drag flag after the drag ends so a legitimate edge click
      // right after a drag still works. setTimeout(0) keeps the flag true
      // through the current tick (where edge:click / blank:click fire right
      // after node:mouseup) and clears it on the next.
      graph.on('node:mouseup', () => {
        if (nodeDraggedRef.current) {
          window.setTimeout(() => { nodeDraggedRef.current = false; }, 0);
        }
      });
      graph.on('scale', ({ sx }: { sx: number }) => setZoomPct(Math.round(sx * 100)));
      // Pan/resize: force a re-render so an open popover tracks its card.
      // (scale already re-renders via setZoomPct above.)
      graph.on('translate', () => setTick((t) => t + 1));
      graph.on('resize', () => setTick((t) => t + 1));
      // Close any open popover when a node is dragged (its screen position
      // is changing under it). Uses popoverRef so the handler — bound once at
      // mount — reads the latest target instead of the stale mount-time null.
      graph.on('node:change:position', ({ node }) => {
        const p = popoverRef.current;
        if (p && p.cell === node.id) setPopover(null);
      });
      // Click-to-highlight a relationship line — see `nextSelectedEdgeId` /
      // `setEdgeSelected` above. `interacting.edgeMovable: false` (set below)
      // already keeps this click from making the edge draggable/editable.
      const selectEdge = (clickedEdgeId: string | null) => {
        const nextId = nextSelectedEdgeId(selectedEdgeIdRef.current, clickedEdgeId);
        if (nextId === selectedEdgeIdRef.current) return;
        const prevEdge = selectedEdgeIdRef.current
          ? graph.getCellById(selectedEdgeIdRef.current)
          : null;
        if (prevEdge?.isEdge()) setEdgeSelected(prevEdge, false);
        const nextEdge = nextId ? graph.getCellById(nextId) : null;
        if (nextEdge?.isEdge()) setEdgeSelected(nextEdge, true);
        selectedEdgeIdRef.current = nextId;
      };
      graph.on('edge:click', ({ edge }) => {
        if (nodeDraggedRef.current) return; // suppress spurious click from drag end
        selectEdge(edge.id);
      });
      // Native-SVG card popover hit-test: pure geometry (no DOM-selector
      // dependency). Click y relative to the card → header band (y < HEADER_H)
      // → table/enum info popover (only if the card carries info); else a
      // field/value row index → that row's note popover (only if it has a
      // note). Matches the old react-shape TableCardNode/EnumCardNode click
      // targets (header click = table info; note-row click = field info).
      graph.on('node:click', ({ node, e }) => {
        if (nodeDraggedRef.current) return; // suppress spurious click from drag end
        const data = node.getData() as { table?: PositionedTable; enum?: PositionedEnum } | undefined;
        if (!data) return;
        const local = graph.clientToLocal(e.clientX, e.clientY);
        const np = node.getPosition();
        const ry = local.y - np.y;
        const openTable = () => setPopover({ cell: node.id, kind: 'table' });
        if (ry < HEADER_H) {
          if (data.table && tableHasInfo(data.table)) openTable();
          else if (data.enum && enumHasInfo(data.enum)) openTable();
          return;
        }
        const idx = Math.floor((ry - HEADER_H) / ROW_H);
        if (idx < 0) return;
        if (data.table) {
          const f = data.table.fields[idx];
          if (f && f.note) setPopover({ cell: node.id, kind: 'field', idx });
        } else if (data.enum) {
          const v = data.enum.values[idx];
          if (v && v.note) setPopover({ cell: node.id, kind: 'field', idx });
        }
      });
      graph.on('blank:click', () => {
        if (nodeDraggedRef.current) return; // suppress spurious click from drag end
        selectEdge(null);
        setPopover(null);
      });
      graphRef.current = graph;
      setGraphReady(true);
    })();
    return () => {
      cancelled = true;
      const g = graphRef.current;
      graphRef.current = null;
      setGraphReady(false);
      // Defer dispose out of React's passive-unmount phase — scheduling on
      // the next tick avoids racing any in-flight render.
      if (g) setTimeout(() => g.dispose(), 0);
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
  // ponytail: SKIP when the dbml-text portion of content matches the LAST
  // COMPLETED parse — this is the case when our own scheduleMetaEmit
  // appended/replaced the meta block (drag, zoom, grid toggle). Skipping
  // avoids `clearCells()` and the graph rebuild, which is the "动一下就刷新"
  // UX bug. The completed-parse marker is set INSIDE the timer callback
  // after setState ok/error, NOT at effect entry — so a content change that
  // cancels a pending parse timer doesn't strand us in the loading state
  // forever. Real dbml edits (user typing in CodeMirror) change the dbml
  // text and trigger a real parse. Seeding runtime refs from meta happens
  // on FIRST load only; re-seeding on every content change would clobber
  // drag state because CodeMirror's doc carries a stale meta block.
  useEffect(() => {
    const src = content ?? '';
    const { dbml, meta } = extractDbmlMeta(src);
    if (dbml === lastCompletedDbmlRef.current) return;
    if (!hasSeededFromMetaRef.current) {
      hasSeededFromMetaRef.current = true;
      if (meta) {
        manualPositionsRef.current = new Map(
          Object.entries(meta.positions).map(([name, p]) => [name, { x: p.x, y: p.y } as Point]),
        );
        if (meta.view?.showGrid) setShowGrid(true);
        if (meta.view?.zoomPct) {
          const z = meta.view.zoomPct;
          // ponytail: clamp saved zoom to a sane range — the pre-zoomTo
          // bug multiplied saved values by ~1.85 each reopen (85 → 185 →
          // 336 → …), so out-of-range saved values are corrupted, not intent.
          const safe = z >= 25 && z <= 200 ? z : null;
          if (safe != null) {
            setZoomPct(safe);
            restoreZoomRef.current = safe;
          }
        }
      }
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    const handle = setTimeout(async () => {
      const result = await parseDbml(src);
      if (cancelled) return;
      if (result.errors.length > 0) {
        setState({ kind: 'error', errors: result.errors });
        lastCompletedDbmlRef.current = dbml;
        return;
      }
      const el = containerRef.current;
      const w = el?.clientWidth ?? 800;
      const h = el?.clientHeight ?? 600;
      const layout = layoutEr(result.schema!, w, h, manualPositionsRef.current);
      if (cancelled) return;
      setState({ kind: 'ok', schema: result.schema!, layout });
      lastCompletedDbmlRef.current = dbml;
      // ponytail: after a real dbml-text change, re-merge runtime meta into
      // content so the next disk save reflects current state (CodeMirror's
      // doc may carry a stale meta block from before the edit). The resulting
      // content change is meta-only — the parse effect skips above, no
      // refresh.
      scheduleMetaEmitRef.current?.();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [content]);

  // ponytail: write-back effect for grid toggle + zoom. Fires on user-driven
  // state changes after the first parse seeded state from meta. The
  // content-meta comparison inside scheduleMetaEmit suppresses no-op emits,
  // and the parse effect's dbml-text-skip means the resulting content change
  // does NOT trigger a graph rebuild.
  useEffect(() => {
    if (!hasSeededFromMetaRef.current) return;
    scheduleMetaEmitRef.current?.();
  }, [showGrid, zoomPct]);

  // Apply showGrid to the graph whenever it or graphReady changes.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !graphReady) return;
    if (showGrid) g.showGrid();
    else g.hideGrid();
  }, [showGrid, graphReady]);

  // Clear any pending meta-emit timer on unmount.
  useEffect(() => {
    return () => {
      if (metaEmitTimerRef.current != null) {
        window.clearTimeout(metaEmitTimerRef.current);
        metaEmitTimerRef.current = null;
      }
    };
  }, []);

  // Sync state → graph: rebuild nodes + edges whenever a new layout arrives.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || state.kind !== 'ok') return;
    const { layout, schema } = state;
    graph.clearCells();
    // clearCells() destroys every edge cell, including whichever one was
    // click-selected — drop the stale id so a later click on the (new) edge
    // with the same id doesn't no-op via the "already selected" check.
    selectedEdgeIdRef.current = null;
    const tableMap = new Map(layout.tables.map((t) => [t.name, t]));

    for (const t of layout.tables) {
      lastValidPositionsRef.current.set(t.name, { x: t.x, y: t.y });
    }
    for (const e of layout.enums) {
      lastValidPositionsRef.current.set(e.name, { x: e.x, y: e.y });
    }

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
        id: `t:${t.name}`,
        markup: buildTableMarkup(t),
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
        id: `e:${e.name}`,
        markup: buildEnumMarkup(e),
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
      // Pick the port on the side facing the other table so the line
      // exits the field row horizontally toward the target.
      const fromOnRight = toTable.x + toTable.width / 2 >= fromTable.x + fromTable.width / 2;
      const toOnRight = fromTable.x + fromTable.width / 2 >= toTable.x + toTable.width / 2;
      const fromField = r.fromFields[0];
      const toField = r.toFields[0];
      const sourcePort = fromField ? `f-${fromField}-${fromOnRight ? 'R' : 'L'}` : undefined;
      const targetPort = toField ? `f-${toField}-${toOnRight ? 'R' : 'L'}` : undefined;

      // ponytail: z-orth router — Z-shape orthogonal route with 90° bends,
      // perpendicular exits, recomputed dynamically on every node move so
      // dragging a card keeps the route orthogonal. See zOrthRoute above.
      graph.addEdge({
        source: { cell: `t:${r.fromTable}`, ...(sourcePort ? { port: sourcePort } : {}) },
        target: { cell: `t:${r.toTable}`, ...(targetPort ? { port: targetPort } : {}) },
        router: { name: 'z-orth' },
        attrs: {
          line: {
            stroke: 'var(--t3)',
            strokeWidth: 1.5,
            // ponytail: stroke-opacity (paint-time alpha) — NOT element-level
            // `opacity`. opacity<1 promotes each edge <path> to its own
            // compositing layer, which lags one frame behind X6's zoom scale
            // transform and leaves ghost copies of every relationship line
            // during zoom-in/out (they vanish once the compositor settles —
            // the exact "很多border，一会后才消失" symptom). Same root cause
            // class as the drop-shadow removed from the card body (see comment
            // above the card <rect>). stroke-opacity is applied at paint time
            // and does not create a stacking context / offscreen buffer, so
            // edges composite in lockstep with the zoom transform. Visual is
            // identical (stroke still 90% opaque).
            strokeOpacity: 0.9,
            sourceMarker: 'er-one-double-start',
            targetMarker: 'er-many-end',
          },
        },
      });
    }

    // First content load: fit all content into view so the user starts
    // centered. Subsequent re-parses (content edits) leave pan/zoom alone.
    // ponytail: if the source meta carried a saved zoomPct, restore it
    // instead of zoomToFit — preserves the user's saved zoom level across
    // file reopens.
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      const saved = restoreZoomRef.current;
      restoreZoomRef.current = null;
      requestAnimationFrame(() => {
        // ponytail: zoomTo is the ABSOLUTE scale setter (zoom(factor) is a
        // relative delta — saved 85% via zoom(0.85) would land at 185%).
        if (saved != null) graph.zoomTo(saved / 100);
        else graph.zoomToFit({ padding: 40 });
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

  // Derive the open popover's portal (native-SVG cards: the parent renders
  // it into the overlay, repositioning on every render — which scale/translate
  // ticks trigger). Geometry mirrors the old TableCardNode portal math.
  let popoverPortal: React.ReactNode = null;
  if (popover && graphReady && graphRef.current && overlayRef.current) {
    const g = graphRef.current;
    const node = g.getCellById(popover.cell);
    if (node && node.isNode()) {
      const data = node.getData() as { table?: PositionedTable; enum?: PositionedEnum } | undefined;
      const t = data?.table;
      const en = data?.enum;
      if (t || en) {
        const pos = node.getPosition();
        const size = node.getSize();
        const screen = g.localToGraph(pos.x, pos.y, size.width, size.height);
        const POPOVER_W = t ? 320 : 280;
        const containerW = overlayRef.current.clientWidth;
        const spaceRight = containerW - (screen.x + screen.width);
        const openRight = spaceRight >= POPOVER_W + 16;
        let popoverX = openRight
          ? screen.x + screen.width + 8
          : screen.x - POPOVER_W - 8;
        if (popoverX < 8) popoverX = Math.min(screen.x + screen.width + 8, Math.max(8, containerW - POPOVER_W - 8));
        const scale = g.zoom();
        const rowTop = popover.kind === 'field' ? HEADER_H + (popover.idx ?? 0) * ROW_H : 0;
        const popoverY = screen.y + rowTop * scale;
        if (popover.kind === 'table' && t) {
          const indexes = t.indexes ?? [];
          const noteLines = [
            t.note ?? null,
            ...t.fields.filter((f) => f.note).map((f) => `[${f.name}] ${f.note}`),
            ...indexes.filter((ix) => ix.note).map((ix) => `[${ix.name ?? '(unnamed)'}] ${ix.note}`),
          ].filter(Boolean) as string[];
          const indexLines = indexes.map((ix) => `${ix.name ?? '(unnamed)'} (${ix.columns.join(', ')})${ix.unique ? ' unique' : ''}`);
          popoverPortal = (
            <TableInfoPopoverHTML
              x={popoverX} y={popoverY} width={POPOVER_W}
              tableName={t.name} noteLines={noteLines} indexLines={indexLines}
              onContentMouseEnter={() => {}}
              onContentMouseLeave={() => setPopover(null)}
            />
          );
        } else if (popover.kind === 'table' && en) {
          const noteLines = [
            en.note ?? null,
            ...en.values.filter((v) => v.note).map((v) => `[${v.name}] ${v.note}`),
          ].filter(Boolean) as string[];
          popoverPortal = (
            <TableInfoPopoverHTML
              x={popoverX} y={popoverY} width={POPOVER_W}
              tableName={en.name} noteLines={noteLines} indexLines={[]}
              onContentMouseEnter={() => {}}
              onContentMouseLeave={() => setPopover(null)}
            />
          );
        } else if (popover.kind === 'field' && t && popover.idx != null) {
          const f = t.fields[popover.idx];
          if (f) {
            popoverPortal = (
              <FieldInfoPopoverHTML
                x={popoverX} y={popoverY} width={POPOVER_W}
                fieldName={f.name} fieldType={f.type} fieldNote={f.note}
                onContentMouseEnter={() => {}}
                onContentMouseLeave={() => setPopover(null)}
              />
            );
          }
        } else if (popover.kind === 'field' && en && popover.idx != null) {
          const v = en.values[popover.idx];
          if (v) {
            popoverPortal = (
              <FieldInfoPopoverHTML
                x={popoverX} y={popoverY} width={POPOVER_W}
                fieldName={v.name} fieldType={undefined} fieldNote={v.note}
                onContentMouseEnter={() => {}}
                onContentMouseLeave={() => setPopover(null)}
              />
            );
          }
        }
      }
    }
  }

  return (
    <div className="er-preview relative h-full w-full overflow-hidden bg-[var(--bg)]">
      <style>{EDGE_FLOW_ANIMATION_CSS}</style>
      {/* X6 owns this div's DOM exclusively — React must not render siblings
          here, or reconciler mutation effects hit X6's canvas nodes and
          throw NotFoundError. */}
      <div ref={containerRef} className="absolute inset-0" />
      {/* Overlay for React-portal popovers. Sibling of the X6-owned container
          div (not a child — React must not render inside containerRef). The
          overlay itself is pointer-events:none so it doesn't block graph
          panning; individual popover portals set pointer-events:auto. */}
      <div ref={overlayRef} className="absolute inset-0 z-20 pointer-events-none">
        {popoverPortal}
      </div>
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

// --- Popover HTML (rendered into the graph overlay via React portal) --------

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
