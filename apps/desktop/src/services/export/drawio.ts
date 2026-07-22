/**
 * drawio file-preview export: replace the body with an SVG exported by the
 * diagrams.net iframe via postMessage. The iframe loads from
 * https://embed.diagrams.net (cross-origin) so we can't read its DOM, but
 * the embed protocol supports an `export` action that posts back the SVG.
 * Falls back silently (the body keeps its filename card / prior content)
 * on timeout.
 *
 * Format is `xmlsvg` (matches react-drawio's default — plain `svg` is not a
 * valid drawio export format and yields no response). The message is
 * JSON-stringified to match react-drawio's protocol; drawio's embed accepts
 * both but stringified is the documented form.
 *
 * Two native drawio export options are passed (per react-drawio's
 * ActionExport type): `transparent: true` skips the white bg on edge labels
 * (replaces the previous regex strip — drawio now omits it at source);
 * `keepTheme: false` forces light theme so no `color-scheme: light dark`
 * or `light-dark()` calls land in the output. normalizeDrawioSvgStyles is
 * kept as a fallback for older drawio versions that may ignore these opts.
 *
 * The SVG is embedded as `<img src="data:image/svg+xml;utf8,…">` rather
 * than inline `<svg>`. Inline SVG in HTML inherits host CSS (body
 * line-height: 1.8, font-family, etc.) into foreignObject divs and breaks
 * drawio's text layout — img-loaded SVG renders in its own image context,
 * matching standalone .svg file rendering. renderFilePreviewToSvg extracts
 * the raw SVG from the img src for standalone .svg / .png export.
 */

import type { EnhanceCtx } from './dbml';

export async function enhance(body: HTMLElement, _ctx: EnhanceCtx): Promise<void> {
  const iframe = body.querySelector('iframe');
  const cw = iframe?.contentWindow;
  if (!iframe || !cw) return;
  // ponytail: skip cross-origin document.readyState check — accessing
  // .document on a cross-origin iframe throws SecurityError, which the ?.
  // operator doesn't catch. The export stabilization loop already waited
  // for "加载中…" to disappear (DrawioPreview's loading state), so by the
  // time we get here the iframe has processed the load action and is ready
  // to receive export.
  await new Promise<void>((resolve) => {
    let settled = false;
    const handler = (e: MessageEvent) => {
      // drawio posts back a JSON-stringified payload (react-drawio does
      // JSON.parse(event.data)); accept both string and object forms.
      let payload: any = e.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (payload?.event !== 'export') return;
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      const raw = typeof payload.data === 'string' ? payload.data : '';
      // drawio returns the SVG as a data URI (`data:image/svg+xml;base64,…`
      // or `data:image/svg+xml;utf8,…`), not as a raw SVG string. Decode
      // so we embed a real <svg> via the img data URL (rather than nesting
      // the data URI inside another data URI).
      const svgText = decodeDataUriSvg(raw);
      if (svgText) {
        const normalized = normalizeDrawioSvgStyles(svgText);
        // ponytail: embed as <img> with data URL for CSS isolation. Inline
        // SVG in HTML inherits body's line-height: 1.8, font-family, etc.
        // into foreignObject divs, breaking drawio's text layout. img-
        // loaded SVG renders in an isolated image context — same as a
        // standalone .svg file opened in a browser. renderFilePreviewToSvg
        // (services/export/shared.ts) extracts the raw SVG from the img
        // src for standalone .svg / .png export.
        const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(normalized)}`;
        // ponytail: img fills the file-preview body (420px tall, full width)
        // and object-fit:contain scales the SVG to fit inside preserving
        // aspect ratio — no scroll, no clipping. Matches dbml/excalidraw/
        // mmap body sizing (420px overflow:hidden).
        body.innerHTML =
          `<img src="${dataUrl}" alt="" style="display:block;width:100%;height:100%;object-fit:contain;margin:0 auto;">`;
      }
      resolve();
    };
    window.addEventListener('message', handler);
    cw.postMessage(JSON.stringify({
      action: 'export',
      format: 'xmlsvg',
      spinKey: 'export',
      // Native drawio export options (per react-drawio ActionExport type):
      //   transparent: true  — skip white bg on edge labels (replaces
      //                        regex strip of background-color: #ffffff).
      //   keepTheme: false   — force light theme, so no color-scheme: light
      //                        dark or light-dark() in the output.
      // More robust than regex-stripping after the fact; normalizeDrawioSvgStyles
      // is kept as a fallback in case the drawio version ignores these.
      transparent: true,
      keepTheme: false,
    }), '*');
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve();
    }, 8000);
  });
  body.style.height = '420px';
  body.style.minHeight = '0';
  body.style.maxHeight = 'none';
  body.style.overflow = 'hidden';
}

/**
 * Normalize drawio's exported SVG as a fallback for older drawio versions
 * that may ignore the `transparent` / `keepTheme` export options. With
 * current drawio (transparent: true, keepTheme: false), the regexes are
 * no-ops — drawio omits these constructs at source.
 *
 * 1. `color-scheme: light dark` on root + `light-dark(A, B)` calls
 *    throughout inline styles — strip and replace with A (light value).
 * 2. `<style>` block at the top defining `--ge-adaptive-bg` via
 *    `@supports (color: light-dark(...))`. Strip it so the var falls
 *    back to its inline fallback (then we strip that too).
 * 3. Edge label divs with `background-color: #ffffff` (or the
 *    `--ge-adaptive-bg` var fallback, with or without space after comma,
 *    or `background:` shorthand, or `#fff` shorthand). Replace with
 *    transparent.
 *
 * ponytail: the `light-dark(A, B)` regex handles one level of nested
 * parens (e.g., `var(--ge-dark-color, #121212)` as the dark arg).
 * Drawio doesn't double-nest. Revisit if a future format does.
 */
function normalizeDrawioSvgStyles(svg: string): string {
  return svg
    // Strip the @supports style block at the top (defines --ge-adaptive-bg).
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    // Strip `color-scheme: light dark` from inline style attributes.
    .replace(/color-scheme:\s*light dark\s*;?/g, '')
    // Replace `light-dark(A, B)` with A (light value). The two args are
    // balanced for one level of nested parens via the inner (?:...) group.
    .replace(
      /light-dark\(\s*((?:[^()]|\([^()]*\))*)\s*,\s*((?:[^()]|\([^()]*\))*)\s*\)/g,
      '$1',
    )
    // Strip edge-label white bg in all forms drawio emits: #ffffff / #fff,
    // var(--ge-adaptive-bg, ...) with or without space after comma, with
    // or without fallback, plus the `background:` shorthand.
    .replace(
      /background(-color)?:\s*(?:#fff(?:fff)?|var\(--ge-adaptive-bg(?:\s*,\s*[^)]*)?\))\s*;?/g,
      (_m, g1) => `background${g1 || ''}: transparent;`,
    );
}

/**
 * Decode a drawio export payload to a raw SVG string. Accepts:
 *   - `data:image/svg+xml;base64,...` (drawio's usual form)
 *   - `data:image/svg+xml;utf8,...` or URL-encoded data URI
 *   - raw base64 (no prefix) — atob and check it starts with `<svg`
 *   - raw SVG string (starts with `<svg`) — pass through
 * Returns '' for unrecognized / malformed payloads.
 */
function decodeDataUriSvg(data: string): string {
  if (!data) return '';
  if (data.startsWith('<svg')) return data;
  const decodeBase64Svg = (b64: string): string => {
    try {
      // ponytail: atob returns a binary string (Latin-1 chars = bytes).
      // SVG content can contain non-ASCII (e.g. user-entered Chinese
      // labels); TextDecoder('utf-8') turns the byte sequence back into
      // a proper UTF-8 string. Without this, multi-byte chars render as
      // mojibake (e.g. "开始" → "å¼å§").
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return decoded.startsWith('<svg') ? decoded : '';
    } catch { return ''; }
  };
  if (data.startsWith('data:image/svg+xml')) {
    const commaIdx = data.indexOf(',');
    if (commaIdx < 0) return '';
    const meta = data.slice(0, commaIdx);
    const body = data.slice(commaIdx + 1);
    if (meta.includes(';base64')) return decodeBase64Svg(body);
    try { return decodeURIComponent(body); } catch { return body; }
  }
  return decodeBase64Svg(data);
}
