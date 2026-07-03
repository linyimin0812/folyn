/**
 * toLanguage — language-specific JSON literal serializers.
 *
 * Each function takes a parsed JS value and returns a string that, when
 * evaluated in the target language, produces an equivalent value.
 *
 * These are template-string emitters (~10 lines each); `quicktype` is
 * overkill for per-value literals (it generates types + (de)serializers,
 * not value literals). See research/output-converters.md §5.
 *
 * Conventions:
 *   - Primitives: emit the language's literal syntax (true/false, null,
 *     quoted strings with proper escaping).
 *   - Objects: emit the language's map/dict/object literal syntax.
 *   - Arrays: emit the language's array literal syntax.
 *   - Numbers: emit the raw number (NaN/Infinity become null per JSON
 *     spec; the emitters do not produce NaN).
 */
type Lang = 'python' | 'go' | 'rust' | 'java' | 'php' | 'csharp';

export function toPython(value: unknown): string {
  return `import json\n\nresult = ${pythonEmit(value)}\nprint(json.dumps(result, indent=2, ensure_ascii=False))`;
}

function pythonEmit(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return pythonStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${padInner}${pythonEmit(v, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const items = entries.map(
      ([k, v]) => `${padInner}${pythonStr(k)}: ${pythonEmit(v, indent + 1)}`,
    );
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return 'None';
}

function pythonStr(s: string): string {
  // Python uses triple-quoted strings for multi-line; single quotes for
  // short strings. Use single quotes and escape embedded single quotes.
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function toGo(value: unknown): string {
  return `package main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n)\n\nfunc main() {\n\tvar v interface{} = ${goEmit(value, 1)}\n\tb, _ := json.Marshal(v)\n\tfmt.Println(string(b))\n}`;
}

function goEmit(value: unknown, indent: number): string {
  const pad = '\t'.repeat(indent);
  const padInner = '\t'.repeat(indent + 1);
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'nil';
  if (typeof value === 'string') return goStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]interface{}{}';
    const items = value.map((v) => `${padInner}${goEmit(v, indent + 1)},`);
    return `[]interface{}{\n${items.join('\n')}\n${pad}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'map[string]interface{}{}';
    const items = entries.map(
      ([k, v]) => `${padInner}${goStr(k)}: ${goEmit(v, indent + 1)},`,
    );
    return `map[string]interface{}{\n${items.join('\n')}\n${pad}}`;
  }
  return 'nil';
}

function goStr(s: string): string {
  // Go double-quoted strings interpret backslashes; use raw interpretation
  // via backticks when the string has no backticks, else escape.
  if (!s.includes('`') && !s.includes('\n')) {
    return `\`${s}\``;
  }
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function toRust(value: unknown): string {
  return `use serde_json::json;\n\nfn main() {\n    let v = serde_json::Value::from(${rustEmit(value, 1)});\n    println!("{}", serde_json::to_string_pretty(&v).unwrap());\n}`;
}

function rustEmit(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'serde_json::Value::Null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'serde_json::Value::Null';
  if (typeof value === 'string') return rustStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'vec![]';
    const items = value.map((v) => `${padInner}${rustEmit(v, indent + 1)},`);
    return `vec![\n${items.join('\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'serde_json::Map::new()';
    const items = entries.map(
      ([k, v]) => `${padInner}${rustStr(k)}.into() => ${rustEmit(v, indent + 1)},`,
    );
    // Build via serde_json::json! for simplicity.
    return `json!({\n${items.join('\n')}\n${pad}})`;
  }
  return 'serde_json::Value::Null';
}

function rustStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function toJava(value: unknown): string {
  return `import com.fasterxml.jackson.databind.ObjectMapper;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        Object v = ${javaEmit(value, 2)};\n        System.out.println(new ObjectMapper().writeValueAsString(v));\n    }\n}`;
}

function javaEmit(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return javaStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'java.util.List.of()';
    const items = value.map((v) => `${padInner}${javaEmit(v, indent + 1)}`);
    return `java.util.List.of(\n${items.join(',\n')}\n${pad})`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'java.util.Map.of()';
    const items = entries.flatMap(
      ([k, v]) => [`${padInner}${javaStr(k)}`, javaEmit(v, indent + 1)],
    );
    return `java.util.Map.of(\n${items.join(',\n')}\n${pad})`;
  }
  return 'null';
}

function javaStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function toPhp(value: unknown): string {
  return `<?php\n\n$result = ${phpEmit(value, 0)};\necho json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);\n`;
}

function phpEmit(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return phpStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${padInner}${phpEmit(v, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '[]';
    const items = entries.map(
      ([k, v]) => `${padInner}${phpStr(k)} => ${phpEmit(v, indent + 1)}`,
    );
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  return 'null';
}

function phpStr(s: string): string {
  // PHP single-quoted strings only escape `\'` and `\\`.
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function toCsharp(value: unknown): string {
  return `using System;\nusing System.Text.Json;\n\nclass Program {\n    static void Main() {\n        var v = ${csharpEmit(value, 2)};\n        Console.WriteLine(JsonSerializer.Serialize(v, new JsonSerializerOptions { WriteIndented = true }));\n    }\n}`;
}

function csharpEmit(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return csharpStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'new System.Collections.Generic.List<object>()';
    const items = value.map((v) => `${padInner}${csharpEmit(v, indent + 1)}`);
    return `new System.Collections.Generic.List<object> {\n${items.join(',\n')}\n${pad}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'new System.Collections.Generic.Dictionary<string, object>()';
    const items = entries.map(
      ([k, v]) => `${padInner}[${csharpStr(k)}] = ${csharpEmit(v, indent + 1)}`,
    );
    return `new System.Collections.Generic.Dictionary<string, object> {\n${items.join(',\n')}\n${pad}}`;
  }
  return 'null';
}

function csharpStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export const LANGUAGE_EMITTERS: Record<Lang, (value: unknown) => string> = {
  python: toPython,
  go: toGo,
  rust: toRust,
  java: toJava,
  php: toPhp,
  csharp: toCsharp,
};

export type { Lang };
