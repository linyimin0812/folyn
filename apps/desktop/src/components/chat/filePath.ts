/**
 * File-path detection + existence cache for chat message inline code.
 *
 * Used by MessageContent's rehype-react `code` override: when an inline-code
 * token matches `matchFilePath` AND the path resolves in the active vault /
 * external provider, it renders as a clickable `<FilePathCode>` that calls
 * `onPathClick(path, line, col)`.
 *
 * The existence cache is module-level so repeated paths across messages don't
 * re-fetch. Caller clears it on vault switch (stale paths).
 */

const KNOWN_EXT = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'json5', 'jsonc',
  'md', 'mdx', 'markdown', 'mdown', 'markdn',
  'py', 'pyi', 'pyw',
  'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'rb', 'php',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff',
  'pdf', 'txt', 'log', 'csv', 'tsv',
  'excalidraw', 'drawio', 'markmap', 'web',
  'sql', 'proto', 'gradle',
  'gitignore', 'dockerfile', 'makefile', 'lock',
];

const EXT_RE = new RegExp('\\.(?:' + KNOWN_EXT.join('|') + ')$', 'i');

export interface MatchedPath {
  path: string;
  line?: number;
  col?: number;
}

/** Match an inline-code string against the file-path shape.
 *  Returns `{ path, line?, col? }` if `raw` looks like a path with a known
 *  extension (optionally suffixed with `:line` or `:line:col`), else null.
 *
 *  Rejects: URLs, strings with spaces, strings starting with `(` (function
 *  calls). Bare words without a `/` are accepted ONLY if they end with a
 *  known extension — the async existence check filters the rest. */
export function matchFilePath(raw: string): MatchedPath | null {
  if (!raw || typeof raw !== 'string') return null;
  if (/\s/.test(raw)) return null;
  if (/[()[\]{}]/.test(raw)) return null; // function calls / brackets — not paths
  if (/^(?:https?|ftp|file):\/\//i.test(raw)) return null;

  // Split optional :line:col suffix.
  const m = raw.match(/^(.+?)(?::(\d+))?(?::(\d+))?$/);
  if (!m) return null;
  const path = m[1];
  if (!EXT_RE.test(path)) return null;
  const line = m[2] ? parseInt(m[2], 10) : undefined;
  const col = m[3] ? parseInt(m[3], 10) : undefined;
  return { path, line, col };
}

// ponytail: per-session cache. Promise-based so concurrent fetches dedupe.
// Not invalidated automatically — caller clears on vault switch.
const pathExistsCache = new Map<string, Promise<boolean>>();

/** Check if a path exists, deduping concurrent fetches and caching the
 *  result per `raw` string for the session. `resolver` is the consumer-
 *  supplied callback that actually routes to vault/external/wiki. */
export function checkPathExists(
  raw: string,
  resolver: (raw: string) => Promise<boolean>,
): Promise<boolean> {
  let p = pathExistsCache.get(raw);
  if (!p) {
    p = (async () => {
      try {
        return await resolver(raw);
      } catch {
        return false;
      }
    })();
    pathExistsCache.set(raw, p);
  }
  return p;
}

/** Clear the existence cache. Call on vault switch / session reset. */
export function clearPathExistsCache(): void {
  pathExistsCache.clear();
}
