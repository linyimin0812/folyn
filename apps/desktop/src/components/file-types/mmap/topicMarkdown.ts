// ponytail: hand-rolled regex over a real markdown lib for plain topic text
// (bold/italic/inline-code/images). Math is rendered via the unified
// pipeline below so `$x^2$` and `$$...$$` produce inline SVG. mind-elixir
// hands us single-line topic text; the unified pipeline handles the rare
// multi-line case as a bonus. If mind-elixir topic text grows long, swap
// the regex calls for renderMarkdownToHtml everywhere (it already does
// math + GFM); the per-node cost is the trade.

import { createElement } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { renderMarkdownToHtml } from '@/services/markdown/renderMarkdown';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shape of the node-ish object mind-elixir hands to the `markdown:` callback.
// Only `note` is read; Arrow/Summary don't have it and render no icon.
export interface TopicMarkdownObj {
  note?: string;
}

/**
 * Resolve a markdown image src against the vault root + current file's
 * directory, then hand to Tauri's asset protocol. Mirrors the logic in
 * MarkdownPreview's VaultImage component — without this, a relative
 * `./assets/x.png` in a node topic renders as a broken <img> in the
 * mind-elixir canvas (which is plain DOM, no base-URL resolution). External
 * files (absolute `filePath`) resolve refs against the file's own directory.
 */
function resolveImgSrc(src: string, filePath: string, vaultRoot: string): string {
  if (!src) return src;
  if (/^(https?:|data:|file:|blob:)/.test(src)) return src;
  const imagePath = decodeURIComponent(src.replace(/^\.\//, ''));
  // External file: resolve relative refs against the file's own directory.
  // `filePath` is absolute here, so its directory is derived synchronously
  // (no async resolveBasePath needed) — this lets embedded images in an
  // external mind-map load.
  if (filePath.startsWith('/') || filePath.startsWith('~') || /^[A-Za-z]:[\/]/.test(filePath)) {
    // Best-effort sync dir extraction; ~ is resolved via the absolute
    // directory that mind-elixir already knows. For ~ we fall back to
    // treating the path as already absolute (asset scope will allow it).
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    const absPath = dir ? `${dir}/${imagePath}` : imagePath;
    return convertFileSrc(absPath);
  }
  if (!vaultRoot) return src;
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  let absPath: string;
  if (fileDir && imagePath.startsWith(fileDir + '/')) {
    absPath = `${vaultRoot}/${imagePath}`;
  } else if (fileDir) {
    absPath = `${vaultRoot}/${fileDir}/${imagePath}`;
  } else {
    absPath = `${vaultRoot}/${imagePath}`;
  }
  return convertFileSrc(absPath);
}

export interface TopicMarkdownOpts {
  filePath: string;
  vaultRoot: string;
}

// ponytail: custom hover popover via event delegation over the mind-elixir
// canvas — the native `title` tooltip doesn't fire reliably in the Tauri
// webview, so the note text lives in `data-note` (read by the delegated
// listener) and no `title` attr is emitted (avoids the double-popover:
// native tooltip + custom popover). `pointer-events:auto` is required
// because mind-elixir's CSS sets `me-tpc>*{pointer-events:none}` on all
// topic children — without it `mouseover` never fires on hover. CSS class
// `mmap-note-icon` is unstyled upstream (no theme coupling).
const NOTE_ICON_STYLE =
  'display:inline-block;margin-left:4px;padding:0 4px;font-size:11px;line-height:16px;border-radius:8px;cursor:help;pointer-events:auto;color:var(--t3);background:var(--hov);vertical-align:middle';

function renderNoteIcon(note: string): string {
  const escaped = escapeHtml(note);
  return `<span class="mmap-note-icon" data-note="${escaped}" style="${NOTE_ICON_STYLE}">ⓘ</span>`;
}

function renderTopic(text: string, opts: TopicMarkdownOpts): string {
  const { filePath, vaultRoot } = opts;
  // ponytail: fast regex path for plain topics; route through the unified
  // pipeline only when math markers ($) are present so $...$ and $$...$$
  // render to inline SVG. The pipeline's img component resolves vault-
  // relative image paths so legacy image handling carries over. <p> wrapper
  // from the pipeline is stripped for inline display in mind-elixir topics.
  if (!text.includes('$')) {
    const escaped = escapeHtml(text);
    return escaped
      .replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        (_m, alt: string, src: string) =>
          `<img src="${resolveImgSrc(src, filePath, vaultRoot)}" alt="${alt}" style="max-width:200px;max-height:120px;vertical-align:middle">`,
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  // ponytail: mind-elixir topic boxes are tight; scale MathJax SVG down
  // (it sizes in `ex` units, so font-size on the wrapper scales the SVG).
  // Display math still adds block margins — accept the tradeoff; rare in
  // topic text. If it bites, downgrade `$$..$$` → `$..$` here or add a
  // scoped style overriding mjx-container[display] margins.
  const html = renderMarkdownToHtml(text, {
    components: {
      img: function TopicImg(props: any) {
        const { src, alt, ...rest } = props;
        if (!src || /^(https?:|data:|file:|blob:)/.test(src)) {
          return createElement('img', { src, alt, ...rest });
        }
        return createElement('img', {
          src: resolveImgSrc(src, filePath, vaultRoot),
          alt,
          style: { maxWidth: 200, maxHeight: 120, verticalAlign: 'middle' },
          ...rest,
        });
      },
    },
  });
  return `<span style="font-size:11px;line-height:1.1">${html.replace(/^<p>|<\/p>$/g, '')}</span>`;
}

/**
 * Build a `markdown:` callback for mind-elixir that resolves relative image
 * URLs against the vault, and appends a note-info-icon (custom popover via
 * `data-note`) when the node carries a `note`. The pure `topicMarkdown` below is kept for tests
 * and cases where URL resolution + note icon aren't needed.
 */
export function createTopicMarkdown(
  opts: TopicMarkdownOpts,
): (text: string, obj?: TopicMarkdownObj) => string {
  return (text: string, obj?: TopicMarkdownObj) => {
    let html = renderTopic(text, opts);
    if (obj?.note) {
      html += renderNoteIcon(obj.note);
    }
    return html;
  };
}

export function topicMarkdown(text: string, obj?: TopicMarkdownObj): string {
  let html = escapeHtml(text)
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:200px;max-height:120px;vertical-align:middle">',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  if (obj?.note) {
    html += renderNoteIcon(obj.note);
  }
  return html;
}
