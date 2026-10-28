/**
 * 引用核验（ADR-0007「人工改写后的引用核验」）。
 *
 * 模型读该引用的原文版本快照对应行范围 + 知识页段落现文本，判断原文是否
 * 支持现说法；状态流转 unverified → verified / unsupported。unsupported 只
 * 提示问题（琥珀），保留正文 —— 改写仍须审阅（ADR-0006）。
 * 来源已移除（停止跟踪）的引用不提供核验：历史原文仍可人工核对，但不由
 * 模型对已移除来源跑核验。
 */

import { errText } from '@/utils/errText';
import type { KbFs } from './kbFs';
import { readManifest, readTopicRefs, writeTopicRefs, sha256Hex } from './kbFs';
import { kbSourceSnapshotPath, kbTopicRefsPath } from './kbPaths';
import { kbChatJson } from './kbLlm';
import { KB_VERIFY_PREAMBLE, kbVerifyPrompt } from './kbPrompts';
import type { KbRef } from './kbTypes';

export type VerifyOutcome =
  | { ok: true; supported: boolean; reason: string }
  | {
      ok: false;
      reason: 'source-removed' | 'snapshot-missing' | 'paragraph-missing' | 'error';
      message: string;
    };

interface VerifyVerdict {
  supported: boolean;
  reason: string;
}

function narrowVerdict(v: unknown): VerifyVerdict | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o['supported'] !== 'boolean') return null;
  const reason = typeof o['reason'] === 'string' ? o['reason'].trim() : '';
  return { supported: o['supported'], reason: reason || '（模型未给出理由）' };
}

/** 正文里含 `[^cN]` 标记（非定义行）的段落文本。 */
function claimParagraph(page: string, refId: string): string | null {
  const re = new RegExp(`\\[\\^${refId}\\](?!:)`);
  const line = page.split('\n').find((l) => re.test(l));
  if (!line) return null;
  return line.replace(/\[\^c\d+\]/g, '').replace(/^[-*]\s*/, '').trim();
}

async function suppressWatcher(path: string): Promise<void> {
  try {
    const { suppressWatcherFor } = await import('@/utils/fileWatcher');
    suppressWatcherFor(path);
  } catch {
    // 测试/非 Tauri 环境无监听，忽略
  }
}

export async function verifyTopicRef(
  fs: KbFs,
  ref: KbRef,
  topicPath: string,
): Promise<VerifyOutcome> {
  try {
    const manifest = await readManifest(fs);
    const entry = manifest?.sources[ref.srcId];
    if (!manifest || !entry || entry.removed) {
      return {
        ok: false,
        reason: 'source-removed',
        message: '来源已移除（已停止跟踪），不做核验；历史原文仍可在引用面板人工核对。',
      };
    }

    // 原文：优先引用时版本快照（ADR-0007）；快照缺失且当前收录版本与引用时
    // 一致时可用当前文件，否则如实失败。
    let lines: string[];
    try {
      lines = (await fs.readFile(kbSourceSnapshotPath(ref.srcId, ref.versionHash, fs.root))).split('\n');
    } catch {
      if (entry.currentHash !== ref.versionHash) {
        return {
          ok: false,
          reason: 'snapshot-missing',
          message: '引用时版本的原文快照缺失，且当前资料版本与引用时不一致，无法核验。',
        };
      }
      try {
        const content = await fs.readFile(entry.path);
        // manifest 侧一致 ≠ 磁盘内容一致（自动收录关闭时文件可能已漂移）：
        // hash 复核不过就如实失败，不用错版原文下核验结论。
        if ((await sha256Hex(content)) !== ref.versionHash) {
          return {
            ok: false,
            reason: 'snapshot-missing',
            message: '引用时版本的原文快照缺失，当前文件内容与引用时不一致，无法核验。',
          };
        }
        lines = content.split('\n');
      } catch {
        return {
          ok: false,
          reason: 'snapshot-missing',
          message: '引用时版本的原文快照缺失，当前原文也不可读。',
        };
      }
    }
    const start = Math.max(1, Math.min(ref.startLine, lines.length));
    const end = Math.max(start, Math.min(ref.endLine, lines.length));
    const excerpt = lines.slice(start - 1, end).join('\n');

    const page = await fs.readFile(topicPath).catch(() => null);
    if (page === null) {
      return { ok: false, reason: 'paragraph-missing', message: `主题页读取失败：${topicPath}` };
    }
    const claim = claimParagraph(page, ref.id);
    if (claim === null || claim === '') {
      return {
        ok: false,
        reason: 'paragraph-missing',
        message: '正文中已找不到该引用标注的段落（内容可能已被删除）。',
      };
    }

    const verdict = narrowVerdict(
      await kbChatJson(kbVerifyPrompt(claim, ref.anchorText, excerpt), KB_VERIFY_PREAMBLE),
    );
    if (!verdict) {
      return { ok: false, reason: 'error', message: '模型未返回有效的核验结果。' };
    }

    // 状态落盘（只动这一条 ref）。
    const refs = await readTopicRefs(fs, ref.topicId);
    const idx = refs.findIndex((r) => r.id === ref.id && r.srcId === ref.srcId);
    if (idx >= 0) {
      refs[idx] = {
        ...refs[idx]!,
        status: verdict.supported ? 'verified' : 'unsupported',
        verifyNote: verdict.reason,
      };
      await suppressWatcher(kbTopicRefsPath(ref.topicId, fs.root));
      await writeTopicRefs(fs, ref.topicId, refs);
    }
    return { ok: true, supported: verdict.supported, reason: verdict.reason };
  } catch (err) {
    return { ok: false, reason: 'error', message: errText(err) };
  }
}
