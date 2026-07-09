import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import type { WikiGraphNode, WikiGraphEdge, WikiPageType } from '@/types/wiki';
import { WIKI_PREFIX } from '@/types/wiki';
import { flattenTree } from '@/utils/treeUtils';

interface ParsedPage {
  path: string;
  title: string;
  type: WikiPageType | 'user-file';
  sources: string[];
  tags: string[];
  links: string[];
}

function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[(.+?)\]\]/g);
  return Array.from(matches, (m) => m[1]);
}

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string | string[]> = {};
  let currentKey = '';
  let currentList: string[] | null = null;

  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      if (currentKey && currentList) {
        result[currentKey] = currentList;
      }
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        result[currentKey] = val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
        currentKey = '';
        currentList = null;
      } else if (val === '') {
        currentList = [];
      } else {
        result[currentKey] = val;
        currentKey = '';
        currentList = null;
      }
    } else if (currentList !== null && line.match(/^\s+-\s+(.+)/)) {
      const itemMatch = line.match(/^\s+-\s+(.+)/);
      if (itemMatch) currentList.push(itemMatch[1].trim());
    }
  }
  if (currentKey && currentList) {
    result[currentKey] = currentList;
  }
  return result;
}

export async function buildGraphData(): Promise<{ nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }> {
  const pages: ParsedPage[] = [];

  const dirs = ['entities', 'concepts', 'sources', 'syntheses'];
  for (const dir of dirs) {
    const entries = await wikiProvider.listFiles(dir).catch(() => []);
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.path.endsWith('.md')) continue;
      try {
        const content = await wikiProvider.readFile(entry.path);
        const fm = parseFrontmatter(content);
        pages.push({
          path: `${WIKI_PREFIX}${entry.path}`,
          title: (fm.title as string) || entry.name.replace('.md', ''),
          type: (fm.type as WikiPageType) || 'entity',
          sources: (fm.sources as string[]) || [],
          tags: (fm.tags as string[]) || [],
          links: extractWikiLinks(content),
        });
      } catch { /* skip */ }
    }
  }

  const vault = useVaultStore.getState();
  const vaultFiles = flattenTree(vault.fileTree).filter((p) => p.endsWith('.md'));
  for (const filePath of vaultFiles) {
    try {
      const content = await vault.readFile(filePath);
      const links = extractWikiLinks(content);
      if (links.length > 0 || pages.some((p) => p.sources.includes(filePath))) {
        pages.push({
          path: filePath,
          title: filePath.split('/').pop()?.replace('.md', '') || filePath,
          type: 'user-file',
          sources: [],
          tags: [],
          links,
        });
      }
    } catch { /* skip */ }
  }

  const nodes: WikiGraphNode[] = pages.map((p) => ({
    id: p.path,
    label: p.title,
    type: (p.type === 'user-file' ? 'user-file' : p.type) as WikiGraphNode['type'],
    linkCount: 0,
    tags: p.tags,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeMap = new Map<string, WikiGraphEdge>();

  function getEdgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function getOrCreateEdge(a: string, b: string): WikiGraphEdge {
    const key = getEdgeKey(a, b);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        source: a,
        target: b,
        weight: 0,
        signals: { directLink: false, sourceOverlap: false, adamicAdar: 0, typeAffinity: 0 },
      });
    }
    return edgeMap.get(key)!;
  }

  // Signal 1: Direct Links (weight 3.0)
  for (const page of pages) {
    for (const link of page.links) {
      const targetId = nodeIds.has(link) ? link
        : nodeIds.has(`${WIKI_PREFIX}${link}`) ? `${WIKI_PREFIX}${link}`
        : nodeIds.has(`${link}.md`) ? `${link}.md`
        : nodeIds.has(`${WIKI_PREFIX}${link}.md`) ? `${WIKI_PREFIX}${link}.md`
        : null;
      if (targetId && targetId !== page.path) {
        const edge = getOrCreateEdge(page.path, targetId);
        if (!edge.signals.directLink) {
          edge.signals.directLink = true;
          edge.weight += 3.0;
        }
      }
    }
  }

  // Signal 2: Source Overlap (weight 4.0)
  const sourceToPages = new Map<string, string[]>();
  for (const page of pages) {
    for (const src of page.sources) {
      const list = sourceToPages.get(src) || [];
      list.push(page.path);
      sourceToPages.set(src, list);
    }
  }
  for (const [, pagePaths] of sourceToPages) {
    for (let i = 0; i < pagePaths.length; i++) {
      for (let j = i + 1; j < pagePaths.length; j++) {
        const edge = getOrCreateEdge(pagePaths[i], pagePaths[j]);
        if (!edge.signals.sourceOverlap) {
          edge.signals.sourceOverlap = true;
          edge.weight += 4.0;
        }
      }
    }
  }

  // Signal 3: Adamic-Adar (weight 1.5)
  const neighbors = new Map<string, Set<string>>();
  for (const [, edge] of edgeMap) {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const nodeList = Array.from(nodeIds);
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const a = nodeList[i];
      const b = nodeList[j];
      const neighborsA = neighbors.get(a);
      const neighborsB = neighbors.get(b);
      if (!neighborsA || !neighborsB) continue;
      let aa = 0;
      for (const common of neighborsA) {
        if (neighborsB.has(common)) {
          const degree = neighbors.get(common)?.size || 1;
          aa += 1 / Math.log2(degree + 1);
        }
      }
      if (aa > 0) {
        const edge = getOrCreateEdge(a, b);
        edge.signals.adamicAdar = aa;
        edge.weight += aa * 1.5;
      }
    }
  }

  // Signal 4: Type Affinity (weight 1.0)
  const pageTypeMap = new Map(pages.map((p) => [p.path, p.type]));
  for (const [, edge] of edgeMap) {
    const typeA = pageTypeMap.get(edge.source);
    const typeB = pageTypeMap.get(edge.target);
    if (typeA && typeB && typeA === typeB && typeA !== 'user-file') {
      edge.signals.typeAffinity = 1.0;
      edge.weight += 1.0;
    }
  }

  // Update link counts
  const linkCounts = new Map<string, number>();
  for (const [, edge] of edgeMap) {
    linkCounts.set(edge.source, (linkCounts.get(edge.source) || 0) + 1);
    linkCounts.set(edge.target, (linkCounts.get(edge.target) || 0) + 1);
  }
  for (const node of nodes) {
    node.linkCount = linkCounts.get(node.id) || 0;
  }

  return {
    nodes,
    edges: Array.from(edgeMap.values()).filter((e) => e.weight > 0),
  };
}
