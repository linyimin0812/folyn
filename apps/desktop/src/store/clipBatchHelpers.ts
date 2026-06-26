/**
 * Batch clipping helpers extracted from clipStore to keep the store file
 * focused on state transitions. All batch pure logic + the summary writer
 * live here; the store actions (`clipBatch`/`cancelBatch`/`clearBatch`)
 * call into these.
 */
import { useVaultStore } from './vaultStore';
import { normalizeUrl } from '@/utils/urlUtils';

/** Status of a single URL within a batch clip run. */
export type BatchItemStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'cancelled';

/** A single URL entry in a batch clip run, with its current status. */
export interface BatchItem {
  url: string;
  status: BatchItemStatus;
  /** Path of the saved/overwritten clip (only set on success). */
  clipPath?: string;
  /** Error message (only set on failure). */
  error?: string;
  /** Human-readable reason for being skipped/cancelled. */
  reason?: string;
}

export interface BatchOptions {
  force?: boolean;
  delayMs?: number;
}

export interface BatchSummary {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  /** Path to the generated summary markdown file. */
  summaryPath?: string;
}

const STATUS_LABEL: Record<BatchItemStatus, string> = {
  pending: '待处理',
  running: '运行中',
  done: '成功',
  skipped: '已跳过',
  failed: '失败',
  cancelled: '已取消',
};

/** Lightweight http(s) URL validation (mirrors clipService.validateUrl). */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Pure helper: normalize + dedupe + validate a raw URL list into BatchItems.
 *
 * - Empty lines and whitespace are ignored.
 * - URLs are normalized via `normalizeUrl` for dedupe comparison.
 * - Within-batch duplicates: the first occurrence stays `pending`; later
 *   occurrences are marked `skipped` with reason "批量内重复".
 * - Invalid URLs (not http/https, unparseable) are marked `failed` with
 *   reason "无效的网址".
 */
export function prepareBatchUrls(rawUrls: string[]): BatchItem[] {
  const seen = new Set<string>();
  const items: BatchItem[] = [];

  for (const raw of rawUrls) {
    const url = raw.trim();
    if (!url) continue;

    const normalized = normalizeUrl(url);

    if (!isValidHttpUrl(url)) {
      items.push({ url, status: 'failed', reason: '无效的网址' });
      continue;
    }

    if (seen.has(normalized)) {
      items.push({ url, status: 'skipped', reason: '批量内重复' });
      continue;
    }
    seen.add(normalized);
    items.push({ url, status: 'pending' });
  }

  return items;
}

/** Cancellation-aware delay: resolves after `ms`, or rejects if cancelled. */
export function cancellableSleep(
  ms: number,
  isCancelled: () => boolean,
): Promise<void> {
  if (ms <= 0) {
    if (isCancelled()) return Promise.reject(new Error('cancelled'));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (isCancelled()) reject(new Error('cancelled'));
      else resolve();
    }, ms);
    // The loop checks the flag between iterations, which is sufficient; the
    // timer is short-lived and clears itself on fire.
    void timer;
  });
}

/**
 * Write a batch summary markdown file to `__clips__/batch-<YYYY-MM-DD>.md`.
 * Lists each URL with its final status and a link to the clip path / source.
 * Returns the path of the written file. Non-fatal if the write fails.
 */
export async function writeBatchSummary(items: BatchItem[]): Promise<string> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  const date = new Date().toISOString().split('T')[0];
  const summaryPath = `__clips__/batch-${date}.md`;

  const done = items.filter((i) => i.status === 'done').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const cancelled = items.filter((i) => i.status === 'cancelled').length;

  const rows = items.map((item) => {
    const label = STATUS_LABEL[item.status];
    const link = item.clipPath
      ? `[${item.clipPath.split('/').pop()}](${item.clipPath})`
      : `[来源](${item.url})`;
    const note = item.error
      ? ` — ${item.error}`
      : item.reason
        ? ` — ${item.reason}`
        : '';
    return `- ${label} — ${link}${note}`;
  });

  const content = [
    '---',
    `title: "批量剪藏汇总 ${date}"`,
    'type: batch',
    `date: ${date}`,
    `total: ${items.length}`,
    `done: ${done}`,
    `skipped: ${skipped}`,
    `failed: ${failed}`,
    `cancelled: ${cancelled}`,
    '---',
    '',
    `# 批量剪藏汇总 (${date})`,
    '',
    `共 ${items.length} 条：成功 ${done}，已跳过 ${skipped}，失败 ${failed}，已取消 ${cancelled}。`,
    '',
    ...rows,
    '',
  ].join('\n');

  // createFile overwrites if the file already exists (same-day re-run).
  await vault.createFile(summaryPath, content);
  await vault.refreshFileTree();
  return summaryPath;
}
