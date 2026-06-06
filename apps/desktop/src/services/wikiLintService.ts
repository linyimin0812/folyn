// apps/desktop/src/services/wikiLintService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import type { ReviewItem } from '@/types/wiki';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[wiki:\/\/(.+?)\]\]/g);
  return Array.from(matches, (m) => m[1]);
}

export function extractFrontmatterSources(content: string): string[] {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const sourcesMatch = fmMatch[1].match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (!sourcesMatch) return [];
  return sourcesMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

async function collectAllWikiPages(): Promise<{ path: string; content: string }[]> {
  const pages: { path: string; content: string }[] = [];
  const dirs = ['entities', 'concepts', 'sources', 'syntheses'];

  for (const dir of dirs) {
    const entries = await wikiProvider.listFiles(dir).catch(() => []);
    for (const entry of entries) {
      if (entry.type === 'file' && entry.path.endsWith('.md')) {
        try {
          const content = await wikiProvider.readFile(entry.path);
          pages.push({ path: entry.path, content });
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return pages;
}

export async function runWikiLint(): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  const pages = await collectAllWikiPages();
  const allPaths = new Set(pages.map((p) => p.path));

  // 1. Missing pages: referenced but don't exist
  for (const page of pages) {
    const links = extractWikiLinks(page.content);
    for (const link of links) {
      const targetPath = link.endsWith('.md') ? link : `${link}.md`;
      if (!allPaths.has(targetPath) && !allPaths.has(link)) {
        items.push({
          id: generateId(),
          type: 'structure_change',
          title: `缺失页面: ${link}`,
          description: `${page.path} 引用了 [[wiki://${link}]]，但该页面不存在`,
          affectedPages: [page.path],
          suggestedActions: [
            { label: '创建空白页面', type: 'accept' },
            { label: '忽略', type: 'reject' },
          ],
          createdAt: Date.now(),
          status: 'pending',
        });
      }
    }
  }

  // 2. Orphan pages: no inbound links
  const inboundCount = new Map<string, number>();
  for (const page of pages) {
    const links = extractWikiLinks(page.content);
    for (const link of links) {
      const key = link.endsWith('.md') ? link : `${link}.md`;
      inboundCount.set(key, (inboundCount.get(key) || 0) + 1);
    }
  }
  for (const page of pages) {
    if (!inboundCount.has(page.path) && !page.path.startsWith('sources/')) {
      items.push({
        id: generateId(),
        type: 'structure_change',
        title: `孤立页面: ${page.path}`,
        description: `没有其他 wiki 页面链接到此页面`,
        affectedPages: [page.path],
        suggestedActions: [
          { label: '搜索关联', type: 'research' },
          { label: '忽略', type: 'reject' },
        ],
        createdAt: Date.now(),
        status: 'pending',
      });
    }
  }

  // 3. Stale content: source files changed since last ingest
  const hashCache = await wikiProvider.readHashCache();
  const vault = useVaultStore.getState();
  for (const [filePath, oldHash] of Object.entries(hashCache)) {
    try {
      const content = await vault.readFile(filePath);
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const newHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      if (newHash !== oldHash) {
        items.push({
          id: generateId(),
          type: 'stale_content',
          title: `过时内容: ${filePath}`,
          description: `源文件 ${filePath} 已更新，但 wiki 中的摘要可能过时`,
          affectedPages: [`sources/${filePath.replace(/[/\\]/g, '-').replace(/\.\w+$/, '')}.md`],
          suggestedActions: [
            { label: '重新摄入', type: 'accept' },
            { label: '忽略', type: 'reject' },
          ],
          createdAt: Date.now(),
          status: 'pending',
        });
      }
    } catch {
      // source file may have been deleted
    }
  }

  return items;
}
