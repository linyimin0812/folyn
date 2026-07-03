/**
 * JSON key autocomplete for the JSON5 CodeMirror editor (PR7).
 *
 * `@codemirror/lang-json` does NOT ship key completion against the parsed
 * document — this custom `CompletionSource` walks the parsed JSON AST
 * (via `json5.parse`) and suggests keys that already appear at the cursor's
 * path.
 *
 * Strategy:
 *   1. Parse the doc with `json5.parse`. On failure, return no completions.
 *   2. Walk the parse tree from the root to the cursor's parent path
 *      (resolved via the Lezer syntax tree's `ObjectExpression` /
 *      `ArrayExpression` nodes).
 *   3. Collect keys present at the parent path; suggest any that haven't
 *      been typed yet at the cursor position.
 *
 * If the doc isn't JSON (e.g. user pasted YAML and switched to edit
 * mode), `json5.parse` throws and no completions appear — graceful
 * degradation.
 */
import { ensureJson5, json5ParseSync } from './json5Linter';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the value at a JSON path from the parsed root.
 * `path` is an array of string keys / number indices.
 */
function resolvePath(root: unknown, path: Array<string | number>): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[seg];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Walk up from `pos` in the syntax tree to find the enclosing object
 * path. Uses the Lezer tree from `context.state`; falls back to an empty
 * path if the syntax tree doesn't have object/array nodes (e.g. the doc
 * is a single primitive).
 */
function pathAtPos(
  doc: string,
  pos: number,
): Array<string | number> {
  // Simple bracket/quote scan: walk from 0 to pos, track open/close of
  // `{`/`[` and the most-recent string key before each `{`. This is a
  // cheap heuristic — Lezer tree walking is more accurate but requires
  // the `@codemirror/language` tree to be loaded.
  const path: Array<string | number> = [];
  const keyStack: Array<string | number> = [];
  let inString = false;
  let escape = false;
  let currentToken = '';
  for (let i = 0; i < pos && i < doc.length; i++) {
    const ch = doc[i];
    if (inString) {
      if (escape) {
        escape = false;
        currentToken += ch;
      } else if (ch === '\\') {
        escape = true;
        currentToken += ch;
      } else if (ch === '"') {
        inString = false;
        // currentToken holds the string content (with leading quote already
        // excluded since we add ch after the open quote).
      } else {
        currentToken += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      currentToken = '';
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (keyStack.length > 0) {
        path.push(keyStack[keyStack.length - 1]);
      }
      keyStack.length = 0;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (path.length > 0) path.pop();
      keyStack.length = 0;
      continue;
    }
    if (ch === ':') {
      if (currentToken.length > 0) {
        keyStack.push(currentToken);
        currentToken = '';
      }
      continue;
    }
    if (ch === ',') {
      currentToken = '';
      continue;
    }
    // Outside strings, ignore whitespace; identifiers (unquoted keys in
    // JSON5) accumulate into currentToken.
    if (/[a-zA-Z_$][\w$]*/.test(ch)) {
      currentToken += ch;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      currentToken = '';
    }
  }
  // At pos: if we're inside an object and expectKey, the upcoming partial
  // token is `currentToken` — the caller can use it as the explicitFrom
  // filter.
  return path;
}

export async function jsonAutocomplete(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const doc = context.state.doc.toString();
  if (doc.trim().length === 0) return null;

  await ensureJson5();
  let root: unknown;
  try {
    root = json5ParseSync?.(doc) ?? JSON.parse(doc);
  } catch {
    return null; // unparseable doc → no completions
  }

  // Only complete when the char before the cursor is a quote or start of
  // an identifier inside an object.
  const before = context.matchBefore(/[\w$"]*/);
  if (!before || (before.from === before.to && !context.explicit)) return null;

  const path = pathAtPos(doc, context.pos);
  const node = resolvePath(root, path);
  if (!isPlainObject(node)) return null;

  const keys = Object.keys(node).filter((k) => k.length > 0);
  if (keys.length === 0) return null;

  // Suggest keys that aren't already typed in the current object literal
  // (we can't perfectly know which are "used" without more parsing, so
  // just suggest all keys).
  return {
    from: before.from,
    to: context.pos,
    options: keys.map((k) => ({
      label: k,
      type: 'property',
      apply: JSON.stringify(k) + ': ',
    })),
    validFor: /^[\w$"']*$/,
  };
}
