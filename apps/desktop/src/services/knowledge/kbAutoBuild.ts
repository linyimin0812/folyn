/**
 * 知识库自动收录（切片 B）：收录范围内的文件新增/修改 → 去抖 → 增量构建。
 *
 * - 订阅 fileWatcher 的 vault 变更（已过 pause / suppressWatcherFor 过滤，
 *   程序自身写入被 suppress 或落在 `__kb__/`（isKbPath）都不会触发 ——
 *   双保险防自触发循环）。
 * - 过滤：受支持的扩展名 + 在收录范围内（含目录覆盖），否则忽略。
 * - 去抖 1.5s 聚合批量变更，然后 `knowledgeStore.build(only)` —— 分项发布
 *   进度/「处理中」状态沿用资料页 UI；构建期间到达的事件丢弃（下个变更
 *   或手动「更新」补），不排队。
 * - 开关 kbAutoBuild 在 aiConfigStore（随 settings 持久化，默认开）。
 * - 生命周期：KnowledgePanel 挂载 / 切 Vault 时 start，卸载时 stop ——
 *   只在面板激活时监听，避免后台静默跑模型。
 */

import { subscribeVaultChanges } from '@/utils/fileWatcher';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { isKbPath } from './kbPaths';
import { isSupportedSourcePath } from './knowledgeBuild';

const DEBOUNCE_MS = 1500;

let unsubscribe: (() => void) | null = null;
let unsubscribeState: (() => void) | null = null;
let selectionEpoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = new Set<string>();

function inScope(path: string, scope: string[]): boolean {
  return scope.includes(path) || scope.some((p) => path.startsWith(`${p}/`));
}

function onVaultChanges(paths: string[]): void {
  const { scope, buildRunning, activeThemeId } = useKnowledgeStore.getState();
  if (buildRunning || !activeThemeId) return; // 构建中的变更由该轮构建自身覆盖，不叠加触发
  for (const p of paths) {
    if (isKbPath(p) || !isSupportedSourcePath(p) || !inScope(p, scope)) continue;
    pending.add(p);
  }
  if (pending.size === 0) return;
  if (timer) clearTimeout(timer);
  const epoch = selectionEpoch;
  timer = setTimeout(() => {
    if (epoch !== selectionEpoch) return;
    timer = null;
    const paths = [...pending];
    pending = new Set();
    if (!useAiConfigStore.getState().kbAutoBuild) return;
    const kb = useKnowledgeStore.getState();
    if (kb.buildRunning || paths.length === 0) return;
    console.info(`[kb] 收录范围内 ${paths.length} 个文件变更，自动增量收录`);
    void kb.build(paths);
  }, DEBOUNCE_MS);
}

/** 侧栏 knowledge 面板挂载 / Vault 打开时调用。幂等。 */
export function startKbAutoBuild(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeVaultChanges(onVaultChanges);
  unsubscribeState = useKnowledgeStore.subscribe((next, previous) => {
    if (next.activeThemeId === previous.activeThemeId && next.contextVaultId === previous.contextVaultId) return;
    selectionEpoch += 1;
    if (timer) clearTimeout(timer);
    timer = null; pending.clear();
  });
}

/** 面板卸载 / 切 Vault 时调用：退订 + 清掉未触发的去抖。 */
export function stopKbAutoBuild(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeState?.(); unsubscribeState = null; selectionEpoch += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = new Set();
}
