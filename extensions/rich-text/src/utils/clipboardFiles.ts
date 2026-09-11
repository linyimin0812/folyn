// ponytail: local copy of the single function from host services/clipboardFiles.ts
// that the rich-text image paste plugin uses. The host file also exposes
// readClipboardFiles (a Tauri command shim) which the extension doesn't need
// (the host's App-level paste listener handles file refs; the extension's
// RichTextImage plugin only needs HTML <img src> extraction for the Chrome
// "Copy image" path).

/**
 * Extract the first `<img src="...">` URL from a `text/html` clipboard payload.
 * Returns `null` when the HTML has no `<img>` or the src is not an http/https/data
 * URL. Used for the Chrome "Copy image" path: Chrome places only `text/html`
 * wrapping a remote `<img>` on the clipboard (no bitmap, no file ref), so the
 * webview's `paste` event surfaces no image file item — we fall back to
 * inserting the URL verbatim as an image.
 */
export function extractImgSrcFromHtml(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match) return null;
  const src = match[1];
  if (/^https?:\/\//i.test(src) || /^data:/i.test(src)) return src;
  return null;
}
