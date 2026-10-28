/**
 * 知识库 UI 共享常量与纯辅助（无 JSX、无 store 依赖）——
 * 侧栏 KnowledgePanel 与主区四页视图共用，避免各视图各写一份。
 */

import { isKbPath } from '@/services/knowledge/kbPaths';
import type { VaultEntry } from '@folyn/vault-provider';

export const BTN =
  'inline-flex shrink-0 items-center justify-center gap-1.5 min-h-[32px] px-3 py-1.5 rounded-md text-[12px] border border-brd bg-transparent text-t2 cursor-pointer motion-safe:transition-colors motion-safe:duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_PRIMARY =
  'inline-flex shrink-0 items-center justify-center gap-1.5 min-h-[32px] px-3.5 py-1.5 rounded-md text-[12px] border border-acc bg-acc text-white cursor-pointer motion-safe:transition-colors motion-safe:duration-[120ms] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';
export const INPUT =
  'w-full min-w-0 px-2.5 py-2 rounded-[5px] border border-brd bg-inp text-t1 text-[13px] outline-none font-ui transition-[border-color,box-shadow] duration-100 focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)]';

export interface TreeRow {
  path: string;
  name: string;
  type: 'file' | 'dir';
  depth: number;
}

/** 从 fileTree 摊平出可勾选行：目录 + 受支持的文件；`__kb__` 不展示。 */
export function buildRows(fileTree: VaultEntry[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (entries: VaultEntry[], depth: number) => {
    for (const e of entries) {
      if (isKbPath(e.path)) continue;
      rows.push({ path: e.path, name: e.name, type: e.type, depth });
      if (e.type === 'dir' && e.children) walk(e.children, depth + 1);
    }
  };
  walk(fileTree, 0);
  return rows;
}

/** 行是否被收录（自身在 scope，或被 scope 中的目录覆盖）。 */
export function isRowInScope(row: TreeRow, scope: string[]): boolean {
  if (scope.includes(row.path)) return true;
  return scope.some((p) => row.path.startsWith(`${p}/`));
}

/** 构建分项状态文案（buildItems → UI）。 */
export function buildStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return '待处理';
    case 'indexing': return '生成资料索引…';
    case 'synthesizing': return '合成主题页…';
    case 'done': return '完成';
    case 'skipped': return '跳过（内容未变化）';
    case 'error': return '失败';
    default: return status;
  }
}
