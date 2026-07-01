// 学习计划进度衍生计算（纯函数，便于单测）。
// PR6：计划区顶部"总体进度"与单元卡片进度条共用同一计算口径。

import type { StudyUnit } from './types';

/** 计划进度汇总。 */
export interface PlanProgress {
  /** 单元总数 */
  total: number;
  /** 已完成单元数（done === true） */
  done: number;
  /** 完成百分比 0-100（无单元时为 0） */
  percent: number;
}

/**
 * 汇总学习单元的完成进度。
 * 纯函数：不依赖 React，可在组件外（useMemo / 单测）调用。
 */
export function computePlanProgress(units: StudyUnit[]): PlanProgress {
  const total = units.length;
  const done = units.filter((u) => u.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}
