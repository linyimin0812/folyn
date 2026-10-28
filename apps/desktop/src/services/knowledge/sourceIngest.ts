/**
 * 资料收录：读文件 → hash → 模型提索引节点 → 程序校验行范围 → 写 index.json。
 *
 * 长文按行边界分块多次调用模型（每块返回自己的 nodes，行号为绝对行号），程序合并。
 * 块级并行：单份资料内的索引块 LLM 调用受限并发（结果按块序合并，语义不变）。
 * 校验失败的节点丢弃并 console.warn（prd「程序校验」）。
 */

import type { KbFs } from './kbFs';
import { sha256Hex, writeSourceIndex, readSourceIndex } from './kbFs';
import type { KbIndexNode, KbManifest, KbSourceIndex } from './kbTypes';
import { kbChatJson } from './kbLlm';
import { KB_INDEX_PREAMBLE, kbIndexPrompt } from './kbPrompts';

/** 单份资料内索引块 / 合成块的 LLM 调用并发上限。 */
export const KB_CHUNK_CONCURRENCY = 3;

/**
 * 并行构建的协作取消信号：块循环边界抛出（在途模型调用不可中断，文档化上限）。
 * 调用方（knowledgeBuild）捕获后把该项留在 pending（已发布部分保留），不标 error。
 */
export class KbBuildCancelled extends Error {
  constructor() {
    super('已取消');
    this.name = 'KbBuildCancelled';
  }
}

/** 受限并发映射：结果与输入同序（并行不改变合并次序）；任一失败整体 reject。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

/** 按行边界切块。返回 { text, firstLine }（firstLine 为 1-based 绝对行号）。 */
export function chunkContent(content: string, maxChars = 9000): { text: string; firstLine: number }[] {
  const lines = content.split('\n');
  if (content.length <= maxChars) return [{ text: content, firstLine: 1 }];
  const chunks: { text: string; firstLine: number }[] = [];
  let current: string[] = [];
  let currentFirst = 1;
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (size > 0 && size + line.length + 1 > maxChars) {
      chunks.push({ text: current.join('\n'), firstLine: currentFirst });
      current = [];
      currentFirst = i + 1;
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push({ text: current.join('\n'), firstLine: currentFirst });
  return chunks;
}

function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** 收录/合成过程的进度上报（详细过程区展示；均为可选，不影响返回值）。 */
export interface KbProcessHooks {
  /** 阶段事实行（真实数据行，如「索引块 1/3（第 1–120 行）」）。 */
  onDetail?: (line: string) => void;
  /** 当前处理项的模型正文流增量。 */
  onStream?: (text: string) => void;
  /** 协作取消：块循环边界检查，返回 true 时抛 KbBuildCancelled。 */
  shouldCancel?: () => boolean;
}

/** detail 行：分块进度（名词 + 序号 + 绝对行范围）。 */
export function chunkPhaseDetailLine(noun: string, index: number, total: number, firstLine: number, lastLine: number): string {
  return `${noun} ${index}/${total}（第 ${firstLine}–${lastLine} 行）`;
}

/** detail 行：模型返回与程序校验保留的节点数。 */
export function indexNodesDetailLine(returned: number, kept: number): string {
  return `模型返回 ${returned} 个节点，校验保留 ${kept} 个`;
}

/**
 * 校验模型输出的索引节点：类型收窄 + 1<=start<=end<=lineCount + 排序去重叠。
 * 无效或与已保留节点重叠的节点丢弃（console.warn 记录）。
 */
export function validateIndexNodes(nodes: unknown, lineCount: number): KbIndexNode[] {
  if (!Array.isArray(nodes)) return [];
  const valid: KbIndexNode[] = [];
  for (const raw of nodes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const n = raw as Record<string, unknown>;
    const title = typeof n['title'] === 'string' ? n['title'].trim() : '';
    const summary = typeof n['summary'] === 'string' ? n['summary'].trim() : '';
    const { startLine, endLine } = n;
    if (!title || !isPosInt(startLine) || !isPosInt(endLine) || endLine < startLine) {
      console.warn('[kb] 丢弃非法索引节点:', JSON.stringify(raw));
      continue;
    }
    if (endLine > lineCount) {
      console.warn(`[kb] 丢弃越界索引节点 (endLine=${endLine} > ${lineCount}):`, title);
      continue;
    }
    valid.push({ title, summary, startLine, endLine });
  }
  valid.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const kept: KbIndexNode[] = [];
  for (const node of valid) {
    const prev = kept[kept.length - 1];
    if (prev && node.startLine <= prev.endLine) {
      console.warn(`[kb] 丢弃重叠索引节点: ${node.title} (L${node.startLine} 与 L${prev.startLine}-L${prev.endLine} 重叠)`);
      continue;
    }
    kept.push(node);
  }
  return kept;
}

/** 索引节点摘要（供主题合成 prompt 使用）。 */
export function buildIndexSummary(nodes: KbIndexNode[]): string {
  return nodes
    .map((n) => `- L${n.startLine}-L${n.endLine} ${n.title}：${n.summary}`)
    .join('\n');
}

export interface IngestSourceResult {
  srcId: string;
  versionHash: string;
  /** true = hash 未变且索引已在，未调用模型。 */
  skipped: boolean;
  nodes: KbIndexNode[];
}

/**
 * 收录一份资料：生成/复用索引。manifest 的 sources 登记由调用方
 * （knowledgeBuild）在分项发布时写入。
 * 版本快照不在此写（ADR-0007：只保留曾被引用的版本）——topicSynth 在
 * 引用实际落盘时写入 `sources/<srcId>/<hash>.md`。
 */
export async function ingestSource(
  fs: KbFs,
  srcId: string,
  path: string,
  manifest: KbManifest,
  hooks?: KbProcessHooks,
): Promise<IngestSourceResult> {
  const content = await fs.readFile(path);
  const versionHash = await sha256Hex(content);
  const lineCount = content.split('\n').length;

  const existing = manifest.sources[srcId];
  const existingIndex = existing ? await readSourceIndex(fs, srcId) : null;
  if (existing && existingIndex && existing.currentHash === versionHash) {
    hooks?.onDetail?.(`内容未变化，复用既有索引（${existingIndex.nodes.length} 个节点）`);
    return { srcId, versionHash, skipped: true, nodes: existingIndex.nodes };
  }

  // 块级并行：LLM 调用受限并发；结果按块序合并（validateIndexNodes 兼做
  // 排序 + 跨块去重叠，与串行版一致）。
  const chunks = chunkContent(content);
  const chunkNodes = await mapWithConcurrency(chunks, KB_CHUNK_CONCURRENCY, (chunk, i) => {
    if (hooks?.shouldCancel?.()) throw new KbBuildCancelled();
    hooks?.onDetail?.(chunkPhaseDetailLine('索引块', i + 1, chunks.length, chunk.firstLine, chunk.firstLine + chunk.text.split('\n').length - 1));
    return kbChatJson<{ nodes?: unknown }>(
      kbIndexPrompt(chunk.text, chunk.firstLine),
      KB_INDEX_PREAMBLE,
      { onChunk: hooks?.onStream },
    ).then((parsed) => {
      const keptChunk = validateIndexNodes(parsed.nodes, lineCount);
      hooks?.onDetail?.(indexNodesDetailLine(Array.isArray(parsed.nodes) ? parsed.nodes.length : 0, keptChunk.length));
      return keptChunk;
    });
  });
  const nodes = validateIndexNodes(chunkNodes.flat(), lineCount);
  if (nodes.length === 0) {
    hooks?.onDetail?.('模型未返回有效节点，整份作为一个节点');
  } else if (chunks.length > 1) {
    hooks?.onDetail?.(`跨块去重叠后共保留 ${nodes.length} 个节点`);
  }

  const index: KbSourceIndex = {
    srcId,
    path,
    versionHash,
    nodes: nodes.length > 0 ? nodes : [{ title: path, summary: '（模型未返回有效节点，整份作为一个节点）', startLine: 1, endLine: lineCount }],
  };
  await writeSourceIndex(fs, index);
  return { srcId, versionHash, skipped: false, nodes: index.nodes };
}
