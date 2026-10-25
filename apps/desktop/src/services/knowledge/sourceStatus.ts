/**
 * 资料单项状态派生（纯函数）——「资料」页状态列表的数据源。
 *
 * 状态从 `__kb__/` 真实文件（manifest / navigation / reviews）+ 当前构建会话的
 * buildItems 派生（ADR：处理失败跨会话丢失可接受，重试入口只对当前会话的失败项）。
 * 状态优先级：来源已移除 > 处理失败 > 处理中 > 有修订待审阅 > 已整理 > 可查原文；
 * 未收录/等待处理为「待处理」。
 */

export type KbSourceStatus =
  | 'pending' // 待处理（范围内未收录，或排队中）
  | 'processing' // 处理中（索引/合成进行中）
  | 'error' // 处理失败（当前构建会话）
  | 'removed' // 来源已移除（停止跟踪 / 移出收录范围 / 文件不存在）
  | 'review' // 有修订待审阅
  | 'organized' // 已整理（主题导航关联）
  | 'indexed'; // 可查原文（已收录、已建索引）

export interface KbSourceStatusItem {
  srcId: string | null;
  path: string;
  status: KbSourceStatus;
  /** 状态补充说明（失败原因 / 移除原因等）。 */
  message?: string;
}

export interface DeriveSourceStatusesInput {
  manifest: {
    scope: string[];
    sources: Record<string, { path: string; removed?: boolean }>;
  };
  /** 收录范围展开后的受支持文件（expandScope 的输出）。 */
  scopeFiles: string[];
  /** 主题导航（已整理判定：srcId 出现在某主题的 sourceIds）。 */
  navigation: { sourceIds: string[] }[];
  /** 待审阅修订（refs 指向的 srcId 视为「有修订待审阅」）。 */
  reviews: { refs?: { srcId: string }[] }[];
  /** 当前构建会话的分项进度。 */
  buildItems: { path: string; status: string; message?: string }[];
}

export function deriveSourceStatuses(input: DeriveSourceStatusesInput): KbSourceStatusItem[] {
  const { manifest, scopeFiles, navigation, reviews, buildItems } = input;
  const entryByPath = new Map<string, { srcId: string; removed?: boolean }>();
  for (const [srcId, entry] of Object.entries(manifest.sources)) {
    entryByPath.set(entry.path, { srcId, removed: entry.removed });
  }
  const buildByPath = new Map(buildItems.map((i) => [i.path, i]));
  const navSrcIds = new Set(navigation.flatMap((t) => t.sourceIds));
  const reviewSrcIds = new Set(
    reviews.flatMap((r) => (r.refs ?? []).map((x) => x.srcId)),
  );

  const rows: KbSourceStatusItem[] = [];
  const seen = new Set<string>();
  for (const path of scopeFiles) {
    seen.add(path);
    rows.push(rowFor(path, entryByPath.get(path), buildByPath.get(path), navSrcIds, reviewSrcIds));
  }
  // 不在当前范围/树内的 manifest 资料也要列出（移出范围 / 被删除 → 来源已移除）。
  for (const [srcId, entry] of Object.entries(manifest.sources)) {
    if (seen.has(entry.path)) continue;
    rows.push({
      srcId,
      path: entry.path,
      status: 'removed',
      message: entry.removed ? '已停止跟踪（保留知识与历史引用）' : '已移出收录范围或文件已删除',
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

function rowFor(
  path: string,
  entry: { srcId: string; removed?: boolean } | undefined,
  build: { status: string; message?: string } | undefined,
  navSrcIds: Set<string>,
  reviewSrcIds: Set<string>,
): KbSourceStatusItem {
  const srcId = entry?.srcId ?? null;
  if (entry?.removed) {
    return { srcId, path, status: 'removed', message: '已停止跟踪（保留知识与历史引用）' };
  }
  if (build?.status === 'error') {
    return { srcId, path, status: 'error', message: build.message };
  }
  if (build?.status === 'indexing' || build?.status === 'synthesizing') {
    return { srcId, path, status: 'processing' };
  }
  if (!entry) {
    return { srcId, path, status: 'pending', message: build ? undefined : '范围内新资料，待收录' };
  }
  if (srcId && reviewSrcIds.has(srcId)) {
    return { srcId, path, status: 'review' };
  }
  if (srcId && navSrcIds.has(srcId)) {
    return { srcId, path, status: 'organized' };
  }
  return { srcId, path, status: 'indexed' };
}

export function sourceStatusLabel(status: KbSourceStatus): string {
  switch (status) {
    case 'pending': return '待处理';
    case 'processing': return '处理中';
    case 'error': return '处理失败';
    case 'removed': return '来源已移除';
    case 'review': return '有修订待审阅';
    case 'organized': return '已整理';
    case 'indexed': return '可查原文';
  }
}
