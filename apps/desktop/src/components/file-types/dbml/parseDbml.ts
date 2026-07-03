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
}
interface DbmlRawRef {
  name: string | null;
  endpoints: { tableName: string; fieldNames: string[]; relation: '1' | '*' }[];
}
interface DbmlRawEnum {
  name: string;
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

export interface ErField {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  increment: boolean;
}
export interface ErTable {
  name: string;
  fields: ErField[];
  headerColor?: string;
}
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
  refs: ErRef[];
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
  if (!source.trim()) {
    return { schema: { tables: [], refs: [] }, errors: [] };
  }
  try {
    const mod = await loadParser();
    const db = mod.Parser.parse(source, 'dbml');
    const raw = db.export().schemas[0] ?? { tables: [], refs: [], enums: [] };

    const tables: ErTable[] = raw.tables.map((t) => ({
      name: t.name,
      fields: t.fields.map<ErField>((f) => ({
        name: f.name,
        type: formatType(f.type),
        pk: !!f.pk,
        unique: !!f.unique,
        notNull: !!f.not_null,
        increment: !!f.increment,
      })),
      headerColor: t.headerColor || undefined,
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

    return { schema: { tables, refs }, errors: [] };
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
