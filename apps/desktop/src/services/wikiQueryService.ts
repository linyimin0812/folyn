// apps/desktop/src/services/wikiQueryService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { createAdapter } from '@quill/cli-adapter';
import { collectTextFromStream } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';
import { buildWikiContextV2 } from './wikiSearch';
import { toKebabCase } from '@/utils/wikiNaming';

/**
 * 构造 query action 的运行指令（动态部分）。静态输出契约由 canonical
 * `__wiki__/.claude/agents/wiki.md` 承载（action: query → Markdown with [[wiki://path]] citations）。
 */
export function buildQueryInstruction(query: string, wikiContext: string): string {
  return [
    '动作：query',
    '',
    '## Wiki Context',
    wikiContext,
    '',
    '## User Question',
    query,
    '',
    '请按 query action 契约输出。',
  ].join('\n');
}

/**
 * 调用 wiki feature agent 的 query action，返回 Markdown 答案。
 *
 * agent 文件存在 → bare:false + --agent wiki（cwd=`<vault>/__wiki__/` 自动发现）；
 * 不存在 → --bare 回退（仍发送指令，但无 feature agent 上下文）。
 *
 * ponytail: A4.b multi-turn — 传入 sessionId 时透传 resumeSessionId，由 Claude CLI 按 id 持久化历史。
 * 适配器仍每次 start/stop（无状态），但会话历史由 CLI 自身在磁盘上按 id 持久化。
 */
export async function runWikiQuery(query: string, sessionId?: string): Promise<string> {
  const vault = useVaultStore.getState();
  const aiConfig = useAiConfigStore.getState();
  if (!vault.currentVault) throw new Error('No active vault');

  const { context: wikiContext } = await buildWikiContextV2(query);
  const instruction = buildQueryInstruction(query, wikiContext);

  const adapter = createAdapter(aiConfig.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: aiConfig.cliPath, workingDir });

  try {
    const sendOpts = await getFeatureAgentSendOptions('wiki');
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(instruction, { ...sendOpts, resumeSessionId: sessionId });
    return await textPromise;
  } finally {
    await adapter.stop();
  }
}

export async function saveToWiki(
  title: string,
  content: string,
  relatedQuery: string,
  sourcePaths: string[] = [],
  relatedPages: string[] = [],
): Promise<string> {
  // ponytail: A5 — syntheses 落库时回写 sources/related，confidence='low'（agent 生成未经多源交叉验证）。
  const kebab = toKebabCase(title);
  const path = `syntheses/${kebab}.md`;
  const today = new Date().toISOString().split('T')[0];
  const sources = sourcePaths.map((p) => (p.endsWith('.md') ? p : `${p}.md`));
  const page = `---
title: "${title}"
type: synthesis
sources: [${sources.map((s) => `"${s}"`).join(', ')}]
tags: []
created: ${today}
updated: ${today}
confidence: low
related: [${relatedPages.map((p) => `"${p}"`).join(', ')}]
---

# ${title}

_Generated from query: "${relatedQuery}"_

${content}
`;
  await wikiProvider.writeFile(path, page);
  return path;
}
