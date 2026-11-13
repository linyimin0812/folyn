/**
 * The DBML style-meta block (`<!-- dbml:meta ... -->`): drag positions, zoom
 * and grid, persisted at the end of the file. Pure — no @dbml/core — so the
 * host bundle (the editor's status button) can read the block without loading
 * the antlr4 parser, which stays in the preview iframe.
 */

// ponytail: persisted ER preview style (drag positions, zoom, grid) round-trips
// via a trailing `<!-- dbml:meta ... -->` block at end of file, mimicking the
// mmap mind-map pattern. Stripped before @dbml/core parses so the antlr4
// parser never sees HTML comments (not standard DBML syntax). The block is
// optional and only emitted when at least one style differs from defaults,
// so existing .dbml files round-trip identically.
//
// Ceilings (upgrade path):
//   - Positions keyed by table NAME; renaming a table in the source orphans
//     its entry, silently dropped on next serialize. Matches mmap's topic-
//     text ceiling. Upgrade: inline `#id:xxx` suffix on table defs.
//   - JSON directives are single-line; a `-->` inside a JSON value would
//     prematurely end the block — not a concern for the {x,y}/bool/number
//     values we serialize here.
export interface DbmlNodePosition { x: number; y: number; }
export interface DbmlViewStyle {
  // ponytail: defaults (zoomPct=100, showGrid=false, pan={0,0}) are omitted
  // from the emitted JSON so a freshly-opened diagram with no adjustments
  // writes no meta block. Round-trip stable for the common case.
  zoomPct?: number;
  showGrid?: boolean;
  pan?: { x: number; y: number };
}
export interface DbmlMeta {
  positions: Record<string, DbmlNodePosition>;
  view?: DbmlViewStyle;
}
const META_START = '<!-- dbml:meta';
const META_END = '-->';

function emptyMeta(): DbmlMeta {
  return { positions: {} };
}

export function extractDbmlMeta(content: string): { dbml: string; meta: DbmlMeta | undefined } {
  const startIdx = content.indexOf(META_START);
  if (startIdx < 0) return { dbml: content, meta: undefined };
  const endIdx = content.indexOf(META_END, startIdx + META_START.length);
  if (endIdx < 0) return { dbml: content, meta: undefined };
  const block = content.slice(startIdx + META_START.length, endIdx);
  const dbml = (content.slice(0, startIdx) + content.slice(endIdx + META_END.length)).replace(/\s+$/, '');
  return { dbml, meta: parseMetaBlock(block) };
}

function parseMetaBlock(block: string): DbmlMeta {
  const meta = emptyMeta();
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const posLine = line.match(/^positions:\s*(\{.*\})\s*$/);
    if (posLine) {
      try {
        const parsed = JSON.parse(posLine[1]) as Record<string, DbmlNodePosition>;
        if (parsed && typeof parsed === 'object') meta.positions = { ...meta.positions, ...parsed };
      } catch { /* malformed — skip */ }
      continue;
    }
    const viewLine = line.match(/^view:\s*(\{.*\})\s*$/);
    if (viewLine) {
      try {
        const parsed = JSON.parse(viewLine[1]) as DbmlViewStyle;
        if (parsed && typeof parsed === 'object') meta.view = { ...meta.view, ...parsed };
      } catch { /* malformed — skip */ }
      continue;
    }
    // unrecognized directive — skip silently (forward-compat).
  }
  return meta;
}

export function serializeDbmlMeta(meta: DbmlMeta): string {
  const lines: string[] = [];
  if (Object.keys(meta.positions).length > 0) {
    lines.push(`positions: ${JSON.stringify(meta.positions)}`);
  }
  if (meta.view && Object.keys(meta.view).length > 0) {
    lines.push(`view: ${JSON.stringify(meta.view)}`);
  }
  if (lines.length === 0) return '';
  return `${META_START}\n${lines.join('\n')}\n${META_END}`;
}

/** Strip meta block + re-emit content with the given meta appended. */
export function withDbmlMeta(dbmlText: string, meta: DbmlMeta): string {
  const block = serializeDbmlMeta(meta);
  if (!block) return dbmlText;
  return `${dbmlText.replace(/\s+$/, '')}\n\n${block}`;
}
