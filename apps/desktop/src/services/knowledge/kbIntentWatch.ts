/**
 * 人工删除意图识别 + 引用待核验标记（切片 C，ADR-0006 / ADR-0007）。
 *
 * - 订阅 fileWatcher 的 vault 变更，只关心 `__kb__/topics/<tpId>.md`。
 *   程序自身写入已由 suppressWatcherFor 排除（topicSynth / kbReviewActions
 *   写页面前都调用）；到达这里的就是用户编辑。
 * - 用户编辑知识页 → 与 manifest 的 lastProgramHash 比对 → 逐条检查该页
 *   refs：正文引用标记消失且锚文本/结论句不再出现 → 记删除意图 +
 *   ref 标 'deleted'；标记还在但段落文本 ≠ refs 存的结论句 → 标
 *   'unverified'（引用待核验：保留关联，待重新检查）。
 * - 用户编辑后的 hash 成为新的程序基线（ADR-0006：不能覆盖用户已经
 *   编辑的新版本 —— 后续自动追加以合并方式保留用户正文）。
 * - 生命周期与 kbAutoBuild 一致：KnowledgePanel 挂载时 start，卸载时 stop。
 * - ADR-0011 后主题页存 `~/.folyn/`（vault 之外）：vault watcher 看不到 KB
 *   文件变更，本订阅对迁移后的生成物不再触发（保留接线无害；页内编辑
 *   保存本就走 suppressWatcherFor，语义不变）。
 */

import { subscribeVaultChanges } from '@/utils/fileWatcher';
import { activeThemeFs, useKnowledgeStore } from '@/store/knowledgeStore';
import type { KbFs } from './kbFs';
import {
  readManifest,
  writeManifest,
  readTopicRefs,
  writeTopicRefs,
  sha256Hex,
} from './kbFs';
import { kbDeletionsPath, kbManifestPath, kbTopicRefsPath } from './kbPaths';
import { appendDeletions, makeDeletionIntent, normAnchor } from './kbDeletions';
import { parseTopicPage } from './topicSynth';
import type { KbDeletionIntent, KbRef } from './kbTypes';

// ── 纯逻辑：从编辑后的正文推导各引用的意图变化 ───────────────────────────────

/** 页内引用标记（非定义行）：`[^cN]` 后面不跟冒号。 */
function markerRe(id: string): RegExp {
  return new RegExp(`\\[\\^${id}\\](?!:)`);
}

/** 段落行去掉引用标记与列表符号后的纯文本。 */
function paragraphText(line: string): string {
  return line.replace(/\[\^c\d+\]/g, '').replace(/^[-*]\s*/, '').trim();
}

export interface TopicEditIntents {
  /** 新记录的删除意图（写入 deletions.json）。 */
  deletions: KbDeletionIntent[];
  /** 需要更新状态的引用（写回 refs.json）。 */
  updates: { ref: KbRef; status: KbRef['status'] }[];
}

/**
 * @param body 主题页正文（parseTopicPage().body，含页脚脚注定义行）。
 * 判定规则（ADR-0006 删除意图 / ADR-0007 引用待核验）：
 * - 标记在、段落文本与 refs 记录的结论句一致 → 不变（或从 unverified 恢复 active）；
 * - 标记在、段落文本变了 → 'unverified'（人工改写带引用的结论，保留关联）；
 * - 标记没了、锚文本（脚注定义）与结论句也不在了 → 删除意图 + 'deleted'；
 * - 标记没了但内容还在（只删了标记/脚注）→ 'unverified'（关联状态不明，待核）。
 */
export function deriveTopicEditIntents(
  body: string,
  refs: KbRef[],
  now: number,
): TopicEditIntents {
  const lines = body.split('\n');
  const deletions: KbDeletionIntent[] = [];
  const updates: { ref: KbRef; status: KbRef['status'] }[] = [];
  for (const ref of refs) {
    if (ref.status === 'source-removed') continue; // 来源跟踪状态，另一条轴线
    const re = markerRe(ref.id);
    const markerLine = lines.find((l) => re.test(l));
    if (markerLine !== undefined) {
      if (!ref.claimText) continue; // 旧记录无结论句基线，无法比对（schema 兼容）
      if (ref.status === 'deleted') continue; // 手工把内容贴回来的极端情形：意图保留，不动
      const same = normAnchor(paragraphText(markerLine)) === normAnchor(ref.claimText);
      if (!same && ref.status !== 'unverified') {
        updates.push({ ref, status: 'unverified' });
      } else if (same && ref.status === 'unverified') {
        // 段落改回与程序写入时一致 → 待核验状态解除。
        updates.push({ ref, status: 'active' });
      }
      continue;
    }
    const defLine = lines.find((l) => l.trim().startsWith(`[^${ref.id}]:`));
    const anchorGone =
      defLine === undefined || !normAnchor(defLine).includes(normAnchor(ref.anchorText));
    const claimText = ref.claimText;
    const claimGone =
      !claimText || !lines.some((l) => normAnchor(l).includes(normAnchor(claimText)));
    if (anchorGone && claimGone) {
      deletions.push(makeDeletionIntent(ref, now));
      updates.push({ ref, status: 'deleted' });
    } else if (ref.status !== 'deleted') {
      updates.push({ ref, status: 'unverified' });
    }
  }
  return { deletions, updates };
}

// ── 落盘：一次用户编辑的完整对账 ─────────────────────────────────────────────

export interface ReconcileTopicEditResult {
  /** 是否产生了 refs/deletions 变化（决定 UI 是否刷新）。 */
  changed: boolean;
  deletions: number;
  unverified: number;
  note?: string;
}

async function suppressWatcher(path: string): Promise<void> {
  try {
    const { suppressWatcherFor } = await import('@/utils/fileWatcher');
    suppressWatcherFor(path);
  } catch {
    // 测试/非 Tauri 环境无监听，忽略
  }
}

/**
 * 对一个被用户编辑的主题页跑意图对账：读新内容 → 比对 lastProgramHash →
 * 推导 refs 变化 → 写 refs.json / deletions.json / manifest（新基线 hash）。
 * 页面未被编辑（hash 与基线一致）时无操作。
 */
export async function reconcileTopicEdit(
  fs: KbFs,
  pagePath: string,
): Promise<ReconcileTopicEditResult> {
  const manifest = await readManifest(fs);
  if (!manifest) return { changed: false, deletions: 0, unverified: 0, note: 'manifest 缺失' };
  const tpId = Object.keys(manifest.topics).find((id) => manifest.topics[id]!.path === pagePath);
  if (!tpId) return { changed: false, deletions: 0, unverified: 0, note: '未登记的主题页' };
  const entry = manifest.topics[tpId]!;
  const content = await fs.readFile(pagePath).catch(() => null);
  if (content === null) {
    return { changed: false, deletions: 0, unverified: 0, note: `主题页读取失败：${pagePath}` };
  }
  const hash = await sha256Hex(content);
  if (entry.lastProgramHash === hash) {
    // 程序写入漏网（suppress 失效等）或内容未变 —— 无用户编辑。
    return { changed: false, deletions: 0, unverified: 0 };
  }

  const refs = await readTopicRefs(fs, tpId);
  const intents = deriveTopicEditIntents(parseTopicPage(content).body, refs, Date.now());

  if (intents.updates.length > 0) {
    const updated = refs.map((r) => {
      const u = intents.updates.find((x) => x.ref === r);
      return u ? { ...r, status: u.status } : r;
    });
    await suppressWatcher(kbTopicRefsPath(tpId, fs.root));
    await writeTopicRefs(fs, tpId, updated);
  }
  if (intents.deletions.length > 0) {
    await suppressWatcher(kbDeletionsPath(fs.root));
    await appendDeletions(fs, intents.deletions);
  }
  // 用户编辑成为新的程序基线（ADR-0006）。
  entry.lastProgramHash = hash;
  await suppressWatcher(kbManifestPath(fs.root));
  await writeManifest(fs, manifest);

  const unverified = intents.updates.filter((u) => u.status === 'unverified').length;
  console.info(
    `[kb] 主题页人工编辑对账: ${pagePath} 删除意图 ${intents.deletions.length} 条，待核验 ${unverified} 条`,
  );
  return { changed: intents.updates.length > 0, deletions: intents.deletions.length, unverified };
}

// ── 监听接线 ─────────────────────────────────────────────────────────────────


const DEBOUNCE_MS = 1000;

let unsubscribe: (() => void) | null = null;
let unsubscribeState: (() => void) | null = null;
let selectionEpoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = new Set<string>();

function onVaultChanges(paths: string[]): void {
  if (useKnowledgeStore.getState().buildRunning || !useKnowledgeStore.getState().activeThemeId) return; // 构建期间的页写入由构建自身管理
  let fs: KbFs;
  try { fs = activeThemeFs(); } catch { return; }
  const prefix = `${fs.root}/topics/`;
  for (const p of paths) {
    if (p.startsWith(prefix) && /^[^/]+\.md$/.test(p.slice(prefix.length))) pending.add(p);
  }
  if (pending.size === 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(fire, DEBOUNCE_MS);
}

function fire(): void {
  timer = null;
  if ((useKnowledgeStore.getState().buildRunning || useKnowledgeStore.getState().mutationRunning)) {
    // 去抖窗口内开始的构建：推迟对账 —— 对账与构建都写 manifest/refs，
    // 并发写会互相覆盖（对账基于构建前的 manifest 落盘会丢构建成果）。
    // 构建结束后下一轮 fire 再处理；pending 不清空。
    timer = setTimeout(fire, DEBOUNCE_MS);
    return;
  }
  const paths = [...pending];
  pending = new Set();
  void useKnowledgeStore.getState().reconcileTopicEdits(paths);
}

/** 侧栏 knowledge 面板挂载 / Vault 打开时调用。幂等。 */
export function startKbIntentWatch(): void {
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
export function stopKbIntentWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeState?.(); unsubscribeState = null; selectionEpoch += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = new Set();
}
