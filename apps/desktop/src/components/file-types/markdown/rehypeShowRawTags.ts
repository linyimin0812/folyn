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
