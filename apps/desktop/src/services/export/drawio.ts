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
      // so we inject a real <svg> element (scalable, styleable) rather
      // than dumping the URI as text.
      const svgText = decodeDataUriSvg(raw);
      if (svgText) {
        body.innerHTML = normalizeDrawioSvgStyles(svgText);
      }
      resolve();
    };
    window.addEventListener('message', handler);
    cw.postMessage(JSON.stringify({ action: 'export', format: 'xmlsvg', spinKey: 'export' }), '*');
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve();
    }, 8000);
  });
  const svgEl = body.querySelector('svg');
  if (svgEl) {
    // ponytail: don't force height: 100% — drawio's SVG viewBox spans the
    // full diagram (often very tall, e.g. 452×1432). Forcing into a 420px
    // body with preserveAspectRatio: meet scales content ~0.29x, making
    // 14px text ~4px and unreadable. Drop the height attr so the SVG
    // auto-sizes by viewBox aspect ratio (matches the in-app iframe's
    // natural-size-with-scroll behavior). Body scrolls vertically with
    // a max-height cap so very tall diagrams don't blow up the page.
    svgEl.setAttribute('width', '100%');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.style.maxWidth = '100%';
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
  }
  body.style.height = 'auto';
  body.style.minHeight = '200px';
  body.style.maxHeight = '600px';
  body.style.overflow = 'auto';
}

/**
 * Normalize drawio's exported SVG so it renders correctly in the host HTML
 * context (file-preview body). Three issues:
 *
 * 1. `color-scheme: light dark` on root + `light-dark(A, B)` calls
 *    throughout inline styles — drawio expects standalone SVG context
 *    where the browser picks OS theme consistently. Injected into HTML,
 *    the host page's color-scheme may mismatch, making `light-dark()`
 *    return dark values (e.g. white text) on light backgrounds — text
 *    becomes invisible. Force light values by stripping `color-scheme`
 *    and replacing `light-dark(A, B)` with `A`. Matches excalidraw's
 *    `exportWithDarkMode: false` pattern.
 *
 * 2. `<style>` block at the top defines `--ge-adaptive-bg` via
 *    `@supports (color: light-dark(...))`. Strip it so the var falls
 *    back to its inline fallback (then we strip that too).
 *
 * 3. Edge label divs have inline `background-color: #ffffff` (and a
 *    `--ge-adaptive-bg, #ffffff` fallback) so text is readable over
 *    crossing edges in-app. In standalone export this renders as white
 *    boxes on connections. Replace both with transparent. Node label
 *    divs don't carry background-color, so this only hits edge labels.
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
    // Strip edge-label white backgrounds (node divs don't carry bg).
    .replace(/background-color:\s*#ffffff/g, 'background-color: transparent')
    .replace(/background-color:\s*var\(--ge-adaptive-bg,\s*#ffffff\)/g, 'background-color: transparent');
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
