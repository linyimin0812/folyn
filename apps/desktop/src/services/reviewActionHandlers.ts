// ponytail: D1.b action handler dispatch. Map<checkId, ActionHandler>.
// Each handler returns a write plan (or null) + status change. Staging writer (B5.y) applies the plan.

import type { ReviewItem, WikiFrontmatter } from '@/types/wiki';
import { wikiProvider } from './wikiProvider';
import { parsePage, serializePage } from './wikiPageWriter';
import { applyAtomicBatch, type StagedWrite } from './wikiStagingWriter';
import { appendIndexEntries, appendIngestLogEntry, appendMergeLogEntry, type IndexEntry } from '@/utils/wikiNaming';

const TODAY = () => new Date().toISOString().split('T')[0]!;

export interface ActionResult {
  applied: boolean;
  log: string;
  writes?: StagedWrite[];
}

export interface ActionHandler {
  accept?(item: ReviewItem): Promise<ActionResult>;
  reject?(item: ReviewItem): Promise<ActionResult>;
  merge?(item: ReviewItem, keptPath: string): Promise<ActionResult>;
  research?(item: ReviewItem): Promise<ActionResult>;
}

// ---- Helpers ----

async function readPage(path: string): Promise<string | null> {
  try { return await wikiProvider.readFile(path); } catch { return null; }
}

async function writePlanFromPages(pages: { path: string; content: string }[]): Promise<ActionResult> {
  const writes: StagedWrite[] = pages.map((p) => ({ path: p.path, content: p.content }));
  const res = await applyAtomicBatch(writes);
  return { applied: res.applied, log: res.log, writes };
}

// ---- Handlers by checkId ----

const missingPageHandler: ActionHandler = {
  accept: async (item) => {
    const pagePath = item.affectedPages[0];
    if (!pagePath) return { applied: false, log: 'no affected page' };
    const finalPath = pagePath.endsWith('.md') ? pagePath : `${pagePath}.md`;
    const fm: WikiFrontmatter = {
      title: pagePath.split('/').pop()!.replace(/\.md$/, ''),
      type: pagePath.startsWith('entities/') ? 'entity' : pagePath.startsWith('concepts/') ? 'concept' : 'source',
      sources: [],
      tags: [],
      created: TODAY(),
      updated: TODAY(),
      confidence: 'low',
      related: [],
    };
    const body = `# ${fm.title}\n\n_待补充_\n`;
    const content = serializePage(fm, body);
    const res = await applyAtomicBatch([{ path: finalPath, content }]);
    if (!res.applied) return { applied: false, log: res.log };
    // Append to index.md
    const index = await readPage('index.md') ?? '# Wiki Index\n';
    const newIndex = appendIndexEntries(index, [{ path: pagePath.replace(/\.md$/, ''), title: fm.title }]);
    await applyAtomicBatch([{ path: 'index.md', content: newIndex }]);
    return { applied: true, log: `created stub ${finalPath}` };
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const frontmatterInvalidHandler: ActionHandler = {
  accept: async (item) => {
    const path = item.affectedPages[0];
    if (!path) return { applied: false, log: 'no affected page' };
    const raw = await readPage(path);
    if (!raw) return { applied: false, log: `${path} not found` };
    const parsed = parsePage(raw);
    const fm: WikiFrontmatter = {
      title: parsed.frontmatter.title ?? path.split('/').pop()!.replace(/\.md$/, ''),
      type: parsed.frontmatter.type ?? 'entity',
      sources: parsed.frontmatter.sources ?? [],
      tags: parsed.frontmatter.tags ?? [],
      created: parsed.frontmatter.created ?? TODAY(),
      updated: TODAY(),
      confidence: parsed.frontmatter.confidence ?? 'medium',
      related: parsed.frontmatter.related ?? [],
    };
    const content = serializePage(fm, parsed.body);
    return writePlanFromPages([{ path, content }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const sourcesPathInvalidHandler: ActionHandler = {
  accept: async (item) => {
    const pagePath = item.affectedPages[0];
    const invalidPaths = item.affectedPages.slice(1);
    if (!pagePath) return { applied: false, log: 'no page' };
    const raw = await readPage(pagePath);
    if (!raw) return { applied: false, log: `${pagePath} not found` };
    const parsed = parsePage(raw);
    const filtered = (parsed.frontmatter.sources ?? []).filter((s) => !invalidPaths.includes(s));
    const fm: WikiFrontmatter = {
      ...(parsed.frontmatter as Required<WikiFrontmatter>),
      sources: filtered,
      updated: TODAY(),
      confidence: 'low',
    };
    const content = serializePage(fm, parsed.body);
    return writePlanFromPages([{ path: pagePath, content }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const relatedAsymmetricHandler: ActionHandler = {
  accept: async (item) => {
    const [a, b] = item.affectedPages;
    if (!a || !b) return { applied: false, log: 'need two affected pages' };
    const aPath = a.endsWith('.md') ? a : `${a}.md`;
    const bPath = b.endsWith('.md') ? b : `${b}.md`;
    const aRaw = await readPage(aPath);
    const bRaw = await readPage(bPath);
    if (!aRaw || !bRaw) return { applied: false, log: 'page missing' };
    const aParsed = parsePage(aRaw);
    const bParsed = parsePage(bRaw);
    const bRelated = [...new Set([...(bParsed.frontmatter.related ?? []), a.replace(/\.md$/, '')])];
    const bFm: WikiFrontmatter = {
      ...(bParsed.frontmatter as Required<WikiFrontmatter>),
      related: bRelated,
      updated: TODAY(),
    };
    const bContent = serializePage(bFm, bParsed.body);
    return writePlanFromPages([{ path: bPath, content: bContent }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const cacheOrphanHandler: ActionHandler = {
  accept: async (item) => {
    const srcPath = item.affectedPages[0];
    if (!srcPath) return { applied: false, log: 'no source path' };
    const cache = await wikiProvider.readHashCache();
    delete cache[srcPath];
    await wikiProvider.writeHashCache(cache);
    return { applied: true, log: `removed ${srcPath} from cache/hashes.json` };
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const indexMissingPageHandler: ActionHandler = {
  accept: async (item) => {
    const pagePath = item.affectedPages[0];
    if (!pagePath) return { applied: false, log: 'no page' };
    const raw = await readPage(pagePath.endsWith('.md') ? pagePath : `${pagePath}.md`);
    if (!raw) return { applied: false, log: `${pagePath} not found` };
    const parsed = parsePage(raw);
    const index = await readPage('index.md') ?? '# Wiki Index\n';
    const entry: IndexEntry = {
      path: pagePath.replace(/\.md$/, ''),
      title: parsed.frontmatter.title ?? pagePath.split('/').pop()!.replace(/\.md$/, ''),
    };
    const newIndex = appendIndexEntries(index, [entry]);
    return writePlanFromPages([{ path: 'index.md', content: newIndex }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const logMissingIngestHandler: ActionHandler = {
  accept: async (item) => {
    const srcPath = item.affectedPages[0];
    if (!srcPath) return { applied: false, log: 'no source path' };
    const log = await readPage('log.md') ?? '# Wiki Log\n';
    const newLog = appendIngestLogEntry(log, TODAY(), srcPath, {
      newEntities: 0, updatedEntities: 0, newConcepts: 0, updatedConcepts: 0, contradictions: 0,
    });
    return writePlanFromPages([{ path: 'log.md', content: newLog }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const kebabCollisionHandler: ActionHandler = {
  // ponytail: full merge is D5 (agent-driven for body rewrite). For accept (rename), code can do it.
  accept: async (item, _keptPath) => {
    // User must specify which path to keep via UI; for now, mark dismissed and let merge handle.
    return { applied: false, log: 'use merge action for kebab_collision' };
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
  // merge: see D5 — needs agent prompt `merge` action. Stub for now.
  merge: async (item, _keptPath) => {
    return { applied: false, log: 'D5 agent merge prompt not yet implemented' };
  },
};

const semanticDuplicateMergeHandler: ActionHandler = {
  // ponytail: D5 agent merge — not yet wired. Stub.
  merge: async (item, _keptPath) => {
    return { applied: false, log: 'D5 agent merge prompt not yet implemented' };
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const staleContentHandler: ActionHandler = {
  accept: async () => ({ applied: false, log: 're-ingest must be triggered from ingest UI' }),
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const schemaDriftHandler: ActionHandler = {
  accept: async () => ({ applied: false, log: 'schema.md is user-maintained; manual edit required' }),
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const confidenceViolationHandler: ActionHandler = {
  accept: async (item) => {
    const path = item.affectedPages[0];
    if (!path) return { applied: false, log: 'no page' };
    const raw = await readPage(path);
    if (!raw) return { applied: false, log: `${path} not found` };
    const parsed = parsePage(raw);
    const sources = parsed.frontmatter.sources ?? [];
    const newConf = sources.length >= 2 ? 'medium' : 'low';
    const fm: WikiFrontmatter = {
      ...(parsed.frontmatter as Required<WikiFrontmatter>),
      confidence: newConf,
      updated: TODAY(),
    };
    return writePlanFromPages([{ path, content: serializePage(fm, parsed.body) }]);
  },
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

const noopHandler: ActionHandler = {
  accept: async () => ({ applied: false, log: 'handler not yet implemented for this checkId' }),
  reject: async () => ({ applied: true, log: 'marked dismissed' }),
};

export const reviewActionHandlers: Map<string, ActionHandler> = new Map([
  ['missing_page', missingPageHandler],
  ['orphan_page', noopHandler],
  ['stale_content', staleContentHandler],
  ['frontmatter_invalid', frontmatterInvalidHandler],
  ['sources_path_invalid', sourcesPathInvalidHandler],
  ['related_asymmetric', relatedAsymmetricHandler],
  ['schema_drift', schemaDriftHandler],
  ['kebab_collision', kebabCollisionHandler],
  ['confidence_violation', confidenceViolationHandler],
  ['updated_older_than_source_mtime', staleContentHandler],
  ['cache_orphan', cacheOrphanHandler],
  ['index_missing_page', indexMissingPageHandler],
  ['log_missing_ingest', logMissingIngestHandler],
  ['semantic_duplicate_merge_suggestion', semanticDuplicateMergeHandler],
  ['ingest_contradiction', noopHandler],
]);

export async function dispatchReviewAction(
  item: ReviewItem,
  actionType: 'accept' | 'reject' | 'merge' | 'research',
  options: { keptPath?: string } = {},
): Promise<ActionResult> {
  const checkId = item.checkId ?? '';
  const handler = reviewActionHandlers.get(checkId) ?? noopHandler;
  if (actionType === 'accept' && handler.accept) {
    return handler.accept(item);
  }
  if (actionType === 'reject' && handler.reject) {
    return handler.reject(item);
  }
  if (actionType === 'merge' && handler.merge && options.keptPath) {
    return handler.merge(item, options.keptPath);
  }
  if (actionType === 'research' && handler.research) {
    return handler.research(item);
  }
  return { applied: false, log: `action ${actionType} not supported for checkId ${checkId}` };
}
