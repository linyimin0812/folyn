/**
 * Lazily-loaded DBML parser module — @dbml/core is ~15MB (bundles antlr4 SQL
 * parsers) so we dynamic-import it only when an ER preview is first opened,
 * keeping first-paint of the rest of the app untouched.
 */
type DbmlModule = {
  Parser: { parse: (str: string, format: string) => DbmlDatabase };
  CompilerError: new (diags: DbmlDiagnostic[]) => Error;
};

interface DbmlPosition {
  line: number;
  column: number;
  offset?: number;
}
interface DbmlDiagnostic {
  message: string;
  location: { start: DbmlPosition; end?: DbmlPosition };
  type?: string;
}
interface DbmlDatabase {
  export(): DbmlRawDatabase;
  // Project-level fields are direct properties on the Database instance,
  // not part of export() output (see `shallowExport` in @dbml/core types).
  name: string;
  databaseType: string;
  note: string;
}
interface DbmlRawDatabase {
  schemas: DbmlRawSchema[];
}
interface DbmlRawSchema {
  name: string;
  tables: DbmlRawTable[];
  refs: DbmlRawRef[];
  enums: DbmlRawEnum[];
}
interface DbmlRawTable {
  name: string;
  alias: string | null;
  note: string;
  fields: DbmlRawField[];
  indexes: DbmlRawIndex[];
  headerColor?: string;
}
interface DbmlRawField {
  name: string;
  type: { type_name: string; args: string | null };
  pk?: boolean;
  unique?: boolean;
  not_null?: boolean;
  increment?: boolean;
  note?: string;
  dbdefault?: { type: string; value: string | number };
}
interface DbmlRawIndex {
  name: string | null;
  unique?: boolean;
  columns: { type: string; value: string }[];
  note?: string;
}
interface DbmlRawRef {
  name: string | null;
  endpoints: { tableName: string; fieldNames: string[]; relation: '1' | '*' }[];
}
interface DbmlRawEnum {
  name: string;
  note: string;
  values: { name: string; note: string }[];
}

let modulePromise: Promise<DbmlModule> | null = null;
async function loadParser(): Promise<DbmlModule> {
  if (!modulePromise) {
    // Vite dynamic import — @dbml/core is in apps/desktop deps.
    modulePromise = import('@dbml/core') as unknown as Promise<DbmlModule>;
  }
  return modulePromise;
}

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
  // ponytail: defaults (zoomPct=100, showGrid=false) are omitted from the
  // emitted JSON so a freshly-opened diagram with no adjustments writes no
  // meta block. Round-trip stable for the common case.
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

export interface ErField {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  increment: boolean;
  note?: string;
}
export interface ErIndex {
  name: string | null;
  unique: boolean;
  columns: string[];
  note?: string;
}
export interface ErTable {
  kind: 'table';
  name: string;
  fields: ErField[];
  headerColor?: string;
  note?: string;
  indexes: ErIndex[];
}
export interface ErEnumValue {
  name: string;
  note?: string;
}
export interface ErEnum {
  kind: 'enum';
  name: string;
  note?: string;
  values: ErEnumValue[];
}
export type ErCard = ErTable | ErEnum;
export interface ErRef {
  id: string;
  fromTable: string;
  fromFields: string[];
  toTable: string;
  toFields: string[];
  /** cardinality label like '1:*' | '1:1' | '*:*' */
  cardinality: string;
}
export interface ErSchema {
  tables: ErTable[];
  enums: ErEnum[];
  refs: ErRef[];
  projectName?: string;
  databaseType?: string;
  projectNote?: string;
}
export interface ErParseError {
  line: number;
  column: number;
  message: string;
}
export interface ParseResult {
  schema?: ErSchema;
  errors: ErParseError[];
}

function formatType(t: { type_name: string; args: string | null }): string {
  // @dbml/core's export() already folds args into type_name (e.g. "varchar(255)");
  // only append args when type_name is a bare identifier.
  if (t.args && !t.type_name.includes('(')) {
    return `${t.type_name}(${t.args})`;
  }
  return t.type_name;
}

export async function parseDbml(source: string): Promise<ParseResult> {
  // Strip persisted style meta block before parsing — @dbml/core's antlr4
  // parser doesn't recognize HTML comments and would emit spurious errors.
  const { dbml } = extractDbmlMeta(source);
  if (!dbml.trim()) {
    return { schema: { tables: [], enums: [], refs: [] }, errors: [] };
  }
  try {
    const mod = await loadParser();
    const db = mod.Parser.parse(dbml, 'dbml');
    const raw = db.export().schemas[0] ?? { tables: [], refs: [], enums: [] };

    const tables: ErTable[] = raw.tables.map((t) => ({
      kind: 'table',
      name: t.name,
      fields: t.fields.map<ErField>((f) => ({
        name: f.name,
        type: formatType(f.type),
        pk: !!f.pk,
        unique: !!f.unique,
        notNull: !!f.not_null,
        increment: !!f.increment,
        note: f.note || undefined,
      })),
      headerColor: t.headerColor || undefined,
      note: t.note || undefined,
      indexes: (t.indexes ?? []).map<ErIndex>((ix) => ({
        name: ix.name ?? null,
        unique: !!ix.unique,
        columns: (ix.columns ?? []).map((c) => c.value),
        note: ix.note || undefined,
      })),
    }));

    const enums: ErEnum[] = (raw.enums ?? []).map<ErEnum>((e) => ({
      kind: 'enum',
      name: e.name,
      note: e.note || undefined,
      values: (e.values ?? []).map((v) => ({
        name: v.name,
        note: v.note || undefined,
      })),
    }));

    const refs: ErRef[] = raw.refs.map((r, i) => {
      const ep = r.endpoints;
      const a = ep[0];
      const b = ep[1] ?? a;
      return {
        id: `ref-${i}`,
        fromTable: a.tableName,
        fromFields: a.fieldNames,
        toTable: b.tableName,
        toFields: b.fieldNames,
        cardinality: `${a.relation}:${b.relation}`,
      };
    });

    return {
      schema: {
        tables,
        enums,
        refs,
        projectName: db.name || undefined,
        databaseType: db.databaseType || undefined,
        projectNote: db.note || undefined,
      },
      errors: [],
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'diags' in err) {
      const diags = (err as { diags: DbmlDiagnostic[] }).diags ?? [];
      const errors: ErParseError[] = diags.map((d) => ({
        line: d.location?.start?.line ?? 0,
        column: d.location?.start?.column ?? 0,
        message: d.message || `Schema error at line ${d.location?.start?.line ?? 0}`,
      }));
      if (errors.length === 0) {
        errors.push({ line: 0, column: 0, message: 'DBML 解析失败' });
      }
      return { errors };
    }
    return {
      errors: [
        { line: 0, column: 0, message: err instanceof Error ? err.message : '解析失败' },
      ],
    };
  }
}
