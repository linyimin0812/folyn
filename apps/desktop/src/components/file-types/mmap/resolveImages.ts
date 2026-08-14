// ponytail: markmap-lib's Transformer emits <img src="rel.png"> verbatim
// from the markdown; relative paths break inside the foreignObject. Walk
// the transformed tree and rewrite img srcs against the file's on-disk
// directory (assetBase — already `~`-expanded via resolveAssetBase) and
// route through Tauri's asset protocol. Mirrors MarkdownPreview's
// VaultImage. Async because resolveAssetBase hits the Tauri path API.

import { convertFileSrc } from '@tauri-apps/api/core';
import type { IPureNode } from 'markmap-common';

function resolveImgSrc(src: string, assetBase: string | null): string {
  if (!src) return src;
  if (/^(https?:|data:|file:|blob:)/.test(src)) return src;
  if (!assetBase) return src;
  const imagePath = decodeURIComponent(src.replace(/^\.\//, ''));
  const absPath = `${assetBase}/${imagePath}`;
  return convertFileSrc(absPath);
}

export function resolveImagesInTree(
  node: IPureNode,
  assetBase: string | null,
): void {
  if (node.content && node.content.includes('<img')) {
    node.content = node.content.replace(
      /<img\b([^>]*?)src="([^"]+)"([^>]*)>/g,
      (m, pre: string, src: string, post: string) => {
        const resolved = resolveImgSrc(src, assetBase);
        // ponytail: cap image size so a fat screenshot doesn't blow the
        // node box; matches the old mind-elixir topicMarkdown sizing.
        const has = (s: string, k: string) => new RegExp(`\\b${k}=`).test(s);
        const style = has(pre + post, 'style')
          ? ''  // don't clobber an explicit style
          : ' style="max-width:200px;max-height:120px;vertical-align:middle"';
        return `<img${pre}src="${resolved}"${post}${style}>`;
      },
    );
  }
  if (node.children) {
    for (const c of node.children) resolveImagesInTree(c, assetBase);
  }
}
