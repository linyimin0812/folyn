# Research: @dbml/core API Usage

- **Query**: 如何在 React + TypeScript 项目里用 @dbml/core 解析 .dbml 文件字符串，得到结构化 schema（tables/columns/refs/enums/indexes），用于 d3-force 自绘 ER 图
- **Scope**: external (npm 包 + 官方类型声明 + 运行时验证)
- **Date**: 2026-07-03
- **验证方式**: 在 `/tmp/dbml-inspect` 安装 `@dbml/core@8.3.1`，阅读 `types/**/*.d.ts`，并运行 `node test.mjs` 实测 `Parser.parse` 输出与错误结构。以下结论均来自源码类型声明 + 运行时实测，非凭记忆。

---

## 1. 包名与安装

### 官方包

| 项 | 值 |
|---|---|
| 包名 | `@dbml/core`（scoped，官方 Holistics 团队维护） |
| 仓库 | https://github.com/holistics/dbml （npm `repository` 字段指向 dbml.dbdiagram.io） |
| License | Apache-2.0 |
| 类型声明 | **自带**，`types/index.d.ts`，`exports["."].types` 指向它，TS 开箱即用 |
| 入口 | `main: ./lib/index.cjs`，`module: ./lib/index.mjs`，`exports` 同时提供 import/require |
| 依赖 | `@dbml/parse`（内部拆分出的解析核心）、`antlr4`、`lodash`/`lodash-es`、`luxon`、`parsimmon`、`pluralize` |

### 版本现状（重要）

- `dist-tags.latest = 9.0.0-alpha.2`（**npm install @dbml/core 默认装到 alpha**，因为 Holistics 把 latest 指向了 alpha）
- 最近一个**稳定**版本：`8.3.1`（8.x 系列稳定线）
- 3.x 系列也是稳定旧线（最后 `3.14.1`）
- **建议**：显式 pin `@dbml/core@8.3.1`（或 `^8.3.1`），不要裸 `@dbml/core`，否则会装到 9.0.0-alpha。

### 替代包

- `@dbml/parser` → **404 不存在**（npm 查不到；它实际是 `@dbml/core` 的内部子依赖 `@dbml/parse`，不单独发布为 `@dbml/parser`）
- `dbml-parser` → **404 不存在**
- 结论：`@dbml/core` 是唯一官方维护的 DBML 解析入口。`@dbml/parse` 是它内部用的，不必直接依赖。

---

## 2. 解析 API

### 核心函数：`Parser.parse(str, format)` —— 同步

来自 `types/parse/Parser.d.ts`：

```ts
declare class Parser {
  static parse(str: string, format: ParseFormat): Database;   // 推荐
  static parse(str: RawDatabase, format: 'json'): Database;
  static parseDBMLToJSONv2(str: string): RawDatabase;          // 只到中间 JSON，不构 Database 对象
  // 还有 mysql/postgres/mssql/snowflake/oracle/schemarb 等格式
  parse(str: string, format: ParseFormat): Database;           // 实例方法，等价
}
// ParseFormat = 'dbml' | 'dbmlv2' | 'json' | 'mysql' | 'postgres' | 'mssql' | 'snowflake' | 'oracle' | 'schemarb' | ...
```

- **同步**，返回 `Database` 对象（不是 Promise）。
- DBML v2 语法用 `format: 'dbml'`（内部等同 `'dbmlv2'`）。
- 还有 `Parser.parseDBMLToJSONv2(str)` 只解析到 `RawDatabase`（中间 JSON 结构），若你要更原始的数据可用，但通常用 `parse(str, 'dbml')` 拿 `Database` 对象更方便（已建好 table/field/ref 引用关系）。

### 最小调用

```ts
import { Parser } from '@dbml/core';

const dbmlStr = `Table users {
  id integer [pk, increment]
  name varchar [not null]
}`;

const db = Parser.parse(dbmlStr, 'dbml');   // Database
const schema = db.schemas[0];               // 默认 schema 'public'
const tables = schema.tables;               // Table[]
```

---

## 3. 输出数据结构

> 以下字段来自 `types/model_structure/*.d.ts` 并经运行时实测确认。注意：实例属性里有不少内部字段（`dbState`/`token`/`id` 等），**作图时只看下面列出的语义字段即可**。若要拿到纯净的可序列化 JSON，调用 `db.export()`（见末尾）。

### 顶层 `Database`（`database.d.ts`）

```
Database
├── schemas: Schema[]          // 通常 1 个，名为 'public'
├── notes: StickyNote[]
├── schemas[0] = Schema
│   ├── name: string           // 'public'
│   ├── alias: string
│   ├── note: string
│   ├── tables: Table[]
│   ├── refs: Ref[]            // 注意：refs 挂在 schema 上，不是 database
│   ├── enums: Enum[]
│   └── tableGroups: TableGroup[]
```

实测：即使 DBML 里没写 `Project`，`Parser.parse` 也会自动给一个 `name='public'` 的默认 schema。`db.schemas[0]` 是最常用入口。

### `Table`（`table.d.ts`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 表名 |
| `alias` | `string \| null` | `Table users as u {...}` 的别名 |
| `note` | `string` | 表注释 |
| `fields` | `Field[]` | 列 |
| `indexes` | `Index[]` | 索引 |
| `checks` | `Check[]` | 约束 |
| `headerColor` | `Color` | 表头颜色（`#ffffff` 语法） |
| `schema` | `Schema` | 反向引用 |
| `group` | `TableGroup` | 所属分组 |

### `Field`（列，`field.d.ts`）—— 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 列名 |
| `type` | `{ schemaName: string\|null, type_name: string, args: string\|null }` | 类型，如 `{type_name:'varchar', args:'255'}` |
| `pk` | `boolean` | 主键 |
| `unique` | `boolean` | 唯一 |
| `not_null` | `boolean` | 非空（注意下划线命名） |
| `increment` | `boolean` | 自增 |
| `dbdefault` | `{ type: 'number'\|'string'\|'boolean'\|'expression', value } \| undefined` | 默认值 |
| `note` | `string` | 列注释 |
| `endpoints` | `Endpoint[]` | 该列参与的 ref 端点（可据此反查外键） |
| `_enum` | `Enum` | 若类型是 enum，指向 Enum 对象 |

实测：未设置的布尔字段可能是 `undefined`（不是 `false`），作图时用 `!!f.pk` 兜底。

### `Ref`（外键关系，`ref.d.ts` + `endpoint.d.ts`）—— 关键

```
Ref
├── name: string | null
├── endpoints: Endpoint[]   // 长度 2，表示两端
│   ├── schemaName: string | null
│   ├── tableName: string
│   ├── fieldNames: string[]      // 支持复合外键（多列）
│   ├── fields: Field[]           // 解析后的 Field 引用
│   └── relation: '1' | '*'       // ★ 基数标记
├── onDelete: string | undefined
├── onUpdate: string | undefined
└── inactive?: boolean
```

#### DBML 关系运算符 → 输出 `relation` 映射（实测确认）

DBML 语法用 4 个运算符表示基数，**不是** `[1:*]` 方括号语法（`[1:*]` 在 8.3.1 会报语法错误）：

| DBML 语法 | 含义 | ep0.relation | ep1.relation |
|---|---|---|---|
| `Ref: A.x > B.y` | 一对多（B.y 是 1，A.x 是 *） | `'1'`（B.y） | `'*'`（A.x） |
| `Ref: A.x < B.y` | 一对多（A.x 是 1，B.y 是 *） | `'1'`（A.x） | `'*'`（B.y） |
| `Ref: A.x - B.y` | 一对一 | `'1'` | `'1'` |
| `Ref: A.x <> B.y` | 多对多 | `'*'` | `'*'` |

注意：`>` / `<` 的两端会被重排，**ep0 永远是 `relation='1'` 的那一端，ep1 永远是 `relation='*'` 的那一端**。画 ER 图时直接读 `ep.relation` 即可，不必关心运算符方向。

DBML 也支持**内联 ref**：`user_id integer [ref: > users.id]`，效果等同显式 `Ref:`，会同样进入 `schema.refs`。

#### 关于 `[1:1]` `[1:*]` 方括号基数语法

8.3.1 **不支持**。实测 `Ref: orders.user_id > users.id [1:*]` 报错：`Expected "delete:", "update:", comment, or whitespace but "1" found.`（方括号里只允许 `delete:`/`update:` 等设置，不允许基数）。基数完全由运算符表达。9.0.0-alpha 可能引入了 "optional ref" 相关特性（见 `9.0.0-optional-ref.x` dist-tag），但稳定版请用运算符。

### `Enum`（`enum.d.ts`）

```
Enum
├── name: string
├── note: string
└── values: EnumValue[]
    ├── name: string
    └── note: string
```

### `Index`（`indexes.d.ts` + `indexColumn.d.ts`）

```
Index
├── name: string | null
├── unique: boolean
├── type: any          // 索引类型，如 'hash'/'btree'，未设则 undefined
├── pk: string         // 是否主键索引
├── note: string
└── columns: IndexColumn[]
    ├── type: 'column' | 'expression'   // 'column' = 普通列, 'expression' = 计算列
    └── value: string                   // 列名 或 表达式文本
```

实测复合索引 `(total, id)` → `columns: [{type:'column',value:'total'},{type:'column',value:'id'}]`。

### `Project` / `TableGroup` / `StickyNote`

- `Project` 块：`Project name { database_type: 'PostgreSQL', Note: '...' }`。解析后存在 `db.schemas` 之外，不影响作图主体。
- `TableGroup`：`TableGroup name { tableA, tableB }` → `schema.tableGroups[].tables[] = {tableName, schemaName}`。
- `StickyNote`：`Note sticky_name { 'content' }` → `db.notes[]`。

### 纯净 JSON：`db.export()`

`Database` 和各模型类都有 `export()` 方法，返回**可 `JSON.stringify` 的纯对象**（去掉 token/dbState 等内部字段）。结构见 `database.d.ts` 的 `export()` 返回类型。对作图来说，用 `db.export().schemas[0]` 拿到 `{name, tables:[...], refs:[...], enums:[...]}` 即可，比直接遍历类实例更安全（无循环引用）。

`export()` 输出的 ref 结构：
```ts
refs: [{
  endpoints: [{ schemaName, tableName, fieldNames: string[], relation: '1'|'*' }, { ... }],
  name, onDelete, onUpdate
}]
```

---

## 4. 错误处理

### 抛异常，不返回错误对象

`Parser.parse` 解析失败时**抛出 `CompilerError`**（`types/parse/error.d.ts`）。`CompilerError` 类：

```ts
class CompilerError {
  diags: CompilerDiagnostic[];
  constructor(diags: CompilerDiagnostic[]);
}
interface CompilerDiagnostic {
  message: string;            // 人类可读错误信息
  filepath?: string;
  location: { start: EditorPosition; end?: EditorPosition };  // 行列号
  type?: 'error' | 'warning' | 'info';
  code?: number;
  // parsimmon 语法错误额外带 expected/found/name
}
interface EditorPosition { line: number; column: number; }
```

### 两类错误（实测）

1. **语法错误**（parsimmon 抛）：`diags[0]` 形如
   ```json
   {
     "message": "Expected \",\", \"]\", comment, or whitespace but \"}\" found.",
     "expected": [...], "found": "}",
     "location": { "start": { "offset": 25, "line": 1, "column": 26 }, "end": {...} },
     "name": "SyntaxError"
   }
   ```
   有 `message`、`location.start.line/column`、`found`，UI 友好展示足够。

2. **语义错误**（如重复定义、未定义表引用）：`diags[0]` 形如
   ```json
   { "location": { "start": {...}, "end": {...} }, "error": "error" }
   ```
   注意这类 **`message` 可能为空**，只有 `location` 和 `type:'error'`。UI 展示时需 fallback 到 "Schema error at line X"。

### 捕获方式

```ts
import { Parser, CompilerError } from '@dbml/core';
try {
  const db = Parser.parse(str, 'dbml');
} catch (err) {
  if (err instanceof CompilerError) {
    const diags = err.diags;   // CompilerDiagnostic[]
    // 取第一个有 message 的展示
  } else throw err;            // 非 DBML 错误，重新抛
}
```

注意：`err.message` 是 `undefined`（CompilerError 没设 message 属性），**必须读 `err.diags[i].message`**。

---

## 5. DBML 语法速览（供测试用例 / 模板）

实测通过的完整示例：

```dbml
Project myapp {
  database_type: 'PostgreSQL'
  Note: 'My application schema'
}

Enum job_status {
  active
  inactive [note: 'no longer employed']
}

Table users [headercolor: #f0f0f0] {
  id integer [pk, increment]         // 主键 + 自增
  name varchar(255) [not null, unique]
  status job_status [not null]      // 引用 enum
  created_at timestamp [default: `now()`]
  note: 'Application users'         // 表注释

  Indexes {
    (name) [name: 'idx_users_name', unique]
    (status, created_at) [name: 'idx_users_status']
  }
}

Table orders {
  id integer [pk, increment]
  user_id integer [not null, ref: > users.id]   // 内联 ref：> 表示 users 是 1 端
  total numeric(10,2) [not null]

  Indexes {
    (user_id) [name: 'idx_orders_user']
  }
}

// 显式 ref（与内联 ref 二选一，不要重复）
// Ref: orders.user_id > users.id [delete: cascade, update: no action]

TableGroup commerce {
  orders
}

Note desc_note {
  'A sticky note on canvas'
}
```

### 语法要点（实测踩坑）

- **字段必须换行分隔**，不能写 `Table t { id int [pk] }` 单行（报 `Expected " ", comment, or newline but "}" found.`）。
- 默认值表达式用反引号：`` [default: `now()`] ``；字符串字面量用单引号：`[default: 'active']`；数字直接写：`[default: 0]`。
- 注释：`// 行注释` 和 `/* 块注释 */` 都支持。
- 关系运算符只有 `>` `<` `-` `<>` 四种，方括号 `[1:*]` 基数语法稳定版不支持。
- `ref:` 内联语法：`col_name type [ref: > other.other_id]`。
- 复合外键：`Ref: (t1.a, t1.b) > (t2.a, t2.b)`，`endpoint.fieldNames` 会是数组。

---

## 6. 浏览器 / Tauri webview 注意事项

### 纯 JS，无 Node 原生依赖

实测 `Parser.parse(str, 'dbml')` 路径**不调用 fs / path / crypto 等 Node 模块**，纯 JS 可在浏览器/webview 跑。依赖里 `antlr4` 是纯 JS（ANTLR4 runtime for JS），`parsimmon`/`lodash`/`luxon`/`pluralize` 也都是纯 JS。

注意：`Parser.parseDbmlProject(filepath)`（实例方法，读文件）需要 fs，**不要在 webview 用它**；只用静态 `Parser.parse(str, 'dbml')` 即可，文件读取交给 Tauri Rust 侧读完字符串再传入。

### 打包体积（重要）

实测 esbuild `--bundle --minify --format=esm`：

| 输出 | 大小 |
|---|---|
| 总 minified bundle | **~15 MB** |
| 其中 `@dbml/core/lib/index.mjs` | 14.6 MB（97.5%） |
| 其中 `@dbml/parse/dist/dbml-parse.mjs` | 382 KB |
| gzip 后估算 | ~3-4 MB（antlr4 生成代码占比大） |

体积来源主要是 **antlr4 生成的 SQL 解析器代码**（MySQL/Postgres/MSSQL/Oracle/Snowflake 五套 SQL parser 全打进去了），即使你只用 DBML 解析也会全量打包。

`package.json` 没有 `browser` 字段、没有 `sideEffects` 标记、没有 `browserslist`，无法靠 tree-shaking 去掉 SQL parser（DBML 解析走的是 parsimmon，但 bundle 仍把 antlr4 那套全带上）。

### 体积应对建议（供决策，非评价）

- Tauri webview 加载本地资源不走网络，15MB 对首次解析延迟和内存有影响但可接受（一次性加载后驻留）。
- 若体积敏感，可考虑：把 DBML 解析放到 **Tauri Rust 侧或 Node sidecar**（用 `dbml-rs` 或调 `@dbml/core` 子进程），主进程返回 JSON；webview 只画图。这样 webview 不背 15MB。
- 若坚持 webview 内解析，建议 lazy import（`await import('@dbml/core')`）放在打开 ER 图时再加载，避免拖慢首屏。

### luxon 时区

`luxon` 在浏览器可能警告 `Intl.DateTimeFormat` 不可用，但 DBML 解析路径基本不触发 luxon（luxon 主要给 SQL 的日期字面量用）。实测未报错。

---

## 7. 可直接用于 React 组件的最小解析代码

```tsx
import { Parser, CompilerError, type Database } from '@dbml/core';

export interface ParsedSchema {
  tables: Array<{
    name: string;
    alias: string | null;
    note: string;
    fields: Array<{
      name: string;
      type: { type_name: string; args: string | null };
      pk: boolean;
      unique: boolean;
      not_null: boolean;
      increment: boolean;
      note: string;
      dbdefault?: { type: string; value: string | number };
    }>;
    indexes: Array<{
      name: string | null;
      unique: boolean;
      columns: Array<{ type: string; value: string }>;
    }>;
  }>;
  refs: Array<{
    name: string | null;
    endpoints: Array<{
      tableName: string;
      fieldNames: string[];
      relation: '1' | '*';
    }>;
  }>;
  enums: Array<{
    name: string;
    values: Array<{ name: string; note: string }>;
  }>;
}

export interface ParseError {
  line: number;
  column: number;
  message: string;
}

export function parseDbml(source: string): { schema?: ParsedSchema; errors: ParseError[] } {
  try {
    const db: Database = Parser.parse(source, 'dbml');
    // 用 export() 拿纯 JSON，避免类实例的循环引用
    const raw = db.export();
    const s = raw.schemas[0];
    const schema: ParsedSchema = {
      tables: s.tables.map(t => ({
        name: t.name,
        alias: t.alias,
        note: t.note,
        fields: t.fields.map(f => ({
          name: f.name,
          type: { type_name: f.type.type_name, args: f.type.args ?? null },
          pk: !!f.pk,
          unique: !!f.unique,
          not_null: !!f.not_null,
          increment: !!f.increment,
          note: f.note,
          dbdefault: f.dbdefault,
        })),
        indexes: t.indexes.map(i => ({
          name: i.name,
          unique: !!i.unique,
          columns: i.columns.map(c => ({ type: c.type, value: c.value })),
        })),
      })),
      refs: s.refs.map(r => ({
        name: r.name,
        endpoints: r.endpoints.map(ep => ({
          tableName: ep.tableName,
          fieldNames: ep.fieldNames,
          relation: ep.relation as '1' | '*',
        })),
      })),
      enums: s.enums.map(e => ({
        name: e.name,
        values: e.values.map(v => ({ name: v.name, note: v.note })),
      })),
    };
    return { schema, errors: [] };
  } catch (err) {
    if (err instanceof CompilerError) {
      const errors: ParseError[] = err.diags.map(d => ({
        line: d.location.start.line,
        column: d.location.start.column,
        message: d.message || `Schema error at line ${d.location.start.line}`,
      }));
      return { errors };
    }
    // 非 DBML 错误，向上抛
    throw err;
  }
}

// 使用：
// const { schema, errors } = parseDbml(fileContent);
// if (errors.length) setErrors(errors); else drawErDiagram(schema);
```

### 给 d3-force 的数据映射提示

- 节点（`d3.forceManyBody` 等）：`schema.tables`，每个 table 一个节点，`id = table.name`。
- 连边（`d3.forceLink`）：`schema.refs`，每条 ref 一条边；`source = ref.endpoints[0].tableName`，`target = ref.endpoints[1].tableName`。复合外键共享一条边。
- 基数标签：`endpoints[0].relation + '—' + endpoints[1].relation`（如 `1—*`、`1—1`、`*—*`），画在边两端。
- 列级高亮：`field.endpoints`（实例属性，非 export() 里）可反查某列是否参与外键；若用 export() 则查 `refs[].endpoints[].fieldNames` 是否包含该列名。

---

## Caveats / Not Found

1. **未验证 9.0.0-alpha.2**：只测了稳定版 8.3.1。9.x alpha 可能引入 optional ref、cardinality 方括号语法等，但 API 不稳定，生产别用。如需新特性，等 9.x 正式 release 再评估。
2. **dbml.org 官方文档未抓取**：环境禁用 curl，无 WebFetch 工具；以上结论全部来自 npm 包内 `types/*.d.ts` 类型声明 + 运行时实测，比官方文档更准确（文档可能滞后）。README 指向 https://dbml.dbdiagram.io/js-module/core 作为 API 参考，可作为补充阅读。
3. **`export()` 的 `field.type` 在 export 输出里是 `any`**：类型声明里 `export()` 返回的 `type` 标为 `any`，但实测运行时仍是 `{schemaName, type_name, args}` 对象，可放心按此结构读取。
4. **`export()` 不含 `checks` / `tableGroups` 的部分字段**：若你需要 check 约束，需直接访问 `Table` 实例的 `checks` 属性而非 `export()`。
5. **bundle 体积未尝试用 `@dbml/parse` 直接瘦身**：理论上 `@dbml/parse` 是 DBML 解析的子模块，但它是内部包，没有公开文档说明其稳定 API，直接用风险高。建议先用 `@dbml/core`，体积实在不能接受再研究 `@dbml/parse`。
