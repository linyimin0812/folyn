/**
 * 资料收录：读文件 → hash → 模型提索引节点 → 程序校验行范围 → 写 index.json。
 *
 * 长文按行边界分块多次调用模型（每块返回自己的 nodes，行号为绝对行号），程序合并。
 * 校验失败的节点丢弃并 console.warn（prd「程序校验」）。
 */

import type { KbFs } from './kbFs';
import { sha256Hex, writeSourceIndex, readSourceIndex } from './kbFs';
import type { KbIndexNode, KbManifest, KbSourceIndex } from './kbTypes';
import { kbChatJson } from './kbLlm';
import { KB_INDEX_PREAMBLE, kbIndexPrompt } from './kbPrompts';

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
): Promise<IngestSourceResult> {
  const content = await fs.readFile(path);
  const versionHash = await sha256Hex(content);
  const lineCount = content.split('\n').length;

  const existing = manifest.sources[srcId];
  const existingIndex = existing ? await readSourceIndex(fs, srcId) : null;
  if (existing && existingIndex && existing.currentHash === versionHash) {
    return { srcId, versionHash, skipped: true, nodes: existingIndex.nodes };
  }

  const collected: KbIndexNode[] = [];
  for (const chunk of chunkContent(content)) {
    const parsed = await kbChatJson<{ nodes?: unknown }>(
      kbIndexPrompt(chunk.text, chunk.firstLine),
      KB_INDEX_PREAMBLE,
    );
    collected.push(...validateIndexNodes(parsed.nodes, lineCount));
  }
  // 跨块去重叠（validateIndexNodes 兼做排序 + 重叠剔除）。
  const nodes = validateIndexNodes(collected, lineCount);

  const index: KbSourceIndex = {
    srcId,
    path,
    versionHash,
    nodes: nodes.length > 0 ? nodes : [{ title: path, summary: '（模型未返回有效节点，整份作为一个节点）', startLine: 1, endLine: lineCount }],
  };
  await writeSourceIndex(fs, index);
  return { srcId, versionHash, skipped: false, nodes: index.nodes };
}
