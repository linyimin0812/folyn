/**
 * BM25 关键词索引（纯逻辑，无 IO）。
 *
 * 英文 token + 中文 bigram、标题加权（思路沿 master 新写，非移植）。
 * 覆盖资料全文 + 知识页正文 + 索引节点标题/摘要（加载在 kbAsk，缓存按 vault 记忆）。
 * 磁盘缓存暂缓 —— ADR-0009 声明其为可重建派生数据，切片 A 规模下重建成本低；
 * 1000 份资料实测超预算后再落 ~/.folyn/vaults/<vaultId>/kb-cache/。
 */

const STOPWORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'of', 'in', 'to', 'and', 'or', 'for', 'on', 'with', 'as', 'by',
  'at', 'from', 'this', 'that', 'it', 'be', 'was', 'were', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'do', 'does', 'did', 'have', 'has', 'had',
]);
const STOPWORDS_ZH = new Set(['的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '这', '那', '有', '为', '以', '及']);

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const en = lower.match(/[a-z][a-z0-9]+/g) ?? [];
  const zhRuns = lower.match(/[一-鿿]+/g) ?? [];
  const zhGrams: string[] = [];
  for (const run of zhRuns) {
    if (run.length === 1) {
      zhGrams.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) zhGrams.push(run.slice(i, i + 2));
  }
  return [...en, ...zhGrams].filter((t) => !STOPWORDS_EN.has(t) && !STOPWORDS_ZH.has(t));
}

export interface KbDoc {
  /** srcId 或 tpId。 */
  id: string;
  kind: 'source' | 'topic';
  path: string;
  title: string;
  text: string;
}

interface DocStat {
  doc: KbDoc;
  titleTf: Map<string, number>;
  bodyTf: Map<string, number>;
  length: number;
}

export interface KbBm25Index {
  stats: DocStat[];
  docFreq: Map<string, number>;
  avgLen: number;
  totalDocs: number;
}

const TITLE_BOOST = 1.5;
const K1 = 1.5;
const B = 0.75;

export function buildBm25Index(docs: KbDoc[]): KbBm25Index {
  const stats: DocStat[] = [];
  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    const titleTokens = tokenize(doc.title);
    const bodyTokens = tokenize(doc.text);
    const titleTf = new Map<string, number>();
    const bodyTf = new Map<string, number>();
    for (const t of titleTokens) titleTf.set(t, (titleTf.get(t) ?? 0) + 1);
    for (const t of bodyTokens) bodyTf.set(t, (bodyTf.get(t) ?? 0) + 1);
    for (const t of new Set([...titleTokens, ...bodyTokens])) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
    stats.push({ doc, titleTf, bodyTf, length: titleTokens.length + bodyTokens.length });
  }
  const avgLen = stats.length > 0 ? stats.reduce((s, d) => s + d.length, 0) / stats.length : 0;
  return { stats, docFreq, avgLen, totalDocs: stats.length };
}

function scoreDoc(queryTokens: string[], stat: DocStat, index: KbBm25Index): number {
  let score = 0;
  for (const term of new Set(queryTokens)) {
    const tf = (stat.titleTf.get(term) ?? 0) * TITLE_BOOST + (stat.bodyTf.get(term) ?? 0);
    if (tf === 0) continue;
    const df = index.docFreq.get(term) ?? 0;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));
    const denom = tf + K1 * (1 - B + B * (stat.length / Math.max(index.avgLen, 1)));
    score += idf * ((tf * (K1 + 1)) / denom);
  }
  return score;
}

export interface Bm25Hit {
  docId: string;
  score: number;
  doc: KbDoc;
}

export function bm25Search(index: KbBm25Index, query: string, topK = 8): Bm25Hit[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || index.totalDocs === 0) return [];
  return index.stats
    .map((stat) => ({ docId: stat.doc.id, score: scoreDoc(queryTokens, stat, index), doc: stat.doc }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
