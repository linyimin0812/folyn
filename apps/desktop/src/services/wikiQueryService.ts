// apps/desktop/src/services/wikiQueryService.ts

import { wikiProvider } from './wikiProvider';

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

export function buildQueryPrompt(query: string, wikiContext: string): string {
  return `You are a knowledge assistant. Answer the user's question based on the wiki knowledge below.

${wikiContext}

## User Question
${query}

## Instructions
- Answer based on the wiki content above
- Cite sources using [[wiki://path]] format
- If the wiki doesn't contain enough information, say so
- Respond in the same language as the question`;
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
