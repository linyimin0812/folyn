// ponytail: frontmatter parse/serialize inline — no YAML lib in deps, regex suffices.
// C2.b merge contract: frontmatter union (sources/tags/related), created stays, updated→today,
// confidence takes min; body appends `## Update <date> (from <source>)` section.
// C5.a confidence rule: high if sources>=2, medium single, low if contradiction.

import type { IngestAnalysis, ReviewItem, WikiFrontmatter, WikiPageType } from '@/types/wiki';
import { toKebabCase, appendIndexEntries, appendIngestLogEntry, type IndexEntry, type IngestLogStats } from '@/utils/wikiNaming';

const TODAY = () => new Date().toISOString().split('T')[0]!;

const CONFIDENCE_RANK: Record<WikiFrontmatter['confidence'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function minConfidence(a: WikiFrontmatter['confidence'], b: WikiFrontmatter['confidence']): WikiFrontmatter['confidence'] {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export interface ParsedPage {
  frontmatter: Partial<WikiFrontmatter>;
  body: string;
  raw: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export function parsePage(content: string): ParsedPage {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: content, raw: content };
  const fmText = m[1]!;
  const body = m[2] ?? '';
  const frontmatter: Partial<WikiFrontmatter> = {};

  const titleMatch = fmText.match(/^title:\s*"?(.*?)"?\s*$/m);
  if (titleMatch) frontmatter.title = titleMatch[1];

  const typeMatch = fmText.match(/^type:\s*(\w+)\s*$/m);
  if (typeMatch) frontmatter.type = typeMatch[1] as WikiPageType;

  const sourcesMatch = fmText.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (sourcesMatch) {
    frontmatter.sources = sourcesMatch[1]!.split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }

  const tagsMatch = fmText.match(/^tags:\s*\[?([^\]]*)\]?\s*$/m);
  if (tagsMatch) {
    frontmatter.tags = tagsMatch[1]!.split(',').map((t) => t.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }

  const createdMatch = fmText.match(/^created:\s*(\S+)\s*$/m);
  if (createdMatch) frontmatter.created = createdMatch[1];

  const updatedMatch = fmText.match(/^updated:\s*(\S+)\s*$/m);
  if (updatedMatch) frontmatter.updated = updatedMatch[1];

  const confidenceMatch = fmText.match(/^confidence:\s*(\w+)\s*$/m);
  if (confidenceMatch) frontmatter.confidence = confidenceMatch[1] as WikiFrontmatter['confidence'];

  const relatedMatch = fmText.match(/^related:\s*\[?([^\]]*)\]?\s*$/m);
  if (relatedMatch) {
    frontmatter.related = relatedMatch[1]!.split(',').map((r) => r.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }

  return { frontmatter, body, raw: content };
}

export function serializePage(fm: WikiFrontmatter, body: string): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(fm.title)}`,
    `type: ${fm.type}`,
    'sources:',
    ...fm.sources.map((s) => `  - ${s}`),
    `tags: [${fm.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `confidence: ${fm.confidence}`,
    `related: [${fm.related.map((r) => JSON.stringify(r)).join(', ')}]`,
    '---',
    '',
    body.trimEnd() + '\n',
  ];
  return lines.join('\n');
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

interface WritePlan {
  pages: { path: string; content: string }[];
  indexEntries: IndexEntry[];
  logStats: IngestLogStats;
  contradictions: ReviewItem[];
  collisions: ReviewItem[];
}

export function writeIngestPages(
  analysis: IngestAnalysis,
  sourcePath: string,
  existingPages: Record<string, string>,
): WritePlan {
  const today = TODAY();
  const sourceKebab = toKebabCase(sourcePath);
  const sourcePagePath = `sources/${sourceKebab}.md`;
  const pages: { path: string; content: string }[] = [];
  const indexEntries: IndexEntry[] = [];
  const contradictions: ReviewItem[] = [];
  const collisions: ReviewItem[] = [];

  const contradictionEntityNames = new Set(
    analysis.contradictions.flatMap((c) => [c.claim, c.vs]).map((s) => s.toLowerCase()),
  );

  // Track which entities/concepts had contradictions to force confidence=low.
  const forcedLow = new Set<string>();
  for (const c of analysis.contradictions) {
    contradictions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${contradictions.length}`,
      type: 'contradiction',
      checkId: 'ingest_contradiction',
      dedupKey: `ingest_contradiction:${c.existingSource}:${c.claim}`,
      title: `矛盾: ${c.claim}`,
      description: `新说法: "${c.claim}" vs 已有: "${c.vs}" (来源: ${c.existingSource})`,
      affectedPages: [c.existingSource],
      suggestedActions: [
        { label: '接受新说法', type: 'accept' },
        { label: '保留旧说法', type: 'reject' },
        { label: '搜索更多信息', type: 'research' },
      ],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      status: 'pending',
    });
    forcedLow.add(c.existingSource.toLowerCase());
  }

  let newEntities = 0, updatedEntities = 0, newConcepts = 0, updatedConcepts = 0;

  // Entity pages
  const entityPaths = new Map<string, string>(); // kebab → entity.name (for collision detection)
  for (const entity of analysis.entities) {
    const kebab = toKebabCase(entity.name);
    const path = `entities/${kebab}.md`;

    // C4.b collision detection: if a different entity.name already produced the same kebab.
    const priorName = entityPaths.get(kebab);
    if (priorName && priorName !== entity.name) {
      collisions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${collisions.length}`,
        type: 'structure_change',
        checkId: 'kebab_collision',
        dedupKey: `kebab_collision:${kebab}:${priorName}:${entity.name}`,
        title: `命名碰撞: "${priorName}" 与 "${entity.name}" 折叠为 ${path}`,
        description: `两个不同的实体名折叠到同一路径。需要决定保留哪个 / 合并 / 改名。`,
        affectedPages: [path],
        suggestedActions: [
          { label: '合并两页', type: 'merge' },
          { label: '忽略', type: 'reject' },
          { label: '调研', type: 'research' },
        ],
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        status: 'pending',
      });
      continue; // skip writing this entity
    }
    entityPaths.set(kebab, entity.name);

    const existing = existingPages[path];
    const isNew = !existing;
    if (isNew) newEntities++; else updatedEntities++;

    const parsed = existing ? parsePage(existing) : { frontmatter: {}, body: '' };

    // C5.a confidence rule.
    let newConfidence: WikiFrontmatter['confidence'];
    if (forcedLow.has(entity.name.toLowerCase()) || forcedLow.has(kebab)) {
      newConfidence = 'low';
    } else if ((parsed.frontmatter.sources ?? []).length + 1 >= 2) {
      newConfidence = 'high';
    } else {
      newConfidence = 'medium';
    }

    const mergedSources = union(parsed.frontmatter.sources ?? [], [sourcePath]);
    const mergedTags = union(parsed.frontmatter.tags ?? [], []);
    const mergedRelated = union(parsed.frontmatter.related ?? [], []);

    const oldConfidence = parsed.frontmatter.confidence ?? newConfidence;
    const confidence = forcedLow.has(entity.name.toLowerCase()) || forcedLow.has(kebab)
      ? 'low' as const
      : minConfidence(oldConfidence, newConfidence);

    const fm: WikiFrontmatter = {
      title: parsed.frontmatter.title && parsed.frontmatter.title !== entity.name ? parsed.frontmatter.title : entity.name,
      type: parsed.frontmatter.type ?? (entity.type as WikiPageType) ?? 'entity',
      sources: mergedSources,
      tags: mergedTags,
      created: parsed.frontmatter.created ?? today,
      updated: today,
      confidence,
      related: mergedRelated,
    };

    const updateSection = isNew
      ? `# ${entity.name}\n\n${entity.description ?? ''}\n`
      : `${parsed.body.trimEnd()}\n\n## Update ${today} (from ${sourcePath})\n\n${entity.description ?? ''}\n`;

    pages.push({ path, content: serializePage(fm, updateSection) });
    indexEntries.push({ path: path.replace(/\.md$/, ''), title: fm.title, source: sourcePath });
  }

  // Concept pages
  for (const concept of analysis.concepts) {
    const kebab = toKebabCase(concept.name);
    const path = `concepts/${kebab}.md`;

    const priorName = entityPaths.get(kebab);
    if (priorName && priorName !== concept.name) {
      collisions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${collisions.length}`,
        type: 'structure_change',
        checkId: 'kebab_collision',
        dedupKey: `kebab_collision:${kebab}:${priorName}:${concept.name}`,
        title: `命名碰撞: "${priorName}" 与 "${concept.name}" 折叠为 ${path}`,
        description: `两个不同名折叠到同一路径。`,
        affectedPages: [path],
        suggestedActions: [
          { label: '合并两页', type: 'merge' },
          { label: '忽略', type: 'reject' },
          { label: '调研', type: 'research' },
        ],
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        status: 'pending',
      });
      continue;
    }
    entityPaths.set(kebab, concept.name);

    const existing = existingPages[path];
    const isNew = !existing;
    if (isNew) newConcepts++; else updatedConcepts++;

    const parsed = existing ? parsePage(existing) : { frontmatter: {}, body: '' };

    let newConfidence: WikiFrontmatter['confidence'];
    if (forcedLow.has(concept.name.toLowerCase()) || forcedLow.has(kebab)) {
      newConfidence = 'low';
    } else if ((parsed.frontmatter.sources ?? []).length + 1 >= 2) {
      newConfidence = 'high';
    } else {
      newConfidence = 'medium';
    }

    const fm: WikiFrontmatter = {
      title: parsed.frontmatter.title && parsed.frontmatter.title !== concept.name ? parsed.frontmatter.title : concept.name,
      type: parsed.frontmatter.type ?? 'concept',
      sources: union(parsed.frontmatter.sources ?? [], [sourcePath]),
      tags: union(parsed.frontmatter.tags ?? [], []),
      created: parsed.frontmatter.created ?? today,
      updated: today,
      confidence: forcedLow.has(concept.name.toLowerCase()) || forcedLow.has(kebab)
        ? 'low' as const
        : minConfidence(parsed.frontmatter.confidence ?? newConfidence, newConfidence),
      related: union(parsed.frontmatter.related ?? [], []),
    };

    const updateSection = isNew
      ? `# ${concept.name}\n\n${concept.definition ?? ''}\n`
      : `${parsed.body.trimEnd()}\n\n## Update ${today} (from ${sourcePath})\n\n${concept.definition ?? ''}\n`;

    pages.push({ path, content: serializePage(fm, updateSection) });
    indexEntries.push({ path: path.replace(/\.md$/, ''), title: fm.title, source: sourcePath });
  }

  // Source page (always written, even on empty ingest — C6.a)
  const existingSource = existingPages[sourcePagePath];
  const parsedSource = existingSource ? parsePage(existingSource) : { frontmatter: {}, body: '' };
  const hasContent = analysis.entities.length > 0 || analysis.concepts.length > 0;
  const sourceBody = hasContent
    ? `# ${sourcePath}\n\nEntities: ${analysis.entities.map((e) => e.name).join(', ') || '_none_'}\n\nConcepts: ${analysis.concepts.map((c) => c.name).join(', ') || '_none_'}\n\n${analysis.structureRecommendations.length > 0 ? '## 结构建议\n\n' + analysis.structureRecommendations.map((s) => `- ${s}`).join('\n') : ''}\n`
    : `# ${sourcePath}\n\n本次 ingest 未识别到可结构化的实体或概念。\n\n${analysis.structureRecommendations.length > 0 ? '## 结构建议\n\n' + analysis.structureRecommendations.map((s) => `- ${s}`).join('\n') + '\n' : ''}\n`;

  const sourceFm: WikiFrontmatter = {
    title: sourcePath,
    type: 'source',
    sources: [sourcePath],
    tags: [],
    created: parsedSource.frontmatter.created ?? today,
    updated: today,
    confidence: hasContent ? 'medium' : 'low',
    related: [],
  };
  pages.push({ path: sourcePagePath, content: serializePage(sourceFm, sourceBody) });
  indexEntries.push({ path: sourcePagePath.replace(/\.md$/, ''), title: sourcePath });

  const logStats: IngestLogStats = {
    newEntities,
    updatedEntities,
    newConcepts,
    updatedConcepts,
    contradictions: contradictions.length,
  };

  return { pages, indexEntries, logStats, contradictions, collisions };
}

// Helper for the ingest service: apply a WritePlan to the provider.
export function applyIndexAndLog(
  indexContent: string,
  logContent: string,
  sourcePath: string,
  plan: WritePlan,
): { index: string; log: string } {
  const index = appendIndexEntries(indexContent, plan.indexEntries);
  const log = appendIngestLogEntry(logContent, TODAY(), sourcePath, plan.logStats);
  return { index, log };
}
