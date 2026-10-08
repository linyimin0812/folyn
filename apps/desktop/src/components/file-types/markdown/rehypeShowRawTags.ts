/**
 * Rehype plugin: show unknown/non-standard HTML tags as literal text.
 *
 * Why: rehypeRaw parses raw HTML in markdown into real hast elements, so a
 * tag like <workflow-state>…</workflow-state> (machine-oriented markers that
 * commonly appear in markdown notes) becomes an unknown custom element —
 * React renders it as a DOM custom element and the tag itself vanishes (only
 * the inner text shows). Writers expect to SEE the tag in the preview.
 *
 * Elements whose tagName is NOT a known HTML/SVG tag (and not an explicitly
 * passed extra-known tag) are spliced open into
 * [text("<tag attrs>"), ...inner, text("</tag>")] — the tags become literal
 * text nodes. The inner content is shown as RAW SOURCE: sliced from the
 * vfile's markdown string between the first child's start and last child's
 * end offset, so inner markdown (`**bold**`, nested tags, …) displays
 * literally instead of rendering. When the vfile value or child positions
 * are unavailable (a pre-parsed tree without a source), the inner children
 * fall back to their normal recursive rendering. Known tags (<b>, <img>,
 * <svg>, …) are untouched.
 *
 * Newlines in raw-HTML text: remark-breaks turns single \n into <br> at mdast
 * level BEFORE rehypeRaw, so it never sees raw-HTML content — an HTML text
 * node's \n would collapse to a space. After remark-breaks, no markdown text
 * node contains \n, so any \n in a text node here came from raw HTML. We
 * splice <br> ourselves (mirroring remark-breaks) for \n inside an unknown
 * tag's inner content, and — when a level spliced at least one unknown tag —
 * for \n in that level's sibling text nodes too (e.g. the newline BETWEEN two
 * sibling <workflow-state> blocks). Code content lives in pre>code (never a
 * direct child), so the per-level pass never touches it.
 *
 * extraKnownTags: container-directive tag names (:::name → <name>) come from
 * a dynamic registry and are mapped to React components in
 * previewComponentMap — MarkdownPreview passes that map's keys so registered
 * containers (tabs, tab, …) keep rendering. An UNREGISTERED directive name
 * has no component and shows as literal text (same rule as raw HTML).
 *
 * Two-stage design:
 * 1. `remarkCollapseUnknownTagRuns` (mdast level, right after remarkParse)
 *    collapses ROOT-level runs — from a lone unknown OPEN tag (a single-line
 *    `html` node) to the next lone close tag of the same name — into ONE
 *    paragraph of raw source. Needed because CommonMark ends an HTML block
 *    at the first BLANK line: a blank-line-separated region parses into
 *    markdown siblings (headings and fenced code render for real!) and the
 *    open/close tags become separate root `html` nodes, so this hast-level
 *    plugin alone can never reassemble it. Inline unknown tags (inside
 *    paragraphs) are NOT collapsed there — root-level walk only; stage 2
 *    covers them.
 * 2. `rehypeShowRawTags` (this rehype plugin) handles what's left: blocks
 *    with no blank lines inside (single multi-line `html` node), inline
 *    unknown tags, and unmatched tags.
 *
 * MUST run right after rehypeRaw and before rehypeMathjax: MathJax emits
 * <mjx-container> elements LATER in the pipeline, so they never pass through
 * here. previewComponentMap's style/script filters run at React level and
 * only see known tagNames — unaffected.
 */
const KNOWN_TAGS = new Set([
  // HTML
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base',
  'bdi', 'bdo', 'blockquote', 'br', 'button', 'canvas', 'caption', 'cite',
  'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details',
  'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hgroup', 'hr', 'i', 'iframe', 'img', 'input', 'ins',
  'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu',
  'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option',
  'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'section', 'select', 'slot', 'small', 'source',
  'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr',
  'track', 'u', 'ul', 'var', 'video', 'wbr',
  // SVG (raw <svg> blocks in markdown; MathJax SVG is generated later and
  // never passes through this plugin)
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'defs', 'use', 'symbol', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'foreignObject', 'image',
  'marker', 'pattern', 'filter', 'feGaussianBlur', 'feBlend',
  'feComponentTransfer', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode',
  'feOffset', 'title',
]);

// ponytail: hand-rolled attr serializer (className→class, arrays space-joined,
// true/empty → bare attr) — good enough for display-as-text; switch to
// hast-util-to-html if exotic attrs ever round-trip wrong. Note: the HTML
// parser behind rehypeRaw ignores the self-closing slash on non-void tags
// (parse5 spec behavior), so `<foo/>` in prose arrives here as an OPEN tag
// whose children absorbed the trailing text — we just render what the parser
// saw, we do not re-synthesize the slash.
function serializeAttrs(properties: any): string {
  let attrs = '';
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value === false || value == null) continue;
    const name = key === 'className' ? 'class' : key;
    if (value === true || value === '') {
      attrs += ` ${name}`;
    } else {
      const str = Array.isArray(value) ? value.join(' ') : String(value);
      attrs += ` ${name}="${str}"`;
    }
  }
  return attrs;
}

const textNode = (value: string) => ({ type: 'text', value });

const brNode = () => ({ type: 'element', tagName: 'br', properties: {}, children: [] });

// ponytail: raw-HTML content bypasses remark-breaks (mdast-level, runs before
// rehypeRaw), so a lone \n would collapse to a space in the HTML text node —
// splice <br> inline. Idempotent (br is an element), so levels that already
// split can't double-split.
function newlineTextToBr(node: any): any[] {
  if (node?.type !== 'text' || !node.value.includes('\n')) return [node];
  const out: any[] = [];
  node.value.split('\n').forEach((part: string, i: number) => {
    if (i > 0) out.push(brNode());
    if (part) out.push(textNode(part));
  });
  return out;
}

/**
 * Inner content of an unknown element. When the vfile carries the source
 * string the tree's positions index into, the raw source between the first
 * child's start and last child's end offset replaces the children (ONE text
 * node, newline→br applied) — inner markdown/nested tags display literally.
 * Fallback (no src or missing child positions): recurse into the children,
 * keeping their normal rendering.
 */
function rawInner(child: any, isKnown: (tag: string) => boolean, src: string | null): any[] {
  const kids = child.children ?? [];
  const first = kids[0];
  const last = kids[kids.length - 1];
  const startOff = first?.position?.start?.offset;
  const endOff = last?.position?.end?.offset;
  if (src == null || startOff == null || endOff == null) {
    return processLevel(kids, isKnown, src).flatMap(newlineTextToBr);
  }
  return [
    {
      type: 'text',
      value: src.slice(startOff, endOff),
      position: { start: first.position.start, end: last.position.end },
    },
  ].flatMap(newlineTextToBr);
}

/**
 * Per-level pass over one parent's child list. Unknown elements are spliced
 * open into [text("<tag attrs>"), ...rawInner, text("</tag>")] (inner
 * content always gets newline→br); known elements recurse into their own
 * children. If the level spliced anything, its sibling text nodes also get
 * newline→br — otherwise HTML whitespace collapsing eats the \n between two
 * spliced tags.
 */
function processLevel(children: any[], isKnown: (tag: string) => boolean, src: string | null): any[] {
  const out: any[] = [];
  let spliced = false;
  for (const child of children) {
    if (child?.type === 'element' && !isKnown(child.tagName)) {
      const inner = rawInner(child, isKnown, src);
      // Stamp the element's position on the open/close text nodes: a raw HTML
      // block occupies real source lines, and rehypeBlankGap reads
      // position.end.line to advance its line cursor — unpositioned, those
      // lines would count as blanks for the NEXT block's gap.
      out.push(
        { type: 'text', value: `<${child.tagName}${serializeAttrs(child.properties)}>`, position: child.position },
        ...inner,
        { type: 'text', value: `</${child.tagName}>`, position: child.position },
      );
      spliced = true;
    } else {
      if (Array.isArray(child?.children)) {
        child.children = processLevel(child.children, isKnown, src);
      }
      out.push(child);
    }
  }
  return spliced ? out.flatMap(newlineTextToBr) : out;
}

export function rehypeShowRawTags(options: { extraKnownTags?: Iterable<string> } = {}) {
  const extra = options.extraKnownTags ? new Set(options.extraKnownTags) : null;
  const isKnown = (tag: string) => KNOWN_TAGS.has(tag) || (extra ? extra.has(tag) : false);
  // file.value is the exact markdown string the tree's positions index into
  // (MarkdownPreview calls processSync(transformedString), so they align).
  return (tree: any, file: any) => {
    const src = typeof file?.value === 'string' ? file.value : null;
    if (Array.isArray(tree.children)) {
      tree.children = processLevel(tree.children, isKnown, src);
    }
  };
}

// ---- Stage 1: mdast-level run collapser ----
// Lone tags on a line of their own. Single-line only ([^>\n] in the attr
// class): a multi-line html node value is the no-blank-line block owned by
// the hast-level stage 2 above.
const OPEN_TAG_LINE_RE = /^<([a-zA-Z][\w-]*)(?:[ \t][^>\n]*)?>$/;
const CLOSE_TAG_LINE_RE = /^<\/([a-zA-Z][\w-]*)[ \t]*>$/;

/**
 * Remark plugin: collapse a root-level run of unknown-tag blocks — lone open
 * `html` node … lone close `html` node of the same name — into ONE paragraph
 * of raw source, so blank-line-separated regions (where CommonMark ends the
 * HTML block at the first blank line and the inner content parses as real
 * markdown) display as literal text instead of rendering.
 *
 * ponytail: ROOT-level walk only — inline unknown tags inside paragraphs are
 * already handled by the hast-level rehypeShowRawTags (they never become
 * root `html` nodes). Escalate to a full-tree walk only if a real doc shows
 * a blank-line region nested inside a blockquote/list.
 */
export function remarkCollapseUnknownTagRuns(options: { extraKnownTags?: Iterable<string> } = {}) {
  const extra = options.extraKnownTags ? new Set(options.extraKnownTags) : null;
  const isKnown = (tag: string) => KNOWN_TAGS.has(tag) || (extra ? extra.has(tag) : false);
  return (tree: any, file: any) => {
    const src = typeof file?.value === 'string' ? file.value : null;
    if (src == null || !Array.isArray(tree.children)) return;
    const children: any[] = tree.children;
    const out: any[] = [];
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const open = node?.type === 'html' ? node.value?.trim().match(OPEN_TAG_LINE_RE) : null;
      const openOff = node?.position?.start?.offset;
      if (!open || openOff == null || isKnown(open[1])) {
        out.push(node);
        continue;
      }
      // Scan forward for a lone close tag of the SAME name (a different
      // tag's close does not end the run). ponytail: nested same-name opens
      // inside the run are not tracked — the FIRST matching close wins and
      // the region renders literal up to it (raw source display, so content
      // is never lost); balance-tracking only if a real doc nests these.
      let j = -1;
      for (let k = i + 1; k < children.length; k++) {
        const sib = children[k];
        if (sib?.type !== 'html') continue;
        const close = sib.value?.trim().match(CLOSE_TAG_LINE_RE);
        if (close && close[1] === open[1] && sib.position?.end?.offset != null) {
          j = k;
          break;
        }
      }
      // No matching close (or its offsets are missing): leave the lone open
      // tag to the hast-level plugin.
      if (j < 0) {
        out.push(node);
        continue;
      }
      const closeNode = children[j];
      const raw = src.slice(openOff, closeNode.position.end.offset);
      const kids: any[] = [];
      // Skip empty parts but keep every break, so blank lines between the
      // tags display as blank lines.
      raw.split('\n').forEach((part: string, idx: number) => {
        if (idx > 0) kids.push({ type: 'break' });
        if (part) kids.push({ type: 'text', value: part });
      });
      out.push({
        type: 'paragraph',
        children: kids,
        // Position spans the whole run: rehypeBlankGap advances its line
        // cursor for ANY positioned root node, so the region's source lines
        // count as content, not blank lines.
        position: { start: node.position.start, end: closeNode.position.end },
      });
      i = j;
    }
    tree.children = out;
  };
}
