// apps/desktop/src/services/wikiQueryService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import { useSettingsStore } from '@/store/settingsStore';
import { createAdapter } from '@quill/cli-adapter';
import { collectTextFromStream } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';

export async function buildWikiContext(query: string): Promise<string> {
  const index = await wikiProvider.readFile('index.md').catch(() => '');
  const overview = await wikiProvider.readFile('overview.md').catch(() => '');
  const purpose = await wikiProvider.readFile('purpose.md').catch(() => '');

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const relevantPaths: string[] = [];
  const indexLines = index.split('\n');
  for (const line of indexLines) {
    const linkMatch = line.match(/\[\[wiki:\/\/(.+?)\]\]|\[.+?\]\((.+?\.md)\)/);
    if (linkMatch) {
      const path = linkMatch[1] || linkMatch[2];
      const lineLC = line.toLowerCase();
      if (keywords.some((k) => lineLC.includes(k))) {
        relevantPaths.push(path);
      }
    }
  }

  const pages: string[] = [];
  for (const path of relevantPaths.slice(0, 10)) {
    try {
      const content = await wikiProvider.readFile(path);
      pages.push(`## wiki://${path}\n${content}`);
    } catch {
      // skip missing pages
    }
  }

  return `## Wiki Overview
${overview}

## Wiki Purpose
${purpose}

## Relevant Wiki Pages (${pages.length} matched)
${pages.join('\n\n---\n\n') || '_No matching pages found._'}`;
}

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
 */
export async function runWikiQuery(query: string): Promise<string> {
  const vault = useVaultStore.getState();
  const settings = useSettingsStore.getState();
  if (!vault.currentVault) throw new Error('No active vault');

  const wikiContext = await buildWikiContext(query);
  const instruction = buildQueryInstruction(query, wikiContext);

  const adapter = createAdapter(settings.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // wiki agent cwd = `<vault>/__wiki__/`。
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: settings.cliPath, workingDir });

  try {
    const sendOpts = await getFeatureAgentSendOptions('wiki');
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(instruction, sendOpts);
    return await textPromise;
  } finally {
    await adapter.stop();
  }
}

export async function saveToWiki(
  title: string,
  content: string,
  relatedQuery: string,
): Promise<string> {
  const kebab = title
    .toLowerCase()
    .replace(/[^a-zA-Z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '');
  const path = `syntheses/${kebab}.md`;
  const today = new Date().toISOString().split('T')[0];
  const page = `---
title: "${title}"
type: synthesis
sources: []
tags: []
created: ${today}
updated: ${today}
confidence: medium
related: []
---

# ${title}

_Generated from query: "${relatedQuery}"_

${content}
`;
  await wikiProvider.writeFile(path, page);
  return path;
}
