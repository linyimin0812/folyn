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
      if (svgText) body.innerHTML = svgText;
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
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.style.maxWidth = '100%';
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
  }
  body.style.height = '420px';
  body.style.minHeight = '420px';
  body.style.overflow = 'hidden';
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
