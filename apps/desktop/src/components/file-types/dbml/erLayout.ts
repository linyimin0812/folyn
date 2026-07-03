import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import type { ErSchema, ErTable, ErRef } from './parseDbml';

/**
 * Card geometry constants shared between layout estimation and SVG rendering
 * so the force-collision size and the drawn TableCard stay in sync.
 */
export const HEADER_H = 30;
export const ROW_H = 22;

/**
 * Estimate table card dimensions from field count and text length.
 * Sized to match the SVG rendering in ErDiagramPreview (same font metrics),
 * so forceCollide keeps cards from overlapping their drawn size.
 */
export function estimateTableSize(table: ErTable): { width: number; height: number } {
  const PAD = 12;
  const CHAR_W = 7.2; // approx avg char width at 12px system-ui

  let maxLabel = table.name.length;
  for (const f of table.fields) {
    // "name  type" combined label length (marks no longer rendered as text)
    maxLabel = Math.max(maxLabel, f.name.length + f.type.length + 3);
  }
  const width = Math.max(160, maxLabel * CHAR_W + PAD * 2);
  const height = HEADER_H + table.fields.length * ROW_H + PAD;
  return { width, height };
}

export interface Point {
  x: number;
  y: number;
}
export interface PositionedTable extends ErTable {
  x: number; // top-left x of the card bounding box (used by SVG rendering)
  y: number; // top-left y
  width: number;
  height: number;
  /** true when x/y came from a manual drag position (skip re-layout) */
  manual?: boolean;
}
export interface LaidRef extends ErRef {
  /** anchor points on table borders + cardinality labels */
  from: { x: number; y: number; label: string };
  to: { x: number; y: number; label: string };
  path: string; // SVG path d
}
export interface ErLayout {
  tables: PositionedTable[];
  refs: LaidRef[];
  width: number;
  height: number;
}

export interface RefAnchor {
  x: number;
  y: number;
  label: string;
}

/**
 * Compute the anchor point of a ref endpoint on `self`'s border, anchored to
 * the field row referenced by `fieldName` (or the table body's vertical
 * center as a fallback). The anchor sits on the left or right edge of the
 * card depending on which side the `other` table lies, so the bezier exits
 * the field row horizontally. Shared by layoutEr and the drag-time recompute
 * in ErDiagramPreview to keep ref paths consistent.
 */
function fieldAnchor(
  self: PositionedTable,
  other: PositionedTable,
  fieldName?: string,
): { x: number; y: number } {
  const selfCenterX = self.x + self.width / 2;
  const otherCenterX = other.x + other.width / 2;
  const onRight = otherCenterX >= selfCenterX;
  const x = onRight ? self.x + self.width : self.x;

  let rowY: number;
  const idx =
    fieldName !== undefined
      ? self.fields.findIndex((f) => f.name === fieldName)
      : -1;
  if (idx >= 0) {
    rowY = self.y + HEADER_H + idx * ROW_H + ROW_H / 2;
  } else {
    // Fallback: vertical center of the field list (body midpoint).
    rowY = self.y + HEADER_H + (self.fields.length * ROW_H) / 2;
  }
  // Clamp so the anchor never escapes the card body (e.g. empty field list).
  const y = Math.max(self.y + HEADER_H, Math.min(rowY, self.y + self.height - 4));
  return { x, y };
}

/**
 * Resolve a ref's two border anchors (anchored to the referenced field rows)
 * and the orthogonal path joining them (straight segments + 90° rounded
 * corners). Returns empty path when either table is missing.
 */
export function refEndpoints(
  ref: ErRef,
  tables: PositionedTable[],
): { from: RefAnchor; to: RefAnchor; path: string } {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const from = byName.get(ref.fromTable);
  const to = byName.get(ref.toTable);
  const [fromLabel, toLabel] = ref.cardinality.split(':');
  if (!from || !to) {
    return {
      from: { x: 0, y: 0, label: fromLabel },
      to: { x: 0, y: 0, label: toLabel },
      path: '',
    };
  }
  const fromAnchor = fieldAnchor(from, to, ref.fromFields[0]);
  const toAnchor = fieldAnchor(to, from, ref.toFields[0]);
  const path = orthoRefPath(fromAnchor, toAnchor);
  return {
    from: { x: fromAnchor.x, y: fromAnchor.y, label: fromLabel },
    to: { x: toAnchor.x, y: toAnchor.y, label: toLabel },
    path,
  };
}

/**
 * Build an orthogonal (Manhattan) ref path between two border anchors with
 * 90° corners rounded by small quadratic beziers. Routing uses a single
 * mid-X waypoint so the line exits each field row horizontally, turns 90°,
 * runs vertically, then turns back into the target field row. Degenerate
 * cases (same row / same column) collapse to a straight segment.
 */
function orthoRefPath(from: Point, to: Point): string {
  if (Math.abs(from.y - to.y) < 0.5 || Math.abs(from.x - to.x) < 0.5) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const midX = (from.x + to.x) / 2;
  return orthoPath([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to], 7);
}

/**
 * Polyline with rounded 90° corners. Walks the waypoints; at each interior
 * corner it inserts `L cornerIn Q corner cornerOut` where the control point
 * is the corner itself (standard quadratic rounded corner). The corner
 * radius is clamped to half the adjacent segment lengths so short segments
 * don't distort. Endpoints are never rounded (markers own the tip).
 */
function orthoPath(points: Point[], r: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const lenIn = dist(prev, curr);
    const lenOut = dist(curr, next);
    if (lenIn === 0 || lenOut === 0) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    const rr = Math.min(r, lenIn / 2, lenOut / 2);
    const inDx = (curr.x - prev.x) / lenIn;
    const inDy = (curr.y - prev.y) / lenIn;
    const outDx = (next.x - curr.x) / lenOut;
    const outDy = (next.y - curr.y) / lenOut;
    const cIn = { x: curr.x - inDx * rr, y: curr.y - inDy * rr };
    const cOut = { x: curr.x + outDx * rr, y: curr.y + outDy * rr };
    d += ` L ${cIn.x} ${cIn.y} Q ${curr.x} ${curr.y} ${cOut.x} ${cOut.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Bounding box over a set of positioned tables (top-left coords + size).
 * Used by the "fit all" toolbar action and the grid background rect.
 */
export function tablesBounds(tables: PositionedTable[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (tables.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }
  return { minX, minY, maxX, maxY };
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
}

/**
 * Run d3-force synchronously to convergence and return a static layout.
 * Deterministic initial positions (grid) avoid layout flicker between edits.
 *
 * `manualPositions` (table name -> {x,y}) preserves user-dragged table
 * coordinates across content edits: tables present in the map keep their
 * coordinates and are excluded from the force simulation (treated as fixed
 * anchors via fx/fy so connected links still resolve). Only new/undragged
 * tables participate in the simulation.
 */
export function layoutEr(
  schema: ErSchema,
  viewW: number,
  viewH: number,
  manualPositions?: Map<string, Point>,
): ErLayout {
  const tables = schema.tables;
  if (tables.length === 0) {
    return { tables: [], refs: [], width: viewW, height: viewH };
  }

  const sizes = new Map(tables.map((t) => [t.name, estimateTableSize(t)]));
  const manual = manualPositions ?? new Map<string, Point>();

  // `manualPositions` stores top-left {x,y} (matching PositionedTable.x/y).
  // d3-force works on center coords, so convert when building fixed nodes.
  const toCenter = (p: Point, w: number, h: number) => ({
    x: p.x + w / 2,
    y: p.y + h / 2,
  });

  // Deterministic grid start positions so repeated parses of the same input
  // produce a stable layout (d3-force has no built-in seed).
  const cols = Math.ceil(Math.sqrt(tables.length));
  const cellW = 280;
  const cellH = 220;
  const simNodes: SimNode[] = [];
  const fixedPositions = new Map<string, Point>();
  let gridIndex = 0;
  for (const t of tables) {
    const s = sizes.get(t.name)!;
    const mp = manual.get(t.name);
    if (mp) {
      fixedPositions.set(t.name, mp);
    } else {
      const col = gridIndex % cols;
      const row = Math.floor(gridIndex / cols);
      simNodes.push({
        id: t.name,
        x: col * cellW - (cols * cellW) / 2,
        y: row * cellH - (Math.ceil(tables.length / cols) * cellH) / 2,
        width: s.width,
        height: s.height,
      });
      gridIndex += 1;
    }
  }

  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  // Build links that reference whichever side exists (fixed or sim node).
  // forceLink needs actual node objects in the node array; for fixed tables
  // we add them as pinned nodes (fx/fy) so the simulator can resolve links
  // while keeping their coordinates locked.
  const fixedNodes: SimNode[] = [];
  for (const [id, p] of fixedPositions) {
    const s = sizes.get(id);
    if (!s) continue;
    const c = toCenter(p, s.width, s.height);
    const node: SimNode & { fx?: number; fy?: number } = {
      id,
      x: c.x,
      y: c.y,
      width: s.width,
      height: s.height,
      fx: c.x,
      fy: c.y,
    };
    fixedNodes.push(node as unknown as SimNode);
    nodeById.set(id, node as unknown as SimNode);
  }
  const allNodes = [...simNodes, ...fixedNodes];

  const simLinks: SimLink[] = schema.refs
    .filter((r) => nodeById.has(r.fromTable) && nodeById.has(r.toTable))
    .map((r) => ({
      source: r.fromTable,
      target: r.toTable,
    }));

  const sim = forceSimulation<SimNode>(allNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(220),
    )
    .force('charge', forceManyBody().strength(-900))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => Math.max(d.width, d.height) / 2 + 24),
    )
    .stop();

  // Run to convergence synchronously (static layout, no animation).
  const simCount = simNodes.length;
  const ticks = Math.max(300, simCount * 60);
  for (let i = 0; i < ticks; i += 1) sim.tick();

  // Compute bounding box over SIM node centers only (manual positions are
  // preserved verbatim and must not be affected by the normalization shift).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of simNodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  // Expand bounds to include each fixed table's box so the SVG viewport
  // still covers manually-positioned tables (without shifting them).
  for (const [id, p] of fixedPositions) {
    const s = sizes.get(id);
    if (!s) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  const dx = -minX + 40;
  const dy = -minY + 40;

  const positioned: PositionedTable[] = tables.map((t) => {
    const s = sizes.get(t.name)!;
    const mp = fixedPositions.get(t.name);
    if (mp) {
      // Manual position preserved verbatim (top-left coords).
      return {
        ...t,
        x: mp.x,
        y: mp.y,
        width: s.width,
        height: s.height,
        manual: true,
      };
    }
    const n = nodeById.get(t.name)!;
    // Convert shifted center back to top-left.
    return {
      ...t,
      x: n.x + dx - s.width / 2,
      y: n.y + dy - s.height / 2,
      width: s.width,
      height: s.height,
      manual: false,
    };
  });

  const laidRefs: LaidRef[] = schema.refs.map((r) => {
    const { from, to, path } = refEndpoints(r, positioned);
    return { ...r, from, to, path };
  });

  return {
    tables: positioned,
    refs: laidRefs,
    width: Math.max(viewW, maxX - minX + 80),
    height: Math.max(viewH, maxY - minY + 80),
  };
}
