/**
 * toExcel — produce an .xlsx Blob from a parsed JS value.
 *
 * Lazy-loads `exceljs` so the ~300 KB library is only pulled into its
 * chunk when the user actually clicks an Excel button.
 *
 * Two modes:
 *   - singleHeader: array of flat records → one header row (keys) + data
 *     rows. Keys are taken from the first record's union of keys.
 *   - multiHeader:  array of nested records → top-level group label spans
 *     the nested leaf keys (merged cells across header rows 1 and 2).
 *
 * Non-array inputs are wrapped in a single-element array so the function
 * still produces a valid 1-row workbook.
 *
 * exceljs row `values` setter is 0-indexed (index 0 → column A); the
 * getter is 1-indexed (index 1 → column A, index 0 is undefined). We
 * build 0-indexed arrays for the setter.
 */
import type { Workbook } from 'exceljs';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [value];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

function toCellPrimitive(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // Nested objects/arrays serialize to JSON for the cell value.
  return JSON.stringify(value);
}

async function loadExcelJs(): Promise<{
  Workbook: new () => Workbook;
}> {
  const mod = await import('exceljs');
  const Workbook = mod.Workbook;
  if (typeof Workbook !== 'function') {
    throw new Error('exceljs: Workbook is not available');
  }
  return { Workbook };
}

/**
 * Normalize exceljs's `writeBuffer()` output (Node Buffer or browser
 * ArrayBuffer) into a fresh current-realm ArrayBuffer so the global Blob
 * constructor accepts it as a BlobPart. Node Buffers from a different
 * realm (e.g. jsdom) get stringified to "[object Object]" otherwise.
 */
function toFreshArrayBuffer(buf: unknown): ArrayBuffer {
  let view: Uint8Array;
  if (ArrayBuffer.isView(buf)) {
    const src = buf as Uint8Array;
    const copy = new Uint8Array(src.byteLength);
    copy.set(src);
    view = copy;
  } else if (buf instanceof ArrayBuffer) {
    view = new Uint8Array(buf);
  } else {
    throw new Error('exceljs: writeBuffer returned unsupported type');
  }
  // Return a copy of the underlying ArrayBuffer so Blob doesn't see a
  // shared/realm-mismatched view. `Uint8Array.buffer` may be a
  // SharedArrayBuffer in some runtimes; slice returns ArrayBuffer.
  const out: ArrayBuffer = view.buffer.slice(0, view.byteLength) as ArrayBuffer;
  return out;
}

/**
 * Single-header XLSX: array of records → header row + one row per record.
 * Keys are the union of all records' keys (in first-seen order). Missing
 * keys produce empty cells.
 */
export async function toExcelSingleHeader(value: unknown): Promise<Blob> {
  const { Workbook } = await loadExcelJs();
  const records = toArray(value).filter(isPlainObject);
  const wb = new Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Collect union of keys, preserving first-seen order.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  // Header row (0-indexed: index 0 → column A).
  ws.getRow(1).values = keys;
  // Data rows.
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rowValues: (string | number | boolean | null)[] = [];
    for (const k of keys) {
      rowValues.push(toCellPrimitive(rec[k]));
    }
    ws.getRow(2 + i).values = rowValues;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([toFreshArrayBuffer(buf)], { type: XLSX_MIME });
}

/**
 * Multi-header XLSX: array of records with nested objects → 2 header rows
 * where the top-level group label is merged across its leaf keys.
 *
 * Example:
 *   [{ user: { name: 'Alice', age: 30 }, meta: { active: true } }]
 * Header row 1: A1='user' (merged A1:B1), C1='meta'
 * Header row 2: A2='name', B2='age', C2='active'
 * Data row 3:   A3='Alice', B3=30, C3=true
 */
export async function toExcelMultiHeader(value: unknown): Promise<Blob> {
  const { Workbook } = await loadExcelJs();
  const records = toArray(value).filter(isPlainObject);
  const wb = new Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Determine groups (top-level keys) and leaf keys (second-level keys),
  // preserving first-seen order across all records.
  const groups: Array<{ group: string; leaves: string[] }> = [];
  const groupIdx = new Map<string, number>();
  for (const rec of records) {
    for (const [g, v] of Object.entries(rec)) {
      if (!isPlainObject(v)) {
        // Non-object top-level field: treat as a 1-leaf group whose name
        // is the field itself.
        if (!groupIdx.has(g)) {
          groupIdx.set(g, groups.length);
          groups.push({ group: g, leaves: [g] });
        }
        continue;
      }
      if (!groupIdx.has(g)) {
        groupIdx.set(g, groups.length);
        const leaves: string[] = [];
        const seen = new Set<string>();
        for (const k of Object.keys(v)) {
          if (!seen.has(k)) {
            seen.add(k);
            leaves.push(k);
          }
        }
        groups.push({ group: g, leaves });
      } else {
        const gobj = groups[groupIdx.get(g)!];
        const seen = new Set(gobj.leaves);
        for (const k of Object.keys(v)) {
          if (!seen.has(k)) {
            seen.add(k);
            gobj.leaves.push(k);
          }
        }
      }
    }
  }

  // Flat leaf list (header row 2).
  const flatLeaves: Array<{ group: string; leaf: string }> = [];
  for (const g of groups) {
    for (const leaf of g.leaves) {
      flatLeaves.push({ group: g.group, leaf });
    }
  }

  // Header row 1 (group labels). The group label sits in the first column
  // of its range; subsequent columns in the range are empty (the merge
  // spans them visually).
  const row1: (string | number | boolean | null)[] = [];
  for (const g of groups) {
    row1.push(g.group);
    for (let i = 1; i < g.leaves.length; i++) row1.push(null);
  }
  ws.getRow(1).values = row1;

  // Header row 2 (leaf labels).
  const row2: (string | number | boolean | null)[] = flatLeaves.map(
    ({ leaf }) => leaf,
  );
  ws.getRow(2).values = row2;

  // Merge cells for each group across its leaf columns (1-indexed).
  let col = 1;
  for (const g of groups) {
    const startCol = col;
    const endCol = col + g.leaves.length - 1;
    if (endCol > startCol) {
      ws.mergeCells(1, startCol, 1, endCol);
    }
    col = endCol + 1;
  }

  // Data rows.
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const dataRow: (string | number | boolean | null)[] = [];
    for (const { group, leaf } of flatLeaves) {
      const groupVal = rec[group];
      if (isPlainObject(groupVal)) {
        dataRow.push(toCellPrimitive(groupVal[leaf]));
      } else if (group === leaf) {
        // Non-object top-level field.
        dataRow.push(toCellPrimitive(groupVal));
      } else {
        dataRow.push(null);
      }
    }
    ws.getRow(3 + i).values = dataRow;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([toFreshArrayBuffer(buf)], { type: XLSX_MIME });
}
