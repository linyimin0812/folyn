// 看板列查询 helper：集中从 settings 读取列定义、列名、列色、完成列 id。
// 组件用 useBoardColumns()（订阅），非组件上下文用 getXxx()（读快照）。

import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_BOARD_COLUMNS, type BoardColumnDef } from './types';

/** 读取当前看板列定义（快照）。 */
export function getBoardColumns(): BoardColumnDef[] {
  const cols = useSettingsStore.getState().boardColumns;
  return cols && cols.length ? cols : DEFAULT_BOARD_COLUMNS;
}

/** 完成列 id（isDone 标记的列）；可能不存在。 */
export function getDoneColumnId(): string | undefined {
  return getBoardColumns().find((c) => c.isDone)?.id;
}

/** 列名查询（找不到返回 id 本身）。 */
export function getColumnLabel(id: string): string {
  return getBoardColumns().find((c) => c.id === id)?.name ?? id;
}

/** 列色查询（找不到返回中性色）。 */
export function getColumnColor(id: string): string {
  return getBoardColumns().find((c) => c.id === id)?.color ?? 'var(--t3)';
}

/** 组件订阅 hook：返回 { columns, doneId, labelOf, colorOf }。 */
export function useBoardColumns() {
  const columns = useSettingsStore((s) => s.boardColumns) ?? DEFAULT_BOARD_COLUMNS;
  const doneId = columns.find((c) => c.isDone)?.id;
  const labelOf = (id: string) => columns.find((c) => c.id === id)?.name ?? id;
  const colorOf = (id: string) => columns.find((c) => c.id === id)?.color ?? 'var(--t3)';
  return { columns, doneId, labelOf, colorOf };
}
