/**
 * 问答入口：BM25 索引加载（内存缓存）+ 检索循环端口接线 + 独立回答层。
 *
 * 检索与回答分层（ADR-0008）：runRetrievalLoop 只产出结构化证据，
 * 回答是第二次独立的模型调用，输入证据、输出自然语言答案。
 */

import type { KbFs } from './kbFs';
import { sha256Hex, readManifest, readNavigation, readReviews } from './kbFs';
import type { KbBm25Index, KbDoc } from './bm25Index';
import { buildBm25Index, bm25Search } from './bm25Index';
import type { KbEvidence, KbManifest } from './kbTypes';
import { kbChatText } from './kbLlm';
import { KB_ANSWER_PREAMBLE, KB_RETRIEVAL_PREAMBLE, kbAnswerPrompt } from './kbPrompts';
import { runRetrievalLoop, type RetrievalResult } from './retrievalLoop';
import i18n from '@/i18n';

// ── BM25 索引缓存（内存；构建后失效。磁盘缓存推迟到实测超预算，见 bm25Index）──

const cached = new Map<string, KbBm25Index>();
let cacheEpoch = 0;

/** 构建完成后调用，使下一次提问重建索引。 */
export function invalidateKbIndexCache(): void {
  cacheEpoch += 1;
  cached.clear();
}

async function loadDocs(fs: KbFs, manifest: KbManifest): Promise<KbDoc[]> {
  const docs: KbDoc[] = [];
  for (const [srcId, entry] of Object.entries(manifest.sources)) {
    if (entry.removed) continue; // 已停止跟踪，不进关键词索引
    let text = '';
    try {
      text = await fs.readFile(entry.path);
    } catch {
      continue; // 来源已移除，不进关键词索引
    }
    docs.push({
      id: srcId,
      kind: 'source',
      path: entry.path,
      title: entry.path.split('/').pop() ?? entry.path,
      text,
    });
  }
  for (const [tpId, entry] of Object.entries(manifest.topics)) {
    let text = '';
    try {
      text = await fs.readFile(entry.path);
    } catch {
      continue;
    }
    docs.push({ id: tpId, kind: 'topic', path: entry.path, title: entry.title, text });
  }
  return docs;
}

async function ensureIndex(fs: KbFs, vaultId: string, manifest: KbManifest): Promise<KbBm25Index> {
  const key = JSON.stringify([vaultId, fs.root ?? '__kb__']);
  const previous = cached.get(key);
  if (previous) return previous;
  const epoch = cacheEpoch;
  const docs = await loadDocs(fs, manifest);
  const index = buildBm25Index(docs);
  if (epoch === cacheEpoch) cached.set(key, index);
  return index;
}

function hash8(hash: string | undefined): string {
  return hash ? hash.slice(0, 8) : '';
}

export interface KbAskResult {
  answer: string;
  retrieval: RetrievalResult;
}

/** 会话轮次（运行时态，不落盘；切主题/切 Vault 由 store 重置）。 */
export interface KbAskTurn {
  question: string;
  answer: string;
  evidence: KbEvidence[];
  note?: string;
}

/** UI 可选接线：阶段文案 + 程序侧取消（轮边界生效，不丢已找到的证据）。 */
export interface KbAskOptions {
  onProgress?: (phase: string) => void;
  shouldCancel?: () => boolean;
  /** 此前会话轮次：注入回答层 prompt 作上下文；检索仍只按当前问题。 */
  priorTurns?: KbAskTurn[];
}

export async function askKnowledge(
  question: string,
  fs: KbFs,
  vaultId: string,
  opts: KbAskOptions = {},
): Promise<KbAskResult> {
  const manifest = await readManifest(fs);
  if (!manifest) throw new Error(i18n.t('knowledge:ask.notBuilt'));
  const language = manifest.language ?? 'auto';
  opts.onProgress?.(i18n.t('knowledge:ask.phase.loadIndex'));
  const nav = await readNavigation(fs);
  const index = await ensureIndex(fs, vaultId, manifest);

  const sourceBySrcId = manifest.sources;
  const topicByTpId = manifest.topics;
  const navByTpId = new Map(nav.topics.map((t) => [t.tpId, t]));
  // 切片 D：命中主题页若有待审阅修订，证据附状态说明（ADR-0006：审阅不阻断
  // 问答读取，但须说明该页有修订待审阅）。状态随证据进入回答层 prompt。
  const pendingReviewCount = new Map<string, number>();
  for (const r of await readReviews(fs)) {
    if (r.status !== 'pending') continue;
    pendingReviewCount.set(r.topicId, (pendingReviewCount.get(r.topicId) ?? 0) + 1);
  }

  const retrieval = await runRetrievalLoop(
    question,
    {
    askModel: (prompt) => kbChatText(prompt, KB_RETRIEVAL_PREAMBLE),
    listTopics: async () => {
      if (nav.topics.length === 0) return '（知识库暂无主题）';
      return nav.topics
        .map((t) => {
          const paths = t.sourceIds.map((id) => sourceBySrcId[id]?.path ?? id).join(', ');
          return `- ${t.tpId}「${t.title}」关联资料：${paths}`;
        })
        .join('\n');
    },
    openTopic: async (tpId: string) => {
      const entry = topicByTpId[tpId];
      if (!entry) return { observation: `未知主题 id：${tpId}`, evidence: null };
      let content: string;
      try {
        content = await fs.readFile(entry.path);
      } catch {
        return { observation: `主题页读取失败：${entry.path}`, evidence: null };
      }
      const related = (navByTpId.get(tpId)?.sourceIds ?? [])
        .map((id) => sourceBySrcId[id]?.path)
        .filter((p): p is string => !!p)
        .map((p) => `  - ${p}`)
        .join('\n');
      const observation = `「${entry.title}」(${entry.path}，关联资料：\n${related || '  无'})\n\n${content}`;
      const pending = pendingReviewCount.get(tpId) ?? 0;
      const evidence: KbEvidence = {
        kind: 'topic',
        path: entry.path,
        tpId,
        title: entry.title,
        versionHash: await sha256Hex(content),
        text: content,
        ...(pending > 0 ? { status: i18n.t('knowledge:ask.status.pendingReviews', { count: pending }) } : {}),
      };
      return { observation, evidence };
    },
    search: async (query: string) => {
      const hits = bm25Search(index, query, 8);
      if (hits.length === 0) return `无匹配结果（query: ${query}）`;
      return hits
        .map((h) => {
          const kind = h.doc.kind === 'source' ? '资料' : '主题';
          const version = h.doc.kind === 'source' ? sourceBySrcId[h.doc.id]?.currentHash : undefined;
          return `- [${h.doc.id}] ${h.doc.path}（${kind}，版本 ${hash8(version)}）score=${h.score.toFixed(1)}`;
        })
        .join('\n');
    },
    readSource: async (srcId: string, startLine?: number, endLine?: number) => {
      const entry = sourceBySrcId[srcId];
      if (!entry) return { observation: `未知资料 id：${srcId}`, evidence: null };
      if (entry.removed) {
        // 已停止跟踪（ADR-0007）：不再读当前文件，证据标记来源已移除；
        // 历史原文仍可经主题页引用核对。
        return {
          observation: `资料已停止跟踪（来源已移除）：${entry.path}`,
          evidence: {
            kind: 'source' as const,
            path: entry.path,
            srcId,
            title: entry.path.split('/').pop(),
            status: i18n.t('knowledge:ask.status.sourceRemoved'),
            text: '',
          },
        };
      }
      let content: string;
      try {
        content = await fs.readFile(entry.path);
      } catch {
        return {
          observation: `资料已移除或不可读：${entry.path}`,
          evidence: {
            kind: 'source' as const,
            path: entry.path,
            srcId,
            title: entry.path.split('/').pop(),
            status: i18n.t('knowledge:ask.status.sourceRemovedShort'),
            text: '',
          },
        };
      }
      const lines = content.split('\n');
      // 模型给的行号已过 parseRetrievalAction 的正整数校验，这里再夹到文件内；
      // 倒置范围（end < start）按缺省窗口处理，避免空片段/负行号进证据。
      const start = Math.max(1, Math.min(startLine ?? 1, lines.length));
      const end = Math.min(lines.length, endLine ?? Math.min(lines.length, start + 99));
      const safeEnd = end >= start ? end : Math.min(lines.length, start + 99);
      const text = lines.slice(start - 1, safeEnd).join('\n');
      const actualHash = await sha256Hex(content);
      const stale = actualHash !== entry.currentHash;
      const observation = `${entry.path} L${start}-L${safeEnd}（版本 ${hash8(entry.currentHash)}${stale ? '，当前文件与收录版本不一致' : ''}）\n${text}`;
      const evidence: KbEvidence = {
        kind: 'source',
        path: entry.path,
        srcId,
        title: entry.path.split('/').pop(),
        versionHash: entry.currentHash,
        startLine: start,
        endLine: safeEnd,
        text,
        ...(stale ? { status: i18n.t('knowledge:ask.status.staleVersion') } : {}),
      };
      return { observation, evidence };
    },
    },
    // 预算 + 程序侧取消（取消在轮边界生效；已找到的证据不丢）。
    {
      shouldCancel: opts.shouldCancel,
      onRound: (round) => opts.onProgress?.(i18n.t('knowledge:ask.phase.retrieving', { round })),
    },
  );

  // 用户停止检索：跳过回答层（避免停止后又发起一次模型调用），
  // 直接返回已找到的证据；UI 以 retrieval.note 说明已停止。
  if (retrieval.stoppedBy === 'cancelled') {
    return { answer: '', retrieval };
  }

  // 回答层：独立的第二次模型调用（不在 10 秒检索预算内）。
  // 会话上下文只进回答层；检索（上文 runRetrievalLoop）仍只按当前问题。
  opts.onProgress?.(i18n.t('knowledge:ask.phase.answering'));
  const evidenceBlocks = retrieval.evidence.map((e, i) => {
    const header =
      e.kind === 'topic'
        ? `### 证据 ${i + 1}【主题页】${e.title ?? ''} ${e.path}${e.versionHash ? ` 版本 ${hash8(e.versionHash)}` : ''}`
        : `### 证据 ${i + 1}【原文】${e.path}${e.versionHash ? ` 版本 ${hash8(e.versionHash)}` : ''}${e.startLine ? ` L${e.startLine}-L${e.endLine}` : ''}`;
    return [header, e.status ? `状态：${e.status}` : '', e.text].filter(Boolean).join('\n');
  });
  const history = (opts.priorTurns ?? [])
    .filter((t) => t.answer !== '') // 取消/失败轮次无回答文本，不注入
    .map((t) => ({ question: t.question, answer: t.answer }));
  const answer = await kbChatText(
    kbAnswerPrompt(question, evidenceBlocks.join('\n\n'), retrieval.note, history, language),
    KB_ANSWER_PREAMBLE,
  );
  return { answer, retrieval };
}
