// Inline ```plantuml / ```mermaid / ```graphviz fences into a kroki.io image
// so markmap-lib renders the diagram, not `<pre>` source. Two quirks of
// markmap-lib drive the shape:
//
//  1. It only keeps content INSIDE a heading line + standalone markdown
//     images with no following heading. Anything between two headings —
//     paragraphs, lists, images, fences — is dropped. So the image can't
//     live as its own paragraph if a sibling heading follows.
//
//  2. Raw `<img>` HTML and `![](data:…)` URLs are stripped by markdown-it.
//     Only markdown image syntax `![](http-url)` survives into a node.
//
// Conclusion: append `![](kroki-url)` INLINE to the nearest preceding
// heading line. If there is no preceding heading, synthesize `# ![](url)`
// so the image still becomes a node. kroki.io serves all three diagram
// types via DEFLATE(zlib)+base64url; one CSP entry, no per-type branching.

const KROKI = 'https://kroki.io/';

// Match fenced code blocks of 3+ backticks. Allow optional info string
// (the language + anything after) so ```\nplain\n``` and ``` text\nx\n```
// also match — markdown-it accepts these, the old `(\w+)`-only form missed
// 4-backtick outer fences and fences without a language name.
const FENCE_RE = /(`{3,})([^\r\n]*)\r?\n([\s\S]*?)\1/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

const PLANTUML_LANGS = new Set(['plantuml', 'puml', 'pu']);
const MERMAID_LANGS = new Set(['mermaid', 'mmd']);
const GRAPHVIZ_LANGS = new Set(['graphviz', 'dot', 'gv']);

/** Parse the language out of a fence's info string (first whitespace-token). */
function langOf(info: string): string {
  const trimmed = info.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0].toLowerCase();
}

// ponytail: Kroki URL cap is ~4k chars (varies by reverse proxy). Beyond
// that the standalone code-fence renderers POST — markmap preprocessing
// can't easily POST for an <img>, so bail and leave the fence as source.
const URL_CAP = 4000;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function encode64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    if (i + 1 >= bytes.length) {
      out += ALPHABET[b1 >> 2];
      out += ALPHABET[(b1 << 4) & 0x3f];
      break;
    }
    const b2 = bytes[i + 1];
    if (i + 2 >= bytes.length) {
      out += ALPHABET[b1 >> 2];
      out += ALPHABET[((b1 << 4) & 0x30) | (b2 >> 4)];
      out += ALPHABET[(b2 << 2) & 0x3c];
      break;
    }
    const b3 = bytes[i + 2];
    out += ALPHABET[b1 >> 2];
    out += ALPHABET[((b1 << 4) & 0x30) | (b2 >> 4)];
    out += ALPHABET[((b2 << 2) & 0x3c) | (b3 >> 6)];
    out += ALPHABET[b3 & 0x3f];
  }
  return out;
}

// ponytail: Kroki expects zlib (RFC 1950, 2-byte header + adler32),
// NOT raw deflate (RFC 1951) — plantuml.com uses raw deflate, do not
// reuse encodePlantUml. `deflate-raw` here would return 400 from kroki.
async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(bytes as unknown as BufferSource);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function encodeKroki(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const compressed = await deflateZlib(bytes);
  return encode64(compressed);
}

async function buildKrokiUrl(lang: string, src: string): Promise<string | null> {
  try {
    const enc = await encodeKroki(src);
    const url = `${KROKI}${lang}/svg/${enc}`;
    if (url.length > URL_CAP) return null;
    return url;
  } catch { return null; }
}

/**
 * Rewrite ```plantuml/mermaid/graphviz fences in markmap source so the
 * diagram survives markmap-lib's tree builder. Each fence becomes
 * `![](kroki-url)` appended inline to the nearest preceding heading line
 * (markmap drops paragraphs/images between two headings). If there is no
 * preceding heading, a synthetic `# ![](url)` heading is synthesized.
 * Unknown fence languages and oversized sources (URL > 4k) are left
 * untouched. Fast-paths when no fences are present.
 */
export async function preprocessMarkmapContent(content: string): Promise<string> {
  if (!content || !content.includes('```')) return content;
  const matches = [...content.matchAll(FENCE_RE)];
  if (matches.length === 0) return content;

  // Build the kroki URL per fence (async, parallel).
  const urls = await Promise.all(
    matches.map(async (m) => {
      const lang = langOf(m[2]);
      const src = m[3];
      if (PLANTUML_LANGS.has(lang)) return buildKrokiUrl('plantuml', src);
      if (MERMAID_LANGS.has(lang)) return buildKrokiUrl('mermaid', src);
      if (GRAPHVIZ_LANGS.has(lang)) return buildKrokiUrl('graphviz', src);
      return null;
    }),
  );

  // Splice the content: for each fence, either append `![](url)` to the
  // nearest preceding heading line, or insert `# ![](url)` as a synthetic
  // heading. Walk the string from the start, tracking the last heading
  // line's char offset in `out` (which grows as we splice).
  let out = '';
  let cursor = 0;
  let lastHeadingEndInOut = -1;
  for (let i = 0; i < matches.length; i++) {
    const url = urls[i];
    const fenceStart = matches[i].index ?? 0;
    const fenceEnd = fenceStart + matches[i][0].length;
    // Append the chunk before this fence to `out`, line-by-line so we can
    // track the last heading line's end offset as we go.
    const before = content.slice(cursor, fenceStart);
    if (before.length > 0) {
      const lines = before.split('\n');
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        out += line;
        if (HEADING_RE.test(line)) {
          lastHeadingEndInOut = out.length;
        }
        if (j < lines.length - 1) out += '\n';
      }
    }
    if (url) {
      const lang = langOf(matches[i][2]);
      const img = `![${lang || 'diagram'}](${url})`;
      if (lastHeadingEndInOut >= 0) {
        // Append ` ![](url)` at the end of the last heading line.
        out = out.slice(0, lastHeadingEndInOut) + ` ${img}` + out.slice(lastHeadingEndInOut);
        lastHeadingEndInOut += img.length + 1;
      } else {
        // No preceding heading — synthesize `# ![](url)` so the image
        // becomes its own node (markmap drops standalone image paragraphs
        // that are followed by a heading).
        out += `# ${img}`;
        lastHeadingEndInOut = out.length;
      }
    } else {
      // Bail: leave the fence as-is.
      out += matches[i][0];
    }
    cursor = fenceEnd;
  }
  out += content.slice(cursor);
  return out;
}
