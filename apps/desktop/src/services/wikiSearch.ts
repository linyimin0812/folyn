// ponytail: A1.e MVP — BM25 over all wiki pages + 1-hop graph expansion + rerank.
// No vector embeddings (stretch), no LLM summarization (A2.d deferred).

import { wikiProvider } from './wikiProvider';
import { useWikiGraphStore } from '@/store/wikiGraphStore';
import type { WikiEntry } from '@/types/wiki';
import { parsePage } from './wikiPageWriter';

const TOKEN_BUDGET = 6000;
const SINGLE_PAGE_CHAR_CAP = 4000;
const NEIGHBOR_WEIGHT = 0.5;
const TITLE_BOOST = 1.5;

const STOPWORDS_EN = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'in', 'to', 'and', 'or', 'for', 'on', 'with', 'as', 'by', 'at', 'from', 'this', 'that', 'it', 'be', 'was', 'were', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'do', 'does', 'did', 'have', 'has', 'had']);
const STOPWORDS_ZH = new Set(['的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '这', '那', '有', '为', '以', '及']);

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  // English tokens
  const en = lower.match(/[a-z][a-z0-9]+/g) ?? [];
  // Chinese bi-grams
  const zh = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const zhGrams: string[] = [];
  for (const run of zh) {
    for (let i = 0; i + 1 < run.length; i++) zhGrams.push(run.slice(i, i + 2));
    if (run.length === 1) zhGrams.push(run);
  }
  return [...en, ...zhGrams].filter((t) => !STOPWORDS_EN.has(t) && !STOPWORDS_ZH.has(t));
}

interface PageDoc {
  path: string;
  tokens: string[];
  termFreq: Map<string, number>;
  titleTermFreq: Map<string, number>;
  bodyTermFreq: Map<string, number>;
  length: number;
}

async function loadAllPages(): Promise<PageDoc[]> {
  const all: WikiEntry[] = await wikiProvider.listFiles();
  const paths: string[] = [];
  const walk = (entries: WikiEntry[]) => {
    for (const e of entries) {
      if (e.type === 'file' && e.name.endsWith('.md')) paths.push(e.path);
      if (e.type === 'dir' && e.children) walk(e.children);
    }
  };
  walk(all);

  const docs: PageDoc[] = [];
  for (const path of paths) {
    try {
      const content = await wikiProvider.readFile(path);
      const parsed = parsePage(content);
      const titleTokens = tokenize(parsed.frontmatter.title ?? '');
      const bodyTokens = tokenize(parsed.body);
      const tokens = [...titleTokens, ...bodyTokens];
      const tf = new Map<string, number>();
      const titleTf = new Map<string, number>();
      const bodyTf = new Map<string, number>();
      for (const t of titleTokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
        titleTf.set(t, (titleTf.get(t) ?? 0) + 1);
      }
      for (const t of bodyTokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
        bodyTf.set(t, (bodyTf.get(t) ?? 0) + 1);
      }
      docs.push({ path, tokens, termFreq: tf, titleTermFreq: titleTf, bodyTermFreq: bodyTf, length: tokens.length });
    } catch {
      // skip
    }
  }
  return docs;
}

function bm25Score(queryTokens: string[], doc: PageDoc, avgDocLen: number, docFreq: Map<string, number>, totalDocs: number): number {
  const k1 = 1.5;
  const b = 0.75;
  let score = 0;
  for (const term of new Set(queryTokens)) {
    // Title-field TF with boost; body-field TF unweighted. A token appearing in
    // both fields contributes from both streams (matches the old concatenated
    // behavior, but title hits now outweigh body hits at equal IDF).
    const titleTf = doc.titleTermFreq.get(term) ?? 0;
    const bodyTf = doc.bodyTermFreq.get(term) ?? 0;
    const tf = titleTf * TITLE_BOOST + bodyTf;
    if (tf === 0) continue;
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
    const denom = tf + k1 * (1 - b + b * (doc.length / Math.max(avgDocLen, 1)));
    score += idf * ((tf * (k1 + 1)) / denom);
  }
  return score;
}

export interface SearchHit {
  path: string;        // wiki-relative path, no .md suffix
  score: number;
  isNeighbor: boolean;
}

export async function searchWiki(query: string, opts: { topK?: number; expandGraph?: boolean } = {}): Promise<SearchHit[]> {
  const { topK = 20, expandGraph = true } = opts;
  const docs = await loadAllPages();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || docs.length === 0) return [];

  const totalDocs = docs.length;
  const docFreq = new Map<string, number>();
  for (const d of docs) {
    for (const term of d.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const avgDocLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;

  const scored = docs
    .map((d) => ({
      path: d.path.replace(/\.md$/, ''),
      score: bm25Score(queryTokens, d, avgDocLen, docFreq, totalDocs),
      isNeighbor: false,
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);

  const seeds = scored.slice(0, topK);

  if (!expandGraph) return seeds;

  // Graph expansion: 1-hop neighbors via WikiGraphStore.
  try {
    const graph = useWikiGraphStore.getState();
    if (!graph.nodes.length) await graph.buildGraph();
    const neighborSet = new Map<string, number>(); // path -> best score
    for (const seed of seeds) {
      const nIds = graph.getNeighborIds(seed.path);
      for (const nId of nIds) {
        const cur = neighborSet.get(nId) ?? 0;
        neighborSet.set(nId, Math.max(cur, seed.score * NEIGHBOR_WEIGHT));
      }
    }
    const seedPaths = new Set(seeds.map((s) => s.path));
    const neighbors: SearchHit[] = [];
    for (const [path, score] of neighborSet) {
      if (seedPaths.has(path)) continue;
      neighbors.push({ path, score, isNeighbor: true });
    }
    return [...seeds, ...neighbors].sort((a, b) => b.score - a.score);
  } catch {
    return seeds;
  }
}

export function estimateTokens(text: string): number {
  // ponytail: char/3.5 — English ~4 chars/token, Chinese ~1.5 chars/token; 3.5 is a compromise.
  return Math.ceil(text.length / 3.5);
}

export function truncateForContext(content: string): string {
  if (content.length <= SINGLE_PAGE_CHAR_CAP) return content;
  return content.slice(0, SINGLE_PAGE_CHAR_CAP) + '\n\n_...（截断，单页超 4000 字符）_';
}

export const AI_CONTEXT_BUDGET_TOKENS = TOKEN_BUDGET;

export async function buildWikiContextV2(query: string): Promise<{
  context: string;
  hits: SearchHit[];
  truncated: boolean;
}> {
  const hits = await searchWiki(query, { topK: 20, expandGraph: true });
  const overview = await wikiProvider.readFile('overview.md').catch(() => '');
  const purpose = await wikiProvider.readFile('purpose.md').catch(() => '');

  const pages: { path: string; content: string; isNeighbor: boolean }[] = [];
  let usedTokens = estimateTokens(overview) + estimateTokens(purpose);
  let truncated = false;

  for (const hit of hits) {
    try {
      const rawPath = hit.path.endsWith('.md') ? hit.path : `${hit.path}.md`;
      const content = await wikiProvider.readFile(rawPath);
      const truncatedContent = truncateForContext(content);
      const t = estimateTokens(truncatedContent);
      if (usedTokens + t > TOKEN_BUDGET) {
        truncated = true;
        break;
      }
      pages.push({ path: hit.path, content: truncatedContent, isNeighbor: hit.isNeighbor });
      usedTokens += t;
    } catch {
      // skip missing
    }
  }

  const pagesBlock = pages
    .map((p) => `## wiki://${p.path}${p.isNeighbor ? '  _(图扩展邻居，降权)_' : ''}\n${p.content}`)
    .join('\n\n---\n\n');

  return {
    context: [
      `## Wiki Overview\n${overview || '_empty_'}`,
      `## Wiki Purpose\n${purpose || '_empty_'}`,
      `## Relevant Wiki Pages (${pages.length} matched${truncated ? ', truncated by token budget' : ''})`,
      pagesBlock || '_No matching pages found._',
    ].join('\n\n'),
    hits,
    truncated,
  };
}
