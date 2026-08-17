// ponytail: toKebabCase extracted from wikiIngestService for reuse by writer, lint, query.
// Index/log append formats are the C7 contract — single source of truth.

export function toKebabCase(str: string): string {
  return str
    .replace(/\.\w+$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9一-鿿-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export interface IndexEntry {
  path: string;
  title: string;
  source?: string;
}

export function appendIndexEntries(indexContent: string, entries: IndexEntry[]): string {
  const existing = new Set<string>();
  for (const line of indexContent.split('\n')) {
    const m = line.match(/\[\[wiki:\/\/(.+?)\]\]/);
    if (m) existing.add(m[1]);
  }
  const lines = entries
    .filter((e) => !existing.has(e.path))
    .map((e) => `- [[wiki://${e.path}]] ${e.title}${e.source ? `  _(${e.source})_` : ''}`);
  if (lines.length === 0) return indexContent;
  return indexContent.replace(/\s*$/, '') + '\n' + lines.join('\n') + '\n';
}

export interface IngestLogStats {
  newEntities: number;
  updatedEntities: number;
  newConcepts: number;
  updatedConcepts: number;
  contradictions: number;
}

export function appendIngestLogEntry(
  logContent: string,
  date: string,
  sourcePath: string,
  stats: IngestLogStats,
): string {
  const line = `- ${date} ingest ${sourcePath} → +${stats.newEntities}new / ~${stats.updatedEntities}updated entities, +${stats.newConcepts}new / ~${stats.updatedConcepts}updated concepts, ${stats.contradictions} contradictions`;
  return logContent.replace(/\s*$/, '') + '\n' + line + '\n';
}

export function appendMergeLogEntry(
  logContent: string,
  date: string,
  deletedPath: string,
  keptPath: string,
): string {
  const line = `- ${date} merged ${deletedPath} into ${keptPath}`;
  return logContent.replace(/\s*$/, '') + '\n' + line + '\n';
}
