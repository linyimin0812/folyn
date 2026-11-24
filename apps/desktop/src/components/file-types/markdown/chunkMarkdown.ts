/**
 * ponytail: P2 Phase A — line-level top-level markdown chunker.
 *
 * Splits the markdown BODY (frontmatter already stripped) into chunks at
 * blank-line boundaries that are safe for re-parsing each chunk IN
 * ISOLATION: a blank line splits only when every block construct that spans
 * blank lines has ended. The rule set mirrors what remark-parse +
 * remark-math + remarkGfm + remark-directive + the raw-HTML block rules
 * actually do with the source (rules verified against the real parser
 * stack):
 *
 * - Fenced code (``` / ~~~, indent ≤3, longer marker closes shorter): blank
 *   lines INSIDE the fence are content — never split.
 * - Display math flow `$$`: opens at a line-start `$$` (indent ≤3) with no
 *   second `$$` on the line (two `$$` makes it a paragraph / single-line
 *   math); closes at a line ENDING in `$$` (trailing whitespace ok, any
 *   indent — the parser accepts indented closes); unclosed runs to EOF —
 *   blank lines inside never split. `$…$` inline math never spans blank
 *   lines, no state.
 * - `\[ … \]` / `\( … \)` display math brackets: tracked as running
 *   unmatched counts (the transformMathBrackets pre-pass pairs them at the
 *   string level, so a chunk must contain the whole pair). A `\]` inside
 *   inline code can false-positive — that only over-merges, which is safe.
 * - Directives (`:::name` … `:::`): opens at `^ {0,3}:{3,}` with the name
 *   attached to the colons (a space makes it a paragraph); nested
 *   containers push a depth counter (each `:::name` line +1); a close line
 *   `^ {0,3}:{3,}[ \t]*$` pops ONE level (the real parser can pop several
 *   with one longer close line, and a 4-indent close line stays inside —
 *   popping conservatively merges more, never less); unclosed runs to EOF.
 *   A code fence inside a directive suspends close detection (`:::` inside
 *   the fence is code content).
 * - Raw HTML regions, in parser order:
 *   - comments `<!--` → until a line containing `-->`; `<?` → `?>`;
 *     `<![CDATA[` → `]]>`; other `<!` declarations → first `>`.
 *   - Type-1 raw blocks (pre/script/style/textarea, case-insensitive, open
 *     tag at line start followed by space/`>`/EOL): until a line CONTAINING
 *     the matching close tag — the parser's own continuation rule.
 *   - Unknown-tag runs — the SAME detection `remarkCollapseUnknownTagRuns`
 *     stage 1 uses so a run that spans blank lines stays one chunk: a lone
 *     open-tag line — either a complete tag `^<name attrs>$` or a BARE tag
 *     name at EOL `^<name$` (a multi-line type-6 open: `<div`⏎
 *     `  class="x">`) — opens; a line that IS a lone close tag `^</name>$`
 *     or ENDS with `</name>` (the trailing-inline-html close that can't
 *     interrupt a paragraph) ends it.
 * - Blockquotes: blank lines always end them (verified: `> a\n\n> b` is
 *   two blockquotes) — no state, split freely.
 * - Lists: a list's items + their indented continuation lines span blanks
 *   (loose lists, fences inside items). After any SPLIT the list state is
 *   cleared, so a blank followed by a list marker, an indented (≥4)
 *   continuation, or (while a list is open) any indented line keeps the
 *   chunk together; indented 1–3 lines without an open list are a new
 *   paragraph — splittable.
 * - Reference definitions (`[x]: url`): not a split concern, but the chunk
 *   set is only used when NO definition exists anywhere (labels must
 *   resolve from anywhere — the whole-doc path renders such docs).
 *
 * Anything unrecognized MERGES (a bigger chunk is always renderable — it is
 * just a slice that the shared pipeline parses the same way the whole doc
 * would; a split inside a spanning construct is what breaks rendering).
 * Output chunks carry `startLine` (1-based, BODY-relative) so the renderer
 * can pad with `'\n'.repeat(startLine + frontmatterLineCount - 1)` and get
 * document-absolute parser positions (data-source-line stamps, blank-gap
 * math, cursor sync) for free.
 */

/** One top-level chunk of the markdown body. */
export interface MarkdownChunk {
  /** Body-relative 1-based line of the chunk's first line. */
  startLine: number;
  /** The chunk's source lines (no trailing blank lines; leading blanks only
   *  when absorbed into a continuation construct — see blank rules). */
  text: string;
  /** Blank lines between this chunk's last line and the next chunk's first
   *  line (trailing blanks at EOF for the last chunk). */
  blankLinesAfter: number;
  /** Number of source lines in `text` (startLine + lineCount - 1 = last). */
  lineCount: number;
}

/** Result of chunking a markdown body. */
export interface ChunkedDocument {
  chunks: MarkdownChunk[];
  /** True when a `[label]: destination` reference definition appears — such
   *  docs must render whole (labels resolve from anywhere in the doc). */
  hasReferenceDefinitions: boolean;
}

// ── Line classifiers ──────────────────────────────────────────────────────

const DIRECTIVE_OPEN_RE = /^ {0,3}:{3,}[A-Za-z0-9_-]/;

/**
 * Fence open: 0–3 spaces then a run of backticks or tildes (one repeated
 * char — a mixed `` ` ~~ `` run is not a fence).
 */
function fenceOpen(line: string): { ch: string; len: number } | null {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!m) return null;
  return { ch: m[1][0], len: m[1].length };
}

/**
 * Display math flow open (verified against micromark-extension-math):
 * a `$`-run (greedy, ≥2) at indent ≤3 whose remainder contains NO `$`
 * — the flow fence meta rejects any `$`, so `$$x$$`, `$$ $$` and
 * `$$x$y` are paragraphs/inline math, while `$$$` / `$$$$` still open
 * the flow (the greedy run eats them and the meta is empty).
 */
function mathFlowOpens(line: string): number | null {
  const m = /^ {0,3}(\${2,})/.exec(line);
  if (!m) return null;
  if (line.slice(m.index + m[1].length).includes('$')) return null;
  return m[1].length;
}

/**
 * Display math flow close: a line that is ONLY a `$`-run of at least the
 * OPENING run's size, plus trailing whitespace, indent ≤3 (verified:
 * `$$$$` closes a `$$` open but `$$` does not close a `$$$` open; indent
 * 0–3 closes, 4+ does not). Nothing else closes math flow — `y$$` and
 * `$$text$$` stay math content to EOF.
 */
const MATH_CLOSE_RE = /^ {0,3}(\${2,})[ \t]*$/;
function mathFlowCloses(line: string, openSize: number): boolean {
  const m = MATH_CLOSE_RE.exec(line);
  return m != null && m[1].length >= openSize;
}

const DIRECTIVE_CLOSE_RE = /^ {0,3}:{3,}[ \t]*$/;
const LIST_MARKER_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const LINK_DEF_RE = /^ {0,3}\[[^\]\n]*\]:/;
const OPEN_TAG_LINE_RE = /^<([a-zA-Z][\w-]*)(?:[ \t][^>\n]*)?>$/;
// A CommonMark type-6 HTML block can open with a BARE tag name at EOL —
// the tag's attributes continue on following lines (`<div`⏎`  class="x">`).
// A region opened this way spans blanks until the close tag, same as the
// complete-single-line-open case: over-merging (a bigger chunk) is always
// render-correct, only less granular.
const BARE_TAG_LINE_RE = /^<([a-zA-Z][\w-]*)$/;
const CLOSE_TAG_LINE_RE = /^<\/([a-zA-Z][\w-]*)[ \t]*>$/;
// Type-1 raw block containers: `<pre` etc. at line start followed by
// whitespace, `>`, or end-of-line — blank lines inside are literal content.
const RAW_TYPE1_RE = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i;
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const isBlank = (line: string) => line.trim() === '';
const leadingSpaces = (line: string) => {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
};
const countOf = (line: string, needle: string) => {
  let n = 0;
  for (let k = line.indexOf(needle); k >= 0; k = line.indexOf(needle, k + needle.length)) n++;
  return n;
};
/** Same fence char, ≥ open length, indent ≤3, only whitespace after. */
const isFenceClose = (line: string, ch: string, len: number) => {
  if (leadingSpaces(line) > 3) return false;
  const t = line.trim();
  if (!t.startsWith(ch)) return false;
  for (let k = 0; k < t.length; k++) {
    if (t[k] !== ch) return k >= len && /^[\t ]*$/.test(t.slice(k));
  }
  return t.length >= len;
};

/** An open region that swallows blank lines until it closes. */
type Region =
  | { kind: 'fence'; ch: string; len: number }
  | { kind: 'directive'; depth: number; fence: { ch: string; len: number } | null }
  | { kind: 'raw'; closes: (line: string) => boolean }
  | { kind: 'tagrun'; name: string }
  | { kind: 'math'; size: number }
  | { kind: 'bracket' };

/**
 * Chunk the markdown body at safe blank-line boundaries. Pure, synchronous,
 * O(lines). When in doubt this merges — every chunk is re-parsed in
 * isolation by the shared pipeline, and a too-large chunk only costs
 * granularity, never correctness.
 */
export function chunkMarkdown(source: string): ChunkedDocument {
  const rawLines = source.split('\n');
  const lines = rawLines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const N = lines.length;
  const chunks: MarkdownChunk[] = [];
  let hasReferenceDefinitions = false;

  let region: Region | null = null;
  let inList = false;
  let unmatchedSq = 0;
  let unmatchedParen = 0;

  // Chunk under construction: [chunkStart, chunkEnd) in `lines`.
  let chunkStart = 0;
  let chunkEnd = 0;

  const closeChunk = (blankRunStart: number, nextContentIdx: number) => {
    if (chunkEnd > chunkStart) {
      chunks.push({
        startLine: chunkStart + 1,
        text: lines.slice(chunkStart, chunkEnd).join('\n'),
        blankLinesAfter: nextContentIdx - blankRunStart,
        lineCount: chunkEnd - chunkStart,
      });
    }
    chunkStart = nextContentIdx;
    chunkEnd = nextContentIdx;
    inList = false;
  };

  let i = 0;
  while (i < N) {
    const line = lines[i];
    const t = line.trim();

    if (t === '') {
      chunkEnd = i;
      let j = i + 1;
      while (j < N && isBlank(lines[j])) j++;
      if (j >= N) {
        // Trailing blanks: close the last chunk here; they become its
        // blankLinesAfter (the EOF gap).
        closeChunk(i, N);
        region = null;
        break;
      }
      if (region != null) {
        // Region swallows the blank (fence content / math / raw run …).
        i = j;
        continue;
      }
      const next = lines[j];
      const indent = leadingSpaces(next);
      const continues =
        LIST_MARKER_RE.test(next) || indent >= 4 || (inList && indent >= 1);
      if (continues) {
        // The blank belongs to the current construct (loose list /
        // indented code) — keep the chunk open across it.
        i = j;
        continue;
      }
      closeChunk(i, j);
      i = j;
      continue;
    }

    // Non-blank line — advance spanning states.
    chunkEnd = i + 1;
    if (region != null) {
      switch (region.kind) {
        case 'fence':
          if (isFenceClose(line, region.ch, region.len)) region = null;
          break;
        case 'directive': {
          if (region.fence != null) {
            if (isFenceClose(line, region.fence.ch, region.fence.len)) region.fence = null;
          } else {
            const f = fenceOpen(line);
            if (f) {
              region.fence = f;
            } else if (DIRECTIVE_OPEN_RE.test(line)) {
              region.depth++;
            } else if (DIRECTIVE_CLOSE_RE.test(line)) {
              region.depth--;
              if (region.depth <= 0) region = null;
            }
          }
          break;
        }
        case 'raw':
          if (region.closes(line)) region = null;
          break;
        case 'tagrun':
          if (tagClosesRun(line, region.name)) region = null;
          break;
        case 'math':
          if (mathFlowCloses(line, region.size)) region = null;
          break;
        case 'bracket': {
          unmatchedSq += countOf(line, '\\[') - countOf(line, '\\]');
          unmatchedParen += countOf(line, '\\(') - countOf(line, '\\)');
          if (unmatchedSq <= 0 && unmatchedParen <= 0) region = null;
          unmatchedSq = Math.max(0, unmatchedSq);
          unmatchedParen = Math.max(0, unmatchedParen);
          break;
        }
      }
      i++;
      continue;
    }

    // No region — check openers in parser priority order.
    const f = fenceOpen(line);
    if (f) {
      region = { kind: 'fence', ch: f.ch, len: f.len };
      i++;
      continue;
    }
    if (DIRECTIVE_OPEN_RE.test(line)) {
      region = { kind: 'directive', depth: 1, fence: null };
      i++;
      continue;
    }
    const type1 = RAW_TYPE1_RE.exec(line);
    if (type1) {
      const name = type1[1].toLowerCase();
      const re = new RegExp(`</${name}[\\s>/]`, 'i');
      region = { kind: 'raw', closes: (l) => re.test(l) };
      i++;
      continue;
    }
    const rawRegion = rawHtmlRegion(line);
    if (rawRegion) {
      region = { kind: 'raw', closes: rawRegion };
      i++;
      continue;
    }
    if (LIST_MARKER_RE.test(line)) inList = true;
    if (LINK_DEF_RE.test(line)) hasReferenceDefinitions = true;
    unmatchedSq = Math.max(0, unmatchedSq + countOf(line, '\\[') - countOf(line, '\\]'));
    unmatchedParen = Math.max(0, unmatchedParen + countOf(line, '\\(') - countOf(line, '\\)'));
    if (unmatchedSq > 0 || unmatchedParen > 0) {
      region = { kind: 'bracket' };
      i++;
      continue;
    }
    const open = OPEN_TAG_LINE_RE.exec(t);
    if (
      open &&
      leadingSpaces(line) <= 3 &&
      !VOID_TAGS.has(open[1].toLowerCase()) &&
      !t.endsWith('/>')
    ) {
      region = { kind: 'tagrun', name: open[1] };
      i++;
      continue;
    }
    // Multi-line type-6 open (bare `<div` at EOL, attrs on later lines): a
    // real parser opener — a chunk boundary landing between the open and
    // its close would wrap inner content in the full render but not in the
    // chunked one (parity violation). Opens the same tag-run.
    const bare = !open && BARE_TAG_LINE_RE.exec(t);
    if (
      bare &&
      leadingSpaces(line) <= 3 &&
      !VOID_TAGS.has(bare[1].toLowerCase())
    ) {
      region = { kind: 'tagrun', name: bare[1] };
      i++;
      continue;
    }
    const mathSize = mathFlowOpens(line);
    if (mathSize != null) {
      region = { kind: 'math', size: mathSize };
      i++;
      continue;
    }
    i++;
  }

  // EOF: close the trailing chunk. If a region is still open it ran to EOF
  // (its content — blanks included — is the chunk text); otherwise strip
  // trailing blanks (they are the EOF gap).
  if (chunkEnd > chunkStart) {
    let last = chunkEnd;
    if (region == null) {
      while (last > chunkStart && isBlank(lines[last - 1])) last--;
    }
    chunks.push({
      startLine: chunkStart + 1,
      text: lines.slice(chunkStart, last).join('\n'),
      blankLinesAfter: N - last,
      lineCount: last - chunkStart,
    });
  } else if (chunks.length > 0 && chunkStart < N) {
    // Only trailing blanks remain — fold them into the last chunk's gap.
    chunks[chunks.length - 1].blankLinesAfter += N - chunkStart;
  }

  return { chunks, hasReferenceDefinitions };
}

// ── helpers ───────────────────────────────────────────────────────────────

/** True when this line closes the unknown-tag run for `name` — either a
 *  lone `</name>` html block, or a paragraph whose TRAILING inline html
 *  child is the close tag (a type-7 close can't interrupt a paragraph). */
function tagClosesRun(line: string, name: string): boolean {
  const t = line.trim();
  const lone = CLOSE_TAG_LINE_RE.exec(t);
  if (lone && lone[1].toLowerCase() === name.toLowerCase()) return true;
  return t.toLowerCase().endsWith(`</${name.toLowerCase()}>`);
}

/**
 * Blank-spanning raw-HTML region openers (comments / PIs / CDATA /
 * declarations). Returns the close predicate when the LINE opens a region
 * (the closer is not already on the opening line), else null.
 */
function rawHtmlRegion(line: string): ((line: string) => boolean) | null {
  const t = line.trim();
  if (t.startsWith('<!--')) return t.includes('-->') ? null : (l) => l.includes('-->');
  if (t.startsWith('<?')) return t.includes('?>') ? null : (l) => l.includes('?>');
  if (t.toUpperCase().startsWith('<![CDATA[')) return t.includes(']]>') ? null : (l) => l.includes(']]>');
  if (t.startsWith('<!')) return t.includes('>') ? null : (l) => l.includes('>');
  return null;
}
