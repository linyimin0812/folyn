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
 * [text("<tag attrs>"), ...children, text("</tag>")] — the tags become
 * literal text nodes, the children keep their normal rendering (bold, links,
 * …). Known tags (<b>, <img>, <svg>, …) are untouched.
 *
 * Newlines inside the spliced content: remark-breaks turns single \n into
 * <br> at mdast level BEFORE rehypeRaw, so it never sees raw-HTML content —
 * an HTML text node's \n would collapse to a space. We splice <br> ourselves
 * for \n in the unknown tag's inner text nodes (mirroring remark-breaks),
 * and ONLY there — the rest of the tree is untouched.
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
// splice <br> inline, only for text inside spliced unknown-tag content.
function newlineTextToBr(node: any): any[] {
  if (node?.type !== 'text' || !node.value.includes('\n')) return [node];
  const out: any[] = [];
  node.value.split('\n').forEach((part: string, i: number) => {
    if (i > 0) out.push(brNode());
    if (part) out.push(textNode(part));
  });
  return out;
}

/** Returns the node list that replaces `node` in its parent's children. */
function unwrapUnknownTags(node: any, isKnown: (tag: string) => boolean): any[] {
  if (node?.type !== 'element') return [node];
  if (isKnown(node.tagName)) {
    if (Array.isArray(node.children)) node.children = node.children.flatMap((n: any) => unwrapUnknownTags(n, isKnown));
    return [node];
  }
  const inner = (node.children ?? [])
    .flatMap((n: any) => unwrapUnknownTags(n, isKnown))
    .flatMap(newlineTextToBr);
  return [
    textNode(`<${node.tagName}${serializeAttrs(node.properties)}>`),
    ...inner,
    textNode(`</${node.tagName}>`),
  ];
}

export function rehypeShowRawTags(options: { extraKnownTags?: Iterable<string> } = {}) {
  const extra = options.extraKnownTags ? new Set(options.extraKnownTags) : null;
  const isKnown = (tag: string) => KNOWN_TAGS.has(tag) || (extra ? extra.has(tag) : false);
  return (tree: any) => {
    if (Array.isArray(tree.children)) {
      tree.children = tree.children.flatMap((n: any) => unwrapUnknownTags(n, isKnown));
    }
  };
}
