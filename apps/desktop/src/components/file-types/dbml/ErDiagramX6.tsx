import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Edge, Graph, Node } from '@antv/x6';
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
          // manhattan-computed vertices — no bezier, no rounding.
          connector: { name: 'normal' },
          anchor: 'center',
          connectionPoint: 'anchor',
        },
        interacting: { nodeMovable: true, edgeMovable: false, magnetConnectable: false },
      });
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
        scheduleMetaEmitRef.current?.();
      });
      graph.on('scale', ({ sx }: { sx: number }) => setZoomPct(Math.round(sx * 100)));
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
      graph.on('edge:click', ({ edge }) => selectEdge(edge.id));
      graph.on('blank:click', () => selectEdge(null));
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
          setZoomPct(meta.view.zoomPct);
          restoreZoomRef.current = meta.view.zoomPct;
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
      // Pick the port on the side facing the other table so the manhattan
      // router exits the field row horizontally toward the target.
      const fromOnRight = toTable.x + toTable.width / 2 >= fromTable.x + fromTable.width / 2;
      const toOnRight = fromTable.x + fromTable.width / 2 >= toTable.x + toTable.width / 2;
      const fromField = r.fromFields[0];
      const toField = r.toFields[0];
      const sourcePort = fromField ? `f-${fromField}-${fromOnRight ? 'R' : 'L'}` : undefined;
      const targetPort = toField ? `f-${toField}-${toOnRight ? 'R' : 'L'}` : undefined;

      // Manhattan router, configured PER EDGE. Root cause of the lingering
      // through-cards bug: x6 3.1.7's getSharedObstacleMap caches ONE map per
      // model keyed only by options (obstacle-map.js:134-155), while
      // `excludeTerminals` resolves against whichever edge triggered the
      // build — so the cached map excluded the FIRST edge's terminals and
      // every other edge's own cards stayed obstacles. Their padded bboxes
      // made the port-adjacent start/end points inaccessible, A* never ran
      // (router.js:55), and the silent fallback `orth` router (not
      // obstacle-aware) drew straight through cards. Fix: per-edge
      // `excludeNodes` (edge-specific node IDs) — the option key differs per
      // edge, forcing a correct rebuild each time (tens of nodes, cheap).
      //
      // startDirections/endDirections carry exactly ONE side — the side the
      // chosen port sits on. With both sides allowed, getRectPoints
      // (util.js:139) also emitted a candidate on the FAR side of the card;
      // when A* picked it, the first segment sliced through the source card.
      // One direction + `padding: 16` forces the first/last segment to be
      // horizontal (perpendicular to the card's vertical edge) and ≥16px.
      //
      // snapToGrid: false — snap() (router.js:172) shifts vertex coords onto
      // the 20px graph grid, which both breaks the port-row alignment of the
      // exit segment (turning it slightly diagonal) and can shave the 16px
      // exit below the 8px minimum.
      //
      // maxLoopCount: 20000 (default 2000) — A* explores ~(dist/step)² grid
      // cells; distant tables exhausted 2000 loops and fell back to orth.
      graph.addEdge({
        source: { cell: `t:${r.fromTable}`, ...(sourcePort ? { port: sourcePort } : {}) },
        target: { cell: `t:${r.toTable}`, ...(targetPort ? { port: targetPort } : {}) },
        router: {
          name: 'manhattan',
          args: {
            step: 10,
            padding: 16,
            maxLoopCount: 20000,
            snapToGrid: false,
            excludeNodes: [`t:${r.fromTable}`, `t:${r.toTable}`],
            startDirections: [fromOnRight ? 'right' : 'left'],
            endDirections: [toOnRight ? 'right' : 'left'],
          },
        },
        attrs: {
          line: {
            stroke: 'var(--t3)',
            strokeWidth: 1.5,
            opacity: 0.9,
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
        if (saved != null) graph.zoom(saved / 100);
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
    setPopover((p) => (p?.kind === 'table' ? null : { kind: 'table' }));
  }, [clearCloseTimer]);
  const openField = useCallback((idx: number) => {
    clearCloseTimer();
    setPopover((p) =>
      p?.kind === 'field' && p.idx === idx ? null : { kind: 'field', idx });
  }, [clearCloseTimer]);
  // ponytail: click-vs-drag guard for the header/field hover-catchers.
  // The card sits on the pannable x6 canvas; without this, a drag-pan that
  // starts on a header or field row would fire onClick (now that we
  // switched from onMouseEnter) and unintentionally open popovers. Track
  // mousedown coords; if mouseup moved >4px, skip the toggle.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const onCardDown = (e: React.MouseEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
  };
  const makeCardUp = (fn: () => void) => (e: React.MouseEvent) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 16) return;
    fn();
  };
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
          Click on the header opens the table-info popover beside the card.
          ponytail: onMouseDown+onMouseUp with drag detection replaces the
          previous onMouseEnter — no more hover popovers, and drag-pans
          starting on the header don't trigger the popover. */}
      <path
        d={`M 6 0 H ${width - 6} A 6 6 0 0 1 ${width} 6 V ${HEADER_H} H 0 V 6 A 6 6 0 0 1 6 0 Z`}
        fill={headerColor ?? 'var(--brd2)'}
        style={hasInfo ? { cursor: 'pointer' } : undefined}
        onMouseDown={hasInfo ? onCardDown : undefined}
        onMouseUp={hasInfo ? makeCardUp(openTable) : undefined}
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
            {/* Click catcher for the field-info popover. Transparent rect over
                the full row, last in DOM so it's on top and catches pointer
                events across the whole row width (text/icons below are
                pointer-events:none or just sit under it). Only fields with a
                note get a popover — gating avoids a header-only popover that
                just echoes the inline name/type. ponytail: onMouseDown+
                onMouseUp with drag detection — no hover trigger, drag-pan
                on the row doesn't open the popover. */}
            {f.note && (
              <rect
                x={0}
                y={blockTop}
                width={width}
                height={fieldRowH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseDown={onCardDown}
                onMouseUp={makeCardUp(() => openField(i))}
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
    setPopover((p) => (p?.idx === idx ? null : { idx }));
  }, [clearCloseTimer]);
  // ponytail: click-vs-drag guard — see TableCardNode's makeCardUp/onCardDown.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const onCardDown = (e: React.MouseEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
  };
  const makeCardUp = (fn: () => void) => (e: React.MouseEvent) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 16) return;
    fn();
  };
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
            {/* Click catcher for the value-info popover — same pattern as
                table field rows. Only values with a note get a popover. */}
            {v.note && (
              <rect
                x={0}
                y={blockTop}
                width={width}
                height={valueRowH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseDown={onCardDown}
                onMouseUp={makeCardUp(() => openValue(i))}
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
