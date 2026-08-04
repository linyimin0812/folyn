import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import type { ErSchema, ErTable, ErEnum, ErRef } from './parseDbml';

/**
 * Card geometry constants shared between layout estimation and the x6
 * react-shape renderer so the force-collision size and the drawn TableCard
 * stay in sync.
 */
export const HEADER_H = 38;
export const ROW_H = 28;
export const FIELD_NOTE_H = 16; // extra row below each field for the field note
export const NOTE_BLOCK_H = 44; // collapsed table-note block (2 lines + padding)
export const INDEX_ROW_H = 20; // one row in the indexes block
export const BLOCK_PAD = 10; // padding around table-note / index blocks

/**
 * Distinct palette for enum cards so they're visually distinguishable from
 * regular tables (dbdiagram.io uses a slightly different shade family).
 */
export const ENUM_PALETTE = [
  '#8e44ad',
  '#16a085',
  '#27ae60',
  '#2980b9',
  '#c0392b',
  '#d35400',
  '#7f8c8d',
  '#34495e',
];

/**
 * Estimate table card dimensions from field count, text length, and the
 * presence of note / index blocks. Sized to match the x6 react-shape renderer
 * so forceCollide keeps cards from overlapping their drawn size.
 */
export function estimateTableSize(table: ErTable): { width: number; height: number } {
  const PAD = 14;
  const CHAR_W = 7.8; // approx avg char width at 13px system-ui (field name/type)
  const NAME_CHAR_W = 9; // 15px header table name renders wider than fields

  // Width is driven by table name + field name/type only — notes render as
  // hover icons, indexes live in a header pill. Long notes no longer blow
  // up card width.
  const nameW = table.name.length * NAME_CHAR_W;
  let fieldsW = 0;
  for (const f of table.fields) {
    fieldsW = Math.max(fieldsW, f.name.length + f.type.length + 3);
  }
  const hasIndexes = (table.indexes?.length ?? 0) > 0;
  const hasAnyNote =
    !!table.note ||
    table.fields.some((f) => f.note) ||
    (table.indexes ?? []).some((ix) => ix.note);
  // Reserve space for header right-side overlays so the name text doesn't
  // run into the index pill (~40px + gap) and note icon (~10px + gap).
  const headerReserve = (hasIndexes ? 52 : 0) + (hasAnyNote ? 18 : 0);
  const width = Math.max(160, Math.max(nameW, fieldsW * CHAR_W) + PAD * 2 + headerReserve);
  const fieldRows = table.fields.length * ROW_H;
  const height = HEADER_H + fieldRows + PAD;
  return { width, height };
}

/**
 * Estimate enum card dimensions. Each value row has just the name + a note
 * row, no type column / no PK icon. Header height matches table cards.
 */
export function estimateEnumSize(e: ErEnum): { width: number; height: number } {
  const PAD = 14;
  const CHAR_W = 7.8;
  const NAME_CHAR_W = 9; // 15px «enum» name renders wider than 13px value rows
  // Value notes render as hover-only icons — don't factor into width.
  const nameW = e.name.length * NAME_CHAR_W + 48; // include «enum» prefix
  let valuesW = 0;
  for (const v of e.values) {
    valuesW = Math.max(valuesW, v.name.length);
  }
  const hasAnyNote = !!e.note || e.values.some((v) => v.note);
  const headerReserve = hasAnyNote ? 18 : 0;
  const width = Math.max(160, Math.max(nameW, valuesW * CHAR_W) + PAD * 2 + headerReserve);
  const valueRows = e.values.length * ROW_H;
  const height = HEADER_H + valueRows + PAD;
  return { width, height };
}

export interface Point {
  x: number;
  y: number;
}
export interface PositionedTable extends ErTable {
  x: number; // top-left x of the card bounding box
  y: number; // top-left y
  width: number;
  height: number;
  /** true when x/y came from a manual drag position (skip re-layout) */
  manual?: boolean;
}
export interface PositionedEnum extends ErEnum {
  x: number;
  y: number;
  width: number;
  height: number;
  manual?: boolean;
}
export interface ErLayout {
  tables: PositionedTable[];
  enums: PositionedEnum[];
  /** Refs are passed through as-is; the x6 `er` router + per-field ports
   *  own the anchor / path geometry now. */
  refs: ErRef[];
  width: number;
  height: number;
}

/** Axis-aligned box, top-left {x,y} + {width,height} — same shape as an x6 Node's position+size. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Z-shape orthogonal path between two boxes: source → (midX, srcY) → (midX,
 * tgtY) → target. Exits perpendicular to the boxes' L/R facing edges; midX
 * sits in the gap between those edges and snaps to a 10px grid so parallel
 * edges between the same pair collapse onto one shared vertical segment
 * instead of rendering N near-duplicate lines 1-2px apart. Returns null
 * when the two boxes are Y-aligned (no Z needed — caller draws a straight
 * line / x6 uses the default path).
 *
 * Shared by the x6 `z-orth` router (ErDiagramX6.tsx) and the standalone SVG
 * export (services/export/dbml.ts) so preview and export agree on geometry.
 */
export const Z_ORTH_GRID_PX = 10;
export function zOrthPath(source: Box, target: Box): Point[] | null {
  const scy = source.y + source.height / 2;
  const tcy = target.y + target.height / 2;
  if (scy === tcy) return null;
  const sourceOnRight = (target.x + target.width / 2) >= (source.x + source.width / 2);
  const fx = sourceOnRight ? source.x + source.width : source.x;
  const tx = sourceOnRight ? target.x : target.x + target.width;
  const mx = Math.round((fx + tx) / 2 / Z_ORTH_GRID_PX) * Z_ORTH_GRID_PX;
  return [
    { x: fx, y: scy },
    { x: mx, y: scy },
    { x: mx, y: tcy },
    { x: tx, y: tcy },
  ];
}

/**
 * True when two boxes are closer than `minGap` on both axes (i.e. overlap or
 * sit within the gap). Used by the ER canvas's drag guard: keeps cards from
 * visually overlapping while the user drags. Dragging two cards closer than
 * `minGap` reverts the move — see ErDiagramX6's `node:change:position`
 * handler.
 */
export function boxesTooClose(a: Box, b: Box, minGap: number): boolean {
  return !(
    a.x + a.width + minGap <= b.x ||
    b.x + b.width + minGap <= a.x ||
    a.y + a.height + minGap <= b.y ||
    b.y + b.height + minGap <= a.y
  );
}

/**
 * Bounding box over a set of positioned tables (top-left coords + size).
 * Kept for consumers that need a quick scan of the laid-out content area.
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
  const enums = schema.enums ?? [];
  if (tables.length === 0 && enums.length === 0) {
    return { tables: [], enums: [], refs: [], width: viewW, height: viewH };
  }

  const tableSizes = new Map(tables.map((t) => [t.name, estimateTableSize(t)]));
  const enumSizes = new Map(enums.map((e) => [e.name, estimateEnumSize(e)]));
  const manual = manualPositions ?? new Map<string, Point>();

  // `manualPositions` stores top-left {x,y} (matching PositionedTable.x/y).
  // d3-force works on center coords, so convert when building fixed nodes.
  const toCenter = (p: Point, w: number, h: number) => ({
    x: p.x + w / 2,
    y: p.y + h / 2,
  });

  // Deterministic grid start positions so repeated parses of the same input
  // produce a stable layout (d3-force has no built-in seed).
  const allCardNames = [...tables.map((t) => t.name), ...enums.map((e) => e.name)];
  const totalCards = allCardNames.length;
  const cols = Math.ceil(Math.sqrt(totalCards));
  const cellW = 280;
  const cellH = 220;
  const simNodes: SimNode[] = [];
  const fixedPositions = new Map<string, Point>();
  let gridIndex = 0;
  for (const t of tables) {
    const s = tableSizes.get(t.name)!;
    const mp = manual.get(t.name);
    if (mp) {
      fixedPositions.set(t.name, mp);
    } else {
      const col = gridIndex % cols;
      const row = Math.floor(gridIndex / cols);
      simNodes.push({
        id: t.name,
        x: col * cellW - (cols * cellW) / 2,
        y: row * cellH - (Math.ceil(totalCards / cols) * cellH) / 2,
        width: s.width,
        height: s.height,
      });
      gridIndex += 1;
    }
  }
  for (const e of enums) {
    const s = enumSizes.get(e.name)!;
    const mp = manual.get(e.name);
    if (mp) {
      fixedPositions.set(e.name, mp);
    } else {
      const col = gridIndex % cols;
      const row = Math.floor(gridIndex / cols);
      simNodes.push({
        id: e.name,
        x: col * cellW - (cols * cellW) / 2,
        y: row * cellH - (Math.ceil(totalCards / cols) * cellH) / 2,
        width: s.width,
        height: s.height,
      });
      gridIndex += 1;
    }
  }

  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const fixedNodes: SimNode[] = [];
  for (const [id, p] of fixedPositions) {
    const s = tableSizes.get(id) ?? enumSizes.get(id);
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
        .distance(200)
        .strength(0.5),
    )
    .force('charge', forceManyBody().strength(-700))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => Math.max(d.width, d.height) / 2 + 40),
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
    const s = tableSizes.get(id) ?? enumSizes.get(id);
    if (!s) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  const dx = -minX + 40;
  const dy = -minY + 40;

  const positioned: PositionedTable[] = tables.map((t) => {
    const s = tableSizes.get(t.name)!;
    const mp = fixedPositions.get(t.name);
    if (mp) {
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
    return {
      ...t,
      x: n.x + dx - s.width / 2,
      y: n.y + dy - s.height / 2,
      width: s.width,
      height: s.height,
      manual: false,
    };
  });

  const positionedEnums: PositionedEnum[] = enums.map((e) => {
    const s = enumSizes.get(e.name)!;
    const mp = fixedPositions.get(e.name);
    if (mp) {
      return {
        ...e,
        x: mp.x,
        y: mp.y,
        width: s.width,
        height: s.height,
        manual: true,
      };
    }
    const n = nodeById.get(e.name)!;
    return {
      ...e,
      x: n.x + dx - s.width / 2,
      y: n.y + dy - s.height / 2,
      width: s.width,
      height: s.height,
      manual: false,
    };
  });

  // Refs anchor only against tables (enums don't participate in relationships).
  // Geometry (anchor points + path) is owned by the x6 `er` router + per-field
  // ports in the renderer, so we pass `schema.refs` through verbatim.
  return {
    tables: positioned,
    enums: positionedEnums,
    refs: schema.refs,
    width: Math.max(viewW, maxX - minX + 80),
    height: Math.max(viewH, maxY - minY + 80),
  };
}
