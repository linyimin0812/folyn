import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import type { ErSchema, ErTable, ErEnum, ErRef } from './parseDbml';

/**
 * Card geometry constants shared between layout estimation and the x6
 * react-shape renderer so the force-collision size and the drawn TableCard
 * stay in sync.
 */
export const HEADER_H = 30;
export const ROW_H = 22;
export const FIELD_NOTE_H = 14; // extra row below each field for the field note
export const NOTE_BLOCK_H = 38; // collapsed table-note block (2 lines + padding)
export const INDEX_ROW_H = 16; // one row in the indexes block
export const BLOCK_PAD = 8; // padding around table-note / index blocks

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
  const PAD = 12;
  const CHAR_W = 7.2; // approx avg char width at 12px system-ui

  let maxLabel = table.name.length;
  for (const f of table.fields) {
    // "name  type" combined label length (marks no longer rendered as text)
    maxLabel = Math.max(maxLabel, f.name.length + f.type.length + 3);
    if (f.note) {
      maxLabel = Math.max(maxLabel, f.note.length + 4);
    }
  }
  if (table.note) {
    // Note wraps but its widest single line (split on \n then by width) drives min width.
    for (const line of wrapText(table.note, Math.floor(220 / CHAR_W))) {
      maxLabel = Math.max(maxLabel, line.length);
    }
  }
  for (const ix of table.indexes ?? []) {
    const cols = ix.columns.join(', ');
    const label = `${ix.name ?? ''} (${cols})${ix.unique ? ' unique' : ''}`;
    maxLabel = Math.max(maxLabel, label.length);
  }
  const width = Math.max(160, maxLabel * CHAR_W + PAD * 2);
  const fieldRows = table.fields.length * (ROW_H + (table.fields.some((f) => f.note) ? FIELD_NOTE_H : 0));
  const noteBlock = table.note ? NOTE_BLOCK_H + BLOCK_PAD : 0;
  const indexBlock = (table.indexes?.length ?? 0) > 0
    ? table.indexes.length * INDEX_ROW_H + BLOCK_PAD
    : 0;
  const height = HEADER_H + fieldRows + noteBlock + indexBlock + PAD;
  return { width, height };
}

/**
 * Estimate enum card dimensions. Each value row has just the name + a note
 * row, no type column / no PK icon. Header height matches table cards.
 */
export function estimateEnumSize(e: ErEnum): { width: number; height: number } {
  const PAD = 12;
  const CHAR_W = 7.2;
  let maxLabel = e.name.length + 8; // include «enum» prefix
  for (const v of e.values) {
    maxLabel = Math.max(maxLabel, v.name.length);
    if (v.note) maxLabel = Math.max(maxLabel, v.note.length + 4);
  }
  const width = Math.max(160, maxLabel * CHAR_W + PAD * 2);
  const valueRows = e.values.length * (ROW_H + (e.values.some((v) => v.note) ? FIELD_NOTE_H : 0));
  const noteBlock = e.note ? NOTE_BLOCK_H + BLOCK_PAD : 0;
  const height = HEADER_H + valueRows + noteBlock + PAD;
  return { width, height };
}

/**
 * Wrap `text` into lines of at most `maxChars` characters by splitting on
 * existing newlines first, then hard-wrapping each paragraph. Used for SVG
 * <tspan> line slicing in the table-note block.
 */
export function wrapText(text: string, maxChars: number): string[] {
  if (maxChars <= 0) return [text];
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
        .distance(280),
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
