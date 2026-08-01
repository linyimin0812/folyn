import { parse as parseYaml } from 'yaml';

export interface ParsedFrontmatter {
  data: Record<string, unknown> | null;
  body: string;
}

/** Parse a `---`-fenced YAML frontmatter block from the head of a markdown
 *  file. Returns `{ data: null, body: text }` when no valid fence is present
 *  or the YAML fails to parse — callers treat a null `data` as the "skip"
 *  signal (skills/commands without frontmatter are not listed). Uses the
 *  `yaml` parser for the fenced block, not a regex, per the research file. */
export function parseMarkdownFrontmatter(text: string): ParsedFrontmatter {
  if (!text.startsWith('---')) return { data: null, body: text };
  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: null, body: text };
  const fmText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  try {
    const data = parseYaml(fmText);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { data: data as Record<string, unknown>, body };
    }
    return { data: null, body };
  } catch {
    return { data: null, body };
  }
}

/** Minimal TOML top-level string-key extractor. Reads `key = "value"` /
 *  `key = 'value'` lines at the top level (before any `[section]`); that is
 *  all command `.toml` files need (`description`, `prompt`). Bare values are
 *  returned verbatim.
 *  ponytail: not a full TOML parser — the only plugin .toml commands on disk
 *  (ponytail) use top-level quoted strings. Add a real parser if tables /
 *  array-of-tables ever need surfacing. */
export function parseTomlTopLevel(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.lastIndexOf('"') > 0) || (val.startsWith("'") && val.lastIndexOf("'") > 0)) {
      const quote = val[0];
      val = val.slice(1, val.lastIndexOf(quote));
    }
    out[key] = val;
  }
  return out;
}
