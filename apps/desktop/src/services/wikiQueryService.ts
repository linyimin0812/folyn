// apps/desktop/src/services/wikiQueryService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { createAdapter, type CliStreamEvent } from '@quill/cli-adapter';
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
 * ponytail: multi-turn resume — only pass `--resume <id>` when `resume && sessionId`
 * is truthy. On the first call the local sessionId is a freshly-generated ID that
 * does NOT exist on disk yet, so `claude --resume <id>` rejects immediately with
 * `subtype: "error_during_execution", num_turns: 0`. Omitting `resumeSessionId`
 * on the first call lets the CLI start fresh and emit a `session_id` in its
 * `system/init` event; we capture it via the side listener and return it so the
 * caller can write it back to the store — subsequent calls pass `resume=true`
 * with the real on-disk id. Upgrade path: capture session_id from the `result`
 * event too if `system/init` ever stops firing.
 */
export async function runWikiQuery(
  query: string,
  sessionId?: string,
  resume = false,
): Promise<{ answer: string; sessionId?: string }> {
  const vault = useVaultStore.getState();
  const aiConfig = useAiConfigStore.getState();
  if (!vault.currentVault) throw new Error('No active vault');

  const { context: wikiContext } = await buildWikiContextV2(query);
  const instruction = buildQueryInstruction(query, wikiContext);

  const adapter = createAdapter(aiConfig.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: aiConfig.cliPath, workingDir });

  let assignedSessionId: string | undefined;
  const captureSessionId = (event: CliStreamEvent) => {
    if (event.type === 'session_id' && event.sessionId) {
      assignedSessionId = event.sessionId;
    }
  };
  adapter.onEvent(captureSessionId);

  try {
    const sendOpts = await getFeatureAgentSendOptions('wiki');
    const finalOpts = resume && sessionId
      ? { ...sendOpts, resumeSessionId: sessionId }
      : sendOpts;
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(instruction, finalOpts);
    const answer = await textPromise;
    return { answer, sessionId: assignedSessionId };
  } finally {
    adapter.offEvent(captureSessionId);
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
