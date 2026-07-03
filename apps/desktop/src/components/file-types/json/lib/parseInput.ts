/**
 * Input-format auto-detect + parse pipeline for the JSON file viewer.
 *
 * Supported formats (see prd R3):
 *   - json5    : JSON5 (comments, unquoted keys, trailing commas, hex, etc.)
 *   - escaped  : a JSON string literal whose inner text is itself JSON
 *   - base64   : base64-encoded UTF-8 JSON string
 *   - yaml     : YAML
 *   - xml      : XML (attributes prefixed `@_`)
 *   - csv      : CSV / TSV (array of records, header: true)
 *
 * Heavy parsers (`json5`, `yaml`, `fast-xml-parser`, `papaparse`) are
 * lazy-loaded via `await import()` per `.trellis/spec/desktop/frontend/file-type-editors.md`
 * (precedent: `@dbml/core`). Native `atob` / `TextDecoder` / `JSON.parse`
 * are used directly for base64 and escaped modes.
 *
 * API:
 *   parseInput(content, mode?) => Promise<unknown>
 *
 * Auto-detect order: json5 → escaped → base64 → yaml → xml → csv.
 * First successful parse wins; on all-fail, throws an aggregate Error.
 *
 * Design note: in `auto` mode, the `json5` and `yaml` branches only
 * accept the result when it is a non-null object or array. Both parsers
 * happily parse bare words / numbers / strings as primitives, which would
 * shadow later branches (e.g. YAML would claim `<root>...` as a string
 * before XML could claim it; json5 would claim a quoted JSON literal as a
 * string before the escaped branch could unwrap it). Restricting these two
 * branches to structured results in auto mode resolves the ambiguity.
 * In manual mode the raw result is returned whatever its type.
 */

export type InputMode =
  | 'auto'
  | 'json5'
  | 'escaped'
  | 'base64'
  | 'yaml'
  | 'xml'
  | 'csv';

export interface ParseSuccess {
  value: unknown;
  mode: Exclude<InputMode, 'auto'>;
}

export interface ParseFailure {
  mode: Exclude<InputMode, 'auto'>;
  error: string;
}

const BASE64_REGEX = /^[A-Za-z0-9+/=\s]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

function isStructured(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

function looksLikeEscaped(trimmed: string): boolean {
  if (trimmed.length < 2) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== '"' && first !== "'") return false;
  return first === last;
}

async function parseJson5(content: string): Promise<unknown> {
  const mod = await import('json5');
  const parse = mod.parse ?? (mod.default as { parse: (s: string) => unknown } | undefined)?.parse;
  if (!parse) {
    throw new Error('json5.parse is not available');
  }
  return parse(content);
}

function parseEscapedString(content: string): unknown {
  const trimmed = content.trim();
  if (!looksLikeEscaped(trimmed)) {
    throw new Error('not an escaped string literal');
  }
  const first = trimmed[0] as '"' | "'";

  let inner: string;
  if (first === '"') {
    // JSON.parse unwraps the double-quoted string and processes escapes.
    const unwrapped = JSON.parse(trimmed);
    if (typeof unwrapped !== 'string') {
      throw new Error('quoted literal did not unwrap to a string');
    }
    inner = unwrapped;
  } else {
    // Single-quoted: strip the outer quotes; the inner is expected to be
    // JSON (which uses double quotes internally), so no escape processing.
    inner = trimmed.slice(1, -1);
  }

  return JSON.parse(inner);
}

function parseBase64String(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error('empty base64 input');
  }
  if (!BASE64_REGEX.test(trimmed)) {
    throw new Error('contains non-base64 characters');
  }
  const noWs = trimmed.replace(/\s+/g, '');
  if (noWs.length === 0 || noWs.length % 4 !== 0) {
    throw new Error('base64 length is not a multiple of 4');
  }

  let binary: string;
  try {
    binary = atob(noWs);
  } catch (err) {
    throw new Error(
      `atob failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);

  // The decoded string is expected to be JSON. If it is itself a quoted
  // JSON literal (escaped JSON), unwrap it via the escaped-string logic
  // so the user gets the inner object, not a string.
  const trimmedDecoded = decoded.trim();
  if (looksLikeEscaped(trimmedDecoded)) {
    try {
      return parseEscapedString(decoded);
    } catch {
      // fall through to direct JSON.parse below
    }
  }

  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error('decoded base64 is not valid JSON');
  }
}

async function parseYaml(content: string): Promise<unknown> {
  const mod = await import('yaml');
  const parse = mod.parse;
  if (typeof parse !== 'function') {
    throw new Error('yaml.parse is not available');
  }
  return parse(content);
}

async function parseXml(content: string): Promise<unknown> {
  const mod = await import('fast-xml-parser');
  const XMLParser = mod.XMLParser;
  if (typeof XMLParser !== 'function') {
    throw new Error('XMLParser is not available');
  }
  const parser = new XMLParser({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    // Keep text nodes as strings (don't strnum-coerce "1" → 1) so the
    // tree viewer shows the original lexical form.
    parseTagValue: false,
  });
  return parser.parse(content);
}

async function parseCsv(
  content: string,
): Promise<Array<Record<string, string>>> {
  const mod = await import('papaparse');
  // papaparse v5 exports a default `Papa` object with `.parse`, plus named
  // `parse`/`unparse`. Support both shapes.
  const Papa = (mod as unknown as {
    parse: (input: string, config: unknown) => {
      data: unknown;
      errors: unknown[];
      meta: unknown;
    };
    default?: { parse: (input: string, config: unknown) => unknown };
  }).default ?? mod;

  if (typeof Papa?.parse !== 'function') {
    throw new Error('papaparse.parse is not available');
  }
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  }) as { data: unknown; errors: unknown[] };

  if (result.errors && result.errors.length > 0) {
    throw new Error(
      `csv parse errors: ${result.errors.map((e) => (e as { message?: string }).message ?? String(e)).join('; ')}`,
    );
  }
  const data = result.data;
  if (!Array.isArray(data)) {
    throw new Error('csv parser did not return an array');
  }
  return data as Array<Record<string, string>>;
}

const PARSERS: Record<
  Exclude<InputMode, 'auto'>,
  (content: string) => Promise<unknown> | unknown
> = {
  json5: parseJson5,
  escaped: parseEscapedString,
  base64: parseBase64String,
  yaml: parseYaml,
  xml: parseXml,
  csv: parseCsv,
};

const AUTO_ORDER: ReadonlyArray<Exclude<InputMode, 'auto'>> = [
  'json5',
  'escaped',
  'base64',
  'yaml',
  'xml',
  'csv',
];

export class ParseError extends Error {
  readonly attempted: ParseFailure[];
  constructor(message: string, attempted: ParseFailure[]) {
    super(message);
    this.name = 'ParseError';
    this.attempted = attempted;
  }
}

/**
 * Parse `content` according to `mode` (default `'auto'`).
 *
 * In `auto` mode, each parser is tried in order; the json5 branch only
 * accepts results that are objects or arrays (so that a quoted JSON
 * string falls through to the escaped branch). Returns the parsed
 * value, or throws a `ParseError` listing every attempted format.
 */
export async function parseInput(
  content: string,
  mode: InputMode = 'auto',
): Promise<unknown> {
  if (content == null) {
    throw new ParseError('parseInput: content is null or undefined', []);
  }
  const input = typeof content === 'string' ? content : String(content);

  if (mode !== 'auto') {
    const parser = PARSERS[mode];
    try {
      const value = await parser(input);
      return value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ParseError(`parseInput: ${mode} parse failed — ${msg}`, [
        { mode, error: msg },
      ]);
    }
  }

  const attempted: ParseFailure[] = [];
  for (const candidate of AUTO_ORDER) {
    const parser = PARSERS[candidate];
    try {
      // Auto-mode guards: cheap structural pre-checks that prevent an
      // over-permissive parser from shadowing a later, more specific
      // branch.
      if (candidate === 'xml' && !input.trimStart().startsWith('<')) {
        attempted.push({
          mode: candidate,
          error: 'auto-mode xml rejected: input does not start with <',
        });
        continue;
      }
      const value = await parser(input);
      // In auto mode, json5 and yaml only accept structured results
      // (object/array). A primitive result means the input was probably
      // a bare scalar or a string that a later branch (escaped, xml, csv)
      // should get a chance to claim.
      if (
        (candidate === 'json5' || candidate === 'yaml') &&
        !isStructured(value)
      ) {
        attempted.push({
          mode: candidate,
          error: `auto-mode ${candidate} rejected primitive result`,
        });
        continue;
      }
      // xml branch in auto mode must produce a non-empty object —
      // fast-xml-parser returns `{}` for plain text without tags, which
      // would shadow CSV otherwise.
      if (
        candidate === 'xml' &&
        (!isPlainObject(value) || Object.keys(value).length === 0)
      ) {
        attempted.push({
          mode: candidate,
          error: 'auto-mode xml rejected empty result',
        });
        continue;
      }
      return value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempted.push({ mode: candidate, error: msg });
    }
  }

  const summary = attempted
    .map((a) => `${a.mode}: ${a.error}`)
    .join('\n  ');
  throw new ParseError(
    `parseInput: all formats failed in auto mode.\n  ${summary}`,
    attempted,
  );
}

/**
 * Parse and also report which format succeeded. Useful for the UI to
 * show the detected format in the dropdown.
 */
export async function parseInputWithMode(
  content: string,
  mode: InputMode = 'auto',
): Promise<ParseSuccess> {
  if (mode !== 'auto') {
    const value = await parseInput(content, mode);
    return { value, mode };
  }

  if (content == null) {
    throw new ParseError('parseInput: content is null or undefined', []);
  }
  const input = typeof content === 'string' ? content : String(content);

  const attempted: ParseFailure[] = [];
  for (const candidate of AUTO_ORDER) {
    const parser = PARSERS[candidate];
    try {
      if (candidate === 'xml' && !input.trimStart().startsWith('<')) {
        attempted.push({
          mode: candidate,
          error: 'auto-mode xml rejected: input does not start with <',
        });
        continue;
      }
      const value = await parser(input);
      if (
        (candidate === 'json5' || candidate === 'yaml') &&
        !isStructured(value)
      ) {
        attempted.push({
          mode: candidate,
          error: `auto-mode ${candidate} rejected primitive result`,
        });
        continue;
      }
      if (
        candidate === 'xml' &&
        (!isPlainObject(value) || Object.keys(value).length === 0)
      ) {
        attempted.push({
          mode: candidate,
          error: 'auto-mode xml rejected empty result',
        });
        continue;
      }
      return { value, mode: candidate };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempted.push({ mode: candidate, error: msg });
    }
  }

  const summary = attempted
    .map((a) => `${a.mode}: ${a.error}`)
    .join('\n  ');
  throw new ParseError(
    `parseInput: all formats failed in auto mode.\n  ${summary}`,
    attempted,
  );
}

// Re-exported for tests / type narrowing in the tree viewer (PR3).
export { isPlainObject };
