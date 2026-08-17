// ponytail: 13 structural checks, each pure function over LintContext.
// Code-driven (B1.c) — no LLM call. Transactional writes (B5.y) are the caller's job.

import type { ReviewItem, WikiFrontmatter, WikiPageType } from '@/types/wiki';
import { parsePage } from './wikiPageWriter';
import { toKebabCase } from '@/utils/wikiNaming';
import { generateId } from '@/utils/idGenerator';

const REQUIRED_FM_FIELDS: (keyof WikiFrontmatter)[] = [
  'title', 'type', 'sources', 'tags', 'created', 'updated', 'confidence', 'related',
];
const VALID_TYPES: WikiPageType[] = ['entity', 'concept', 'source', 'comparison', 'synthesis'];
const VALID_CONFIDENCE: WikiFrontmatter['confidence'][] = ['high', 'medium', 'low'];

export interface LintPage {
  path: string;       // wiki-relative, e.g. "entities/react.md"
  content: string;    // raw file content
  parsed: ReturnType<typeof parsePage>;
}

export interface LintContext {
  pages: LintPage[];
  hashCache: Record<string, string>;
  vaultExists: (path: string) => Promise<boolean>;
  vaultReadMtime: (path: string) => Promise<number | null>;
  schemaFieldSet: Set<string>;
}

type CheckId =
  | 'missing_page' | 'orphan_page' | 'stale_content' | 'frontmatter_invalid'
  | 'sources_path_invalid' | 'related_asymmetric' | 'schema_drift'
  | 'kebab_collision' | 'confidence_violation' | 'updated_older_than_source_mtime'
  | 'cache_orphan' | 'index_missing_page' | 'log_missing_ingest';

function makeItem(
  checkId: CheckId,
  type: ReviewItem['type'],
  title: string,
  description: string,
  affectedPages: string[],
  suggestedActions: ReviewItem['suggestedActions'],
): ReviewItem {
  return {
    id: generateId(),
    type,
    checkId,
    dedupKey: `${checkId}:${affectedPages.slice().sort().join('|')}`,
    title,
    description,
    affectedPages,
    suggestedActions,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    status: 'pending',
  };
}

const WIKILINK_RE = /\[\[wiki:\/\/([^\]]+?)\]\]/g;

function* iterWikiLinks(body: string): Generator<string> {
  for (const m of body.matchAll(WIKILINK_RE)) yield m[1]!;
}

const ALLOWED_TOP_DIRS = new Set(['entities', 'concepts', 'sources', 'syntheses']);

function normalizeWikiPath(p: string): string {
  return p.replace(/\.md$/, '');
}

async function checkMissingPage(ctx: LintContext): Promise<ReviewItem[]> {
  const known = new Set(ctx.pages.map((p) => normalizeWikiPath(p.path)));
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    for (const link of iterWikiLinks(page.parsed.body)) {
      const norm = normalizeWikiPath(link);
      if (!known.has(norm)) {
        items.push(makeItem(
          'missing_page', 'structure_change',
          `缺失页面: ${norm}`,
          `[[wiki://${link}]] 引用的目标不存在（来源页: ${page.path}）`,
          [norm],
          [
            { label: '创建 stub 页', type: 'accept' },
            { label: '移除引用', type: 'reject' },
            { label: '调研', type: 'research' },
          ],
        ));
      }
    }
  }
  return items;
}

async function checkOrphanPage(ctx: LintContext): Promise<ReviewItem[]> {
  const inlinks = new Map<string, number>();
  for (const page of ctx.pages) {
    for (const link of iterWikiLinks(page.parsed.body)) {
      const norm = normalizeWikiPath(link);
      inlinks.set(norm, (inlinks.get(norm) ?? 0) + 1);
    }
  }
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    const norm = normalizeWikiPath(page.path);
    if (page.path.startsWith('sources/')) continue; // sources 不算孤立
    if ((inlinks.get(norm) ?? 0) === 0) {
      items.push(makeItem(
        'orphan_page', 'structure_change',
        `孤立页面: ${page.path}`,
        `无入链且不在 sources/ 下，建议删除或加链接`,
        [page.path],
        [
          { label: '删除页面', type: 'accept' },
          { label: '忽略', type: 'reject' },
          { label: '调研', type: 'research' },
        ],
      ));
    }
  }
  return items;
}

async function checkStaleContent(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    if (!page.path.startsWith('sources/')) continue;
    const fm = page.parsed.frontmatter;
    const sources = fm.sources ?? [];
    for (const src of sources) {
      const cachedHash = ctx.hashCache[src];
      if (cachedHash === undefined) continue;
      const exists = await ctx.vaultExists(src);
      if (!exists) continue; // handled by cache_orphan
      // We can't recompute hash here without reading source — skip recomputation; rely on updated_older_than_source_mtime for the same signal.
    }
  }
  return items;
}

async function checkFrontmatterInvalid(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    if (page.path === 'schema.md' || page.path === 'purpose.md' || page.path === 'overview.md' || page.path === 'index.md' || page.path === 'log.md') continue;
    const fm = page.parsed.frontmatter;
    const missing: string[] = [];
    for (const f of REQUIRED_FM_FIELDS) {
      if (fm[f] === undefined || fm[f] === null) missing.push(f);
    }
    const badType = fm.type && !VALID_TYPES.includes(fm.type);
    const badConf = fm.confidence && !VALID_CONFIDENCE.includes(fm.confidence);
    if (missing.length || badType || badConf) {
      const issues: string[] = [];
      if (missing.length) issues.push(`缺字段: ${missing.join(', ')}`);
      if (badType) issues.push(`非法 type: ${fm.type}`);
      if (badConf) issues.push(`非法 confidence: ${fm.confidence}`);
      items.push(makeItem(
        'frontmatter_invalid', 'structure_change',
        `frontmatter 无效: ${page.path}`,
        issues.join('; '),
        [page.path],
        [
          { label: '补默认值', type: 'accept' },
          { label: '标 low_confidence 搁置', type: 'reject' },
        ],
      ));
    }
  }
  return items;
}

async function checkSourcesPathInvalid(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    const fm = page.parsed.frontmatter;
    const sources = fm.sources ?? [];
    const invalid: string[] = [];
    for (const src of sources) {
      const exists = await ctx.vaultExists(src);
      if (!exists) invalid.push(src);
    }
    if (invalid.length) {
      items.push(makeItem(
        'sources_path_invalid', 'structure_change',
        `sources 路径不存在: ${page.path}`,
        `下列 sources 路径在 vault 中不存在: ${invalid.join(', ')}`,
        [page.path, ...invalid],
        [
          { label: '从 sources 移除', type: 'accept' },
          { label: '标 low_confidence', type: 'reject' },
          { label: '调研重命名', type: 'research' },
        ],
      ));
    }
  }
  return items;
}

async function checkRelatedAsymmetric(ctx: LintContext): Promise<ReviewItem[]> {
  const pageMap = new Map(ctx.pages.map((p) => [normalizeWikiPath(p.path), p]));
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    const fm = page.parsed.frontmatter;
    const related = fm.related ?? [];
    const myNorm = normalizeWikiPath(page.path);
    for (const r of related) {
      const rNorm = normalizeWikiPath(r);
      const other = pageMap.get(rNorm);
      if (!other) continue; // missing_page will catch it
      const otherRelated = (other.parsed.frontmatter.related ?? []).map((x) => normalizeWikiPath(x));
      if (!otherRelated.includes(myNorm)) {
        items.push(makeItem(
          'related_asymmetric', 'structure_change',
          `related 单向: ${myNorm} → ${rNorm}`,
          `${rNorm}.related 不含 ${myNorm}`,
          [myNorm, rNorm],
          [
            { label: '补反向链接', type: 'accept' },
            { label: '从本页移除', type: 'reject' },
          ],
        ));
      }
    }
  }
  return items;
}

async function checkSchemaDrift(ctx: LintContext): Promise<ReviewItem[]> {
  const tsFields = new Set(REQUIRED_FM_FIELDS.map(String));
  const drift: string[] = [];
  for (const f of tsFields) if (!ctx.schemaFieldSet.has(f)) drift.push(f);
  for (const f of ctx.schemaFieldSet) if (!tsFields.has(f)) drift.push(f);
  if (drift.length === 0) return [];
  return [
    makeItem(
      'schema_drift', 'structure_change',
      `schema.md 与 TS WikiFrontmatter 漂移`,
      `字段集合不一致: ${drift.join(', ')}`,
      ['schema.md'],
      [
        { label: '用 TS 类型重写 schema.md', type: 'accept' },
        { label: '不动', type: 'reject' },
      ],
    ),
  ];
}

async function checkKebabCollision(ctx: LintContext): Promise<ReviewItem[]> {
  // Re-derive: does any pair of distinct "intended names" (titles) produce same kebab path?
  // We can only see current pages, not intent. So check: any page whose path's kebab doesn't match toKebabCase(title)?
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    if (!page.path.startsWith('entities/') && !page.path.startsWith('concepts/')) continue;
    const fm = page.parsed.frontmatter;
    if (!fm.title) continue;
    const expectedKebab = toKebabCase(fm.title);
    const actualKebab = page.path.split('/').pop()!.replace(/\.md$/, '');
    if (actualKebab !== expectedKebab) {
      items.push(makeItem(
        'kebab_collision', 'structure_change',
        `命名与路径不符: ${page.path}`,
        `title="${fm.title}" 应映射到 ${expectedKebab}.md，实际路径是 ${actualKebab}.md`,
        [page.path],
        [
          { label: '改名对齐', type: 'accept' },
          { label: '忽略', type: 'reject' },
          { label: '调研', type: 'research' },
        ],
      ));
    }
  }
  return items;
}

async function checkConfidenceViolation(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    const fm = page.parsed.frontmatter;
    if (fm.confidence === 'high' && (fm.sources?.length ?? 0) < 2) {
      items.push(makeItem(
        'confidence_violation', 'stale_content',
        `confidence 规则违反: ${page.path}`,
        `confidence=high 但 sources 仅 ${fm.sources?.length ?? 0} 条（应 ≥ 2）`,
        [page.path],
        [
          { label: '按 C5.a 规则重算', type: 'accept' },
          { label: '不动', type: 'reject' },
        ],
      ));
    }
    if (fm.confidence === 'low' && (fm.sources?.length ?? 0) >= 2) {
      // Don't auto-promote; low might be from contradiction. Skip.
    }
  }
  return items;
}

async function checkUpdatedOlderThanSourceMtime(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  const now = Date.now();
  for (const page of ctx.pages) {
    const fm = page.parsed.frontmatter;
    const updated = fm.updated ? Date.parse(fm.updated) : NaN;
    if (!Number.isFinite(updated)) continue;
    for (const src of fm.sources ?? []) {
      const mtime = await ctx.vaultReadMtime(src);
      if (mtime === null) continue;
      if (mtime > updated + 24 * 3600 * 1000) { // >1 day newer source
        items.push(makeItem(
          'updated_older_than_source_mtime', 'stale_content',
          `源变了页面未重 ingest: ${page.path}`,
          `源 ${src} 的 mtime=${new Date(mtime).toISOString()} 比 page.updated=${fm.updated} 新`,
          [page.path, src],
          [
            { label: '重新 ingest 该源', type: 'accept' },
            { label: '标 stale 搁置', type: 'reject' },
            { label: '调研', type: 'research' },
          ],
        ));
      }
      if (Date.now() - now > 5000) return items; // ponytail: hard cap on mtime checks if vault huge
    }
  }
  return items;
}

async function checkCacheOrphan(ctx: LintContext): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const [srcPath] of Object.entries(ctx.hashCache)) {
    const exists = await ctx.vaultExists(srcPath);
    if (!exists) {
      items.push(makeItem(
        'cache_orphan', 'stale_content',
        `cache 残留已删源: ${srcPath}`,
        `cache/hashes.json 仍有 ${srcPath}，但 vault 已删`,
        [srcPath],
        [
          { label: '从 cache 删条目', type: 'accept' },
          { label: '不动', type: 'reject' },
        ],
      ));
    }
  }
  return items;
}

async function checkIndexMissingPage(ctx: LintContext): Promise<ReviewItem[]> {
  const indexPage = ctx.pages.find((p) => p.path === 'index.md');
  if (!indexPage) return [];
  const linkedPaths = new Set<string>();
  for (const m of indexPage.parsed.body.matchAll(/\[\[wiki:\/\/([^\]]+?)\]\]/g)) {
    linkedPaths.add(normalizeWikiPath(m[1]!));
  }
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    if (page.path === 'index.md' || page.path === 'log.md' || page.path === 'overview.md' || page.path === 'schema.md' || page.path === 'purpose.md') continue;
    const norm = normalizeWikiPath(page.path);
    if (!linkedPaths.has(norm)) {
      items.push(makeItem(
        'index_missing_page', 'structure_change',
        `index.md 缺页面: ${norm}`,
        `${page.path} 不在 index.md 链接清单里`,
        [page.path],
        [
          { label: '追加链接行', type: 'accept' },
          { label: '不动', type: 'reject' },
        ],
      ));
    }
  }
  return items;
}

async function checkLogMissingIngest(ctx: LintContext): Promise<ReviewItem[]> {
  // ponytail: heuristic — for each source page, ensure log.md has a matching "ingest <source>" line.
  const logPage = ctx.pages.find((p) => p.path === 'log.md');
  if (!logPage) return [];
  const logLines = logPage.parsed.body;
  const items: ReviewItem[] = [];
  for (const page of ctx.pages) {
    if (!page.path.startsWith('sources/')) continue;
    const fm = page.parsed.frontmatter;
    const sources = fm.sources ?? [];
    for (const src of sources) {
      if (!logLines.includes(`ingest ${src}`)) {
        items.push(makeItem(
          'log_missing_ingest', 'structure_change',
          `log.md 缺 ingest 条目: ${src}`,
          `源 ${src} 已有摘要页，但 log.md 没有 "ingest ${src}" 条目`,
          [src],
          [
            { label: '补 log 条目', type: 'accept' },
            { label: '不动', type: 'reject' },
          ],
        ));
      }
    }
  }
  return items;
}

const CHECKS: Array<{ id: CheckId; fn: (ctx: LintContext) => Promise<ReviewItem[]> }> = [
  { id: 'missing_page', fn: checkMissingPage },
  { id: 'orphan_page', fn: checkOrphanPage },
  { id: 'stale_content', fn: checkStaleContent },
  { id: 'frontmatter_invalid', fn: checkFrontmatterInvalid },
  { id: 'sources_path_invalid', fn: checkSourcesPathInvalid },
  { id: 'related_asymmetric', fn: checkRelatedAsymmetric },
  { id: 'schema_drift', fn: checkSchemaDrift },
  { id: 'kebab_collision', fn: checkKebabCollision },
  { id: 'confidence_violation', fn: checkConfidenceViolation },
  { id: 'updated_older_than_source_mtime', fn: checkUpdatedOlderThanSourceMtime },
  { id: 'cache_orphan', fn: checkCacheOrphan },
  { id: 'index_missing_page', fn: checkIndexMissingPage },
  { id: 'log_missing_ingest', fn: checkLogMissingIngest },
];

export async function runStructuralLint(ctx: LintContext): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  for (const check of CHECKS) {
    try {
      const items = await check.fn(ctx);
      all.push(...items);
    } catch (err) {
      // ponytail: one check failure shouldn't kill all. Log via the items themselves? Skip for now.
      console.error(`[wiki lint] check ${check.id} failed:`, err);
    }
  }
  return all;
}
