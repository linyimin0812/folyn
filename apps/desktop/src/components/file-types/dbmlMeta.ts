/**
 * Pure (no @dbml/core) helpers for the DBML style-meta block
 * (`<!-- dbml:meta ... -->`) — kept in the app for the editor status button
 * + export enhancer, which only READ the meta block (drag positions / zoom /
 * grid) without running the antlr4 parser. The heavy @dbml/core parser +
 * @antv/x6 ER render live in the standalone `dbml` extension.
 */

export interface DbmlNodePosition { x: number; y: number; }
export interface DbmlViewStyle {
  zoomPct?: number;
  showGrid?: boolean;
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
