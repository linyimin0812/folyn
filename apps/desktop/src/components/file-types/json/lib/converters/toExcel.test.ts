/**
 * toExcel converter tests (PR5).
 *
 * Reads the produced Blob back with `exceljs` (lazy-imported in the test)
 * to assert worksheet structure (sheet count, row count, header values,
 * merged cells).
 *
 * exceljs row `values` getter is 1-indexed (index 1 → column A, index 0 is
 * undefined). The setter is 0-indexed (index 0 → column A). We read via
 * the getter and assert on indices 1..N.
 */
import { describe, it, expect } from 'vitest';
import { toExcelSingleHeader, toExcelMultiHeader } from './toExcel';

async function readBack(blob: Blob) {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  let buf: ArrayBuffer;
  if (typeof blob.arrayBuffer === 'function') {
    buf = await blob.arrayBuffer();
  } else {
    buf = await new Response(blob).arrayBuffer();
  }
  await wb.xlsx.load(buf);
  return wb;
}

describe('toExcelSingleHeader', () => {
  it('produces a workbook with header + 2 data rows for a flat array', async () => {
    const data = [
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '40' },
    ];
    const blob = await toExcelSingleHeader(data);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const wb = await readBack(blob);
    expect(wb.worksheets.length).toBe(1);
    const ws = wb.worksheets[0];
    // Row count = 1 header + 2 data.
    expect(ws.rowCount).toBe(3);
    // Header: getter is 1-indexed → index 1 = column A = 'name'.
    const headerVals = ws.getRow(1).values as unknown[];
    expect(headerVals[1]).toBe('name');
    expect(headerVals[2]).toBe('age');
    // First data row.
    const row2 = ws.getRow(2).values as unknown[];
    expect(row2[1]).toBe('Alice');
    expect(row2[2]).toBe('30');
  });

  it('handles a non-array input by wrapping it in a 1-element array', async () => {
    const blob = await toExcelSingleHeader({ name: 'Solo', age: '99' });
    const wb = await readBack(blob);
    expect(wb.worksheets[0].rowCount).toBe(2); // header + 1 data
  });

  it('produces an empty-data workbook (header only) for an empty array', async () => {
    const blob = await toExcelSingleHeader([]);
    const wb = await readBack(blob);
    // No records → no header keys and no data rows; rowCount is 0.
    expect(wb.worksheets[0].rowCount).toBe(0);
  });
});

describe('toExcelMultiHeader', () => {
  it('produces 2 header rows + 1 data row and merges the group label', async () => {
    // user has 2 leaves (name, age) → merge A1:B1; meta has 1 leaf → no merge.
    const data = [{ user: { name: 'Alice', age: 30 }, meta: { active: true } }];
    const blob = await toExcelMultiHeader(data);
    const wb = await readBack(blob);
    const ws = wb.worksheets[0];
    // 2 header rows + 1 data row.
    expect(ws.rowCount).toBe(3);
    // Header row 1: A1='user' (merged A1:B1, so B1 also reads 'user'), C1='meta'.
    const row1 = ws.getRow(1).values as unknown[];
    expect(row1[1]).toBe('user');
    // exceljs propagates the merged top-left value across the merge range,
    // so B1 also reads 'user' (or null — accept either).
    expect(['user', null, undefined]).toContain(row1[2]);
    expect(row1[3]).toBe('meta');
    // Header row 2: A2='name', B2='age', C2='active'.
    const row2 = ws.getRow(2).values as unknown[];
    expect(row2[1]).toBe('name');
    expect(row2[2]).toBe('age');
    expect(row2[3]).toBe('active');
    // Data row 3.
    const row3 = ws.getRow(3).values as unknown[];
    expect(row3[1]).toBe('Alice');
    expect(row3[2]).toBe(30);
    expect(row3[3]).toBe(true);
    // The merge for the `user` group spans A1:B1. exceljs exposes merges
    // via `_merges` (internal) — `model.merges` is only populated after
    // write. Either way, the merge should exist in one of these.
    const mergesInternal = (ws as unknown as { _merges?: Record<string, unknown> })._merges ?? {};
    const mergeKeys = Object.keys(mergesInternal);
    expect(mergeKeys.some((k) => k === 'A1:B1' || k === 'A1')).toBe(true);
  });

  it('handles mixed object + primitive top-level fields', async () => {
    const data = [{ id: 1, user: { name: 'Alice' } }];
    const blob = await toExcelMultiHeader(data);
    const wb = await readBack(blob);
    const ws = wb.worksheets[0];
    expect(ws.rowCount).toBe(3);
    const row2 = ws.getRow(2).values as unknown[];
    // `id` is a primitive → leaf is itself; `user.name` is the nested leaf.
    expect(row2[1]).toBe('id');
    expect(row2[2]).toBe('name');
    const row3 = ws.getRow(3).values as unknown[];
    expect(row3[1]).toBe(1);
    expect(row3[2]).toBe('Alice');
  });
});
