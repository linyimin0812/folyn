/**
 * PNG export helper for the clip infographic poster.
 *
 * Uses `html-to-image.toPng()` to serialize the poster DOM subtree to a PNG
 * data URL, then writes the bytes to a user-chosen path via the Tauri
 * save dialog + plugin-fs. The poster uses only system fonts + CSS color
 * tokens (`text-t1/t2/t3`, `text-acc`, `bg-panel`, `bg-bg`, `border-brd`),
 * so `html-to-image`'s computed-style inlining handles the token system
 * correctly (no `var()` breakage like `html2canvas` has).
 *
 * Research: see `.trellis/tasks/07-02-redesign-clips-infographic-poster-style/research/html-to-image-library.md`.
 */
import { toPng } from 'html-to-image';

export interface ExportInfographicOptions {
  /** Slug used for the default filename (`<slug>-infographic.png`). */
  slug: string;
}

/**
 * Serialize `element` to a PNG and save it via the native save dialog.
 *
 * - `pixelRatio: 2` for crisp poster output (default follows
 *   `window.devicePixelRatio`, which is unreliable for export).
 * - `backgroundColor` is set to the page `--bg` token so transparent gaps
 *   between rounded corners render as the page bg, not transparent.
 * - `<a target="_blank">` in `SourceBlock` is harmless for static capture
 *   (no hover/focus styles), so no `filter` is needed.
 *
 * Throws on any failure (DOM serialization, dialog cancel, file write).
 * The caller (ClipCardView) is responsible for surfacing the error to the
 * user — except for the "user cancelled the save dialog" case, which is
 * treated as a no-op (resolves without writing).
 */
export async function exportInfographicToPng(
  element: HTMLElement,
  options: ExportInfographicOptions,
): Promise<void> {
  // Read --bg from the computed root style so the PNG background matches the
  // active theme (light or dark). Fall back to white if unset.
  const rootBg = (
    getComputedStyle(document.documentElement).getPropertyValue('--bg') ||
    '#ffffff'
  ).trim();

  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    backgroundColor: rootBg || '#ffffff',
  });

  // Convert the data URL to a Uint8Array for plugin-fs writeFile.
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const defaultName = `${options.slug}-infographic.png`;
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!filePath) {
    // User cancelled the dialog — not an error, just a no-op.
    return;
  }
  await writeFile(filePath, bytes);
}
