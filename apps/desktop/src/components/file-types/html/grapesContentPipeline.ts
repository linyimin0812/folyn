/**
 * HTML parsing / reconstruction pipeline for GrapesJS integration.
 *
 * GrapesJS edits only the <body> components and the CSS rules. The surrounding
 * document structure (doctype, <html>/<head>/<meta>/<link>, <style> blocks that
 * GrapesJS does not own, and <script> tags that MUST never be passed to the
 * editor) is preserved outside the editor and re-attached on serialization.
 *
 * Script safety contract (see prd §6.1):
 *   - All <script> tags are extracted into `scriptBlocks` on parse
 *   - They are NEVER handed to `editor.setComponents()`
 *   - They are re-attached verbatim by `reconstructHtml` on save
 */

export interface ParsedHtml {
  /** Original doctype string, e.g. `<!DOCTYPE html>` (or '' if missing). */
  doctype: string;
  /** Attributes on the <html> tag (as a single string, e.g. `lang="en"`). */
  htmlAttrs: string;
  /** <head> child markup EXCLUDING <style> and <script> tags (meta/title/link/etc). */
  headContent: string;
  /** Inner text of each <style> block found in <head> (and stray <style> in body). */
  styleBlocks: string[];
  /** innerHTML of <body> with all <script> tags stripped. */
  bodyContent: string;
  /** Attributes on the <body> tag (single string). */
  bodyAttrs: string;
  /** Raw innerText of every <script> tag found anywhere in the document. */
  scriptBlocks: string[];
}

const EMPTY_PARSED: ParsedHtml = {
  doctype: '',
  htmlAttrs: '',
  headContent: '',
  styleBlocks: [],
  bodyContent: '',
  bodyAttrs: '',
  scriptBlocks: [],
};

function attrsToString(el: Element): string {
  let out = '';
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    out += ` ${attr.name}="${attr.value}"`;
  }
  return out;
}

/**
 * Parse a raw HTML string into structural fragments that can be fed to GrapesJS
 * without leaking <script> tags or losing head metadata. Robust to malformed
 * input — falls back to treating the entire string as body content.
 */
export function parseHtmlForGrapes(rawHtml: string): ParsedHtml {
  if (!rawHtml || !rawHtml.trim()) {
    return { ...EMPTY_PARSED };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  } catch {
    // DOMParser should never throw in a browser env, but guard anyway.
    return { ...EMPTY_PARSED, bodyContent: rawHtml };
  }

  // Doctype
  let doctype = '';
  if (doc.doctype) {
    doctype = `<!DOCTYPE ${doc.doctype.name}>`;
  }

  // <html> attrs
  const htmlAttrs = attrsToString(doc.documentElement);

  // <head> children — split into meta/title/link vs style vs script
  const styleBlocks: string[] = [];
  const scriptBlocks: string[] = [];
  const headParts: string[] = [];

  if (doc.head) {
    doc.head.childNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'style') {
          styleBlocks.push(el.innerHTML);
        } else if (tagName === 'script') {
          scriptBlocks.push(el.innerHTML);
        } else {
          headParts.push((el as Element).outerHTML);
        }
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        // Preserve non-empty text nodes (rare, but keeps whitespace intact).
        const txt = node.textContent;
        if (txt.trim()) headParts.push(txt);
      }
    });
  }

  // <body> — extract scripts first, then capture remaining HTML
  const bodyAttrs = doc.body ? attrsToString(doc.body) : '';
  let bodyContent = '';
  if (doc.body) {
    // Extract all <script> nodes (from body too) into scriptBlocks
    doc.body.querySelectorAll('script').forEach((s) => {
      scriptBlocks.push(s.innerHTML);
      s.remove();
    });
    bodyContent = doc.body.innerHTML;
  }

  return {
    doctype,
    htmlAttrs,
    headContent: headParts.join('\n'),
    styleBlocks,
    bodyContent,
    bodyAttrs,
    scriptBlocks,
  };
}

/**
 * Re-assemble a full HTML document from the parsed skeleton and the
 * freshly serialized output of GrapesJS (`editor.getHtml()` + `editor.getCss()`).
 *
 * Scripts are re-inserted as the last children of <body>, matching their
 * original (end-of-body) loading semantics as closely as possible.
 */
export function reconstructHtml(
  parsed: ParsedHtml,
  grapesHtml: string,
  grapesCss: string,
): string {
  const doctype = parsed.doctype || '<!DOCTYPE html>';
  const htmlOpen = parsed.htmlAttrs ? `<html${parsed.htmlAttrs}>` : '<html>';
  const bodyOpen = parsed.bodyAttrs ? `<body${parsed.bodyAttrs}>` : '<body>';

  // GrapesJS's `getCss()` already serializes the full CssComposer model,
  // which includes everything we fed into `editor.setStyle()` on mount.
  // Re-appending the original <style> blocks verbatim would compound across
  // saves: each save writes (grapesCss + originals) into a single <style>,
  // the next mount parses that whole block back into styleBlocks, feeds it
  // to setStyle, then re-appends it again — so the file roughly doubles in
  // size on every save.
  //
  // To preserve at-rules that GrapesJS's CssComposer may not round-trip
  // faithfully (@keyframes / @font-face / @import), we re-append ONLY the
  // portions of the original style blocks that contain those constructs.
  // Regular rule selectors and declarations are left to grapesCss.
  const AT_RULE_RE = /@(?:keyframes|font-face|import|charset|namespace)\b/;
  const preservedStyle = parsed.styleBlocks
    .map((s) => s.trim())
    .filter((s) => s && AT_RULE_RE.test(s))
    .join('\n\n');

  const cssChunks: string[] = [];
  if (grapesCss && grapesCss.trim()) cssChunks.push(grapesCss);
  if (preservedStyle) cssChunks.push(preservedStyle);
  const mergedCss = cssChunks.join('\n\n');

  // Re-attach scripts verbatim. The script's original `type`/`src` attrs are
  // intentionally dropped here — they were never passed to GrapesJS and we
  // only stored innerText. Inline scripts in head (rare) are still re-inserted
  // at end of body, which is acceptable for round-trip fidelity.
  const scripts = parsed.scriptBlocks
    .map((s) => `<script>${s}</script>`)
    .join('\n');

  const headContent = parsed.headContent.trim();
  const bodyContent = grapesHtml.trim();
  const scriptContent = scripts.trim();

  return [
    doctype,
    htmlOpen,
    '<head>',
    headContent ? `  ${headContent}` : '',
    '  <style>',
    mergedCss ? `  ${mergedCss}` : '',
    '  </style>',
    '</head>',
    bodyOpen,
    bodyContent ? `  ${bodyContent}` : '',
    scriptContent ? `  ${scriptContent}` : '',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
