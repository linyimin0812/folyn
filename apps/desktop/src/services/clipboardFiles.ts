// Frontend shim for the `read_clipboard_files` Tauri command. Returns the file
// paths currently on the OS clipboard (Finder Cmd+C / Explorer Ctrl+C), or an
// empty array when the clipboard holds text/image but no file refs. The caller
// (App.tsx paste listener) treats empty as "fall through to normal text paste".
//
// See task 08-30-paste-external-files-with-folder-picker.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/utils/platform';

export async function readClipboardFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('read_clipboard_files');
  } catch (err) {
    console.error('[clipboardFiles] read_clipboard_files failed', err);
    return [];
  }
}

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
